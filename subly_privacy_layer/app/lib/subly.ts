import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  BN,
  Idl,
} from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";

import rawIdl from "./idl/subly_privacy_layer.json";
import {
  generateClientKeypair,
  createSharedEncryptionBundle,
  getMXEPublicKey,
  getArciumAccounts,
  generateComputationOffset,
  decryptConfidentialBundle,
  ARCIUM_FEE_POOL_ACCOUNT,
  ARCIUM_CLOCK_ACCOUNT,
  type RescueCipher,
} from "./arcium-client";

const DEFAULT_PROGRAM_ID = (rawIdl as any).address as string;

function resolveProgramId(): PublicKey {
  const fromEnv = process.env.NEXT_PUBLIC_SUBLY_PROGRAM_ID?.trim();
  if (!fromEnv) {
    return new PublicKey(DEFAULT_PROGRAM_ID);
  }

  try {
    return new PublicKey(fromEnv);
  } catch (error) {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUBLY_PROGRAM_ID: ${
        (error as Error).message ?? "unknown error"
      }`
    );
  }
}

const SUBLY_IDL = rawIdl as Idl;

const PROGRAM_ID = resolveProgramId();

const CONFIG_SEED = Buffer.from("config");
const USER_POSITION_SEED = Buffer.from("user_position");
const USER_SUBSCRIPTIONS_SEED = Buffer.from("user_subscriptions");
const SUBSCRIPTION_REGISTRY_SEED = Buffer.from("subscription_registry");
const DEFAULT_LOCK_OPTION = 3;
const USDC_DECIMALS = 6;

type SublyConfig = {
  authority: PublicKey;
  usdcMint: PublicKey;
  vault: PublicKey;
  totalPrincipal: bigint;
  rewardPool: bigint;
  accIndex: bigint;
  apyBps: number;
  lastUpdateTs: bigint;
  paused: boolean;
  bump: number;
  vaultBump: number;
};

function getCoder() {
  return new BorshAccountsCoder(SUBLY_IDL);
}

export async function fetchSublyConfig(
  connection: Connection
): Promise<SublyConfig> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  );
  const accountInfo = await connection.getAccountInfo(configPda);
  if (!accountInfo) {
    throw new Error("Subly config account not found on the connected cluster");
  }

  const coder = getCoder();
  const decoded = coder.decode("SublyConfig", accountInfo.data) as any;

  return {
    authority: decoded.authority as PublicKey,
    usdcMint: decoded.usdc_mint as PublicKey,
    vault: decoded.vault as PublicKey,
    totalPrincipal: BigInt(decoded.total_principal.toString()),
    rewardPool: BigInt(decoded.reward_pool.toString()),
    accIndex: BigInt(decoded.acc_index.toString()),
    apyBps: decoded.apy_bps,
    lastUpdateTs: BigInt(decoded.last_update_ts.toString()),
    paused: decoded.paused,
    bump: decoded.bump,
    vaultBump: decoded.vault_bump,
  };
}

export type PayPalRecipientDetails = {
  configured: boolean;
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE" | null;
  receiver: string;
};

function mapRecipientType(raw: any): PayPalRecipientDetails["recipientType"] {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const [variant] = Object.keys(raw);
  if (!variant) {
    return null;
  }

  switch (variant.toLowerCase()) {
    case "email":
      return "EMAIL";
    case "paypalid":
      return "PAYPAL_ID";
    case "phone":
      return "PHONE";
    case "userhandle":
      return "USER_HANDLE";
    default:
      return null;
  }
}

export async function fetchPayPalRecipient(
  connection: Connection,
  user: PublicKey
): Promise<PayPalRecipientDetails | null> {
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(userSubscriptionsPda);
  if (!accountInfo) {
    return null;
  }

  const coder = getCoder();
  const decoded = coder.decode("UserSubscriptions", accountInfo.data) as any;

  return {
    configured: Boolean(decoded.paypal_configured),
    recipientType: mapRecipientType(decoded.paypal_recipient_type),
    receiver: decoded.paypal_receiver as string,
  };
}

export type SubscriptionServiceEntry = {
  id: number;
  creator: PublicKey;
  name: string;
  monthlyPrice: bigint;
  details: string;
  logoUrl: string;
  provider: string;
  createdAt: number;
};

export async function fetchSubscriptionServices(
  connection: Connection
): Promise<SubscriptionServiceEntry[]> {
  const [subscriptionRegistryPda] = PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_REGISTRY_SEED],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(subscriptionRegistryPda);
  if (!accountInfo) {
    return [];
  }

  const coder = getCoder();
  const decoded = coder.decode("SubscriptionRegistry", accountInfo.data) as any;
  const services = (decoded.services ?? []) as any[];

  return services.map((service) => ({
    id: Number(service.id),
    creator:
      service.creator instanceof PublicKey
        ? (service.creator as PublicKey)
        : new PublicKey(service.creator),
    name: String(service.name),
    monthlyPrice: BigInt(service.monthly_price_usdc.toString()),
    details: String(service.details),
    logoUrl: String(service.logo_url),
    provider: String(service.provider),
    createdAt: Number(service.created_at),
  }));
}

export type UserSubscriptionEntry = {
  id: number;
  encryptedData: {
    ciphertexts: number[][];
    ciphertextCount: number;
    nonce: number[];
    encryptionKey: number[];
  };
  encryptedMetadata: {
    ciphertexts: number[][];
    ciphertextCount: number;
    nonce: number[];
    encryptionKey: number[];
  };
  // Decrypted values (populated client-side)
  serviceId?: number;
  monthlyPrice?: bigint;
  decryptionError?: string;
};

/**
 * Decrypt a single subscription entry using the provided cipher
 * @param subscription - Raw subscription data from on-chain
 * @param cipher - RescueCipher instance for decryption
 * @returns Subscription with decrypted fields
 */
export function decryptSubscriptionEntry(
  subscription: any,
  cipher: RescueCipher
): UserSubscriptionEntry {
  const entry: UserSubscriptionEntry = {
    id: Number(subscription.id),
    encryptedData: subscription.encrypted_data,
    encryptedMetadata: subscription.encrypted_metadata,
  };

  try {
    // Decrypt encrypted_data (contains service_id and monthly_price)
    if (entry.encryptedData.ciphertextCount > 0) {
      const decrypted = decryptConfidentialBundle(cipher, entry.encryptedData);

      // SubscriptionInfo struct has 2 fields: service_id (u64), monthly_price (u64)
      if (decrypted.length >= 2) {
        entry.serviceId = Number(decrypted[0]);
        entry.monthlyPrice = decrypted[1];
      }
    }
  } catch (error) {
    entry.decryptionError =
      error instanceof Error ? error.message : "Decryption failed";
    console.error("Failed to decrypt subscription:", error);
  }

  return entry;
}

/**
 * Fetch user subscriptions from on-chain account
 * Note: Returns encrypted data. Use decryptSubscriptionEntry() to decrypt.
 * @param connection - Solana connection
 * @param user - User's public key
 * @param cipher - Optional RescueCipher for automatic decryption
 * @returns Array of subscription entries (encrypted or decrypted)
 */
export async function fetchUserSubscriptions(
  connection: Connection,
  user: PublicKey,
  cipher?: RescueCipher
): Promise<UserSubscriptionEntry[]> {
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(userSubscriptionsPda);
  if (!accountInfo) {
    return [];
  }

  const coder = getCoder();
  const decoded = coder.decode("UserSubscriptions", accountInfo.data) as any;
  const subscriptions = (decoded.subscriptions ?? []) as any[];

  // If cipher provided, decrypt automatically
  if (cipher) {
    return subscriptions.map((sub) => decryptSubscriptionEntry(sub, cipher));
  }

  // Otherwise return encrypted data only
  return subscriptions.map((subscription) => ({
    id: Number(subscription.id),
    encryptedData: subscription.encrypted_data,
    encryptedMetadata: subscription.encrypted_metadata,
  }));
}

export async function prepareStakeTransaction(
  connection: Connection,
  user: PublicKey,
  amount: bigint
): Promise<{
  transaction: Transaction;
  blockhash: BlockhashWithExpiryBlockHeight;
}> {
  if (amount <= 0n) {
    throw new Error("Stake amount must be greater than zero");
  }

  const config = await fetchSublyConfig(connection);
  if (config.paused) {
    throw new Error("Staking is currently paused");
  }

  const usdcMint = config.usdcMint;
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  );
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID
  );
  const userTokenAccount = await getAssociatedTokenAddress(usdcMint, user);
  const userTokenAccountInfo = await connection.getAccountInfo(
    userTokenAccount
  );

  const instructions: TransactionInstruction[] = [];

  if (!userTokenAccountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        user,
        userTokenAccount,
        user,
        usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL);
  const encoded = instructionCoder.encode("stake", {
    amount: new BN(amount.toString()),
    lock_option: DEFAULT_LOCK_OPTION,
  });

  const stakeIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userPositionPda, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: config.vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encoded,
  });

  instructions.push(stakeIx);

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = user;

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;

  return { transaction, blockhash };
}

export async function prepareUnstakeTransaction(
  connection: Connection,
  user: PublicKey,
  trancheId: number
): Promise<{
  transaction: Transaction;
  blockhash: BlockhashWithExpiryBlockHeight;
}> {
  if (trancheId < 0) {
    throw new Error("Invalid tranche identifier");
  }

  const config = await fetchSublyConfig(connection);

  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  );
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID
  );
  const userTokenAccount = await getAssociatedTokenAddress(
    config.usdcMint,
    user
  );
  const userTokenAccountInfo = await connection.getAccountInfo(
    userTokenAccount
  );

  const instructions: TransactionInstruction[] = [];

  if (!userTokenAccountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        user,
        userTokenAccount,
        user,
        config.usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL);
  const encoded = instructionCoder.encode("unstake", {
    tranche_id: new BN(trancheId),
  });

  instructions.push(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: userPositionPda, isSigner: false, isWritable: true },
        { pubkey: config.vault, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: encoded,
    })
  );

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = user;

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;

  return { transaction, blockhash };
}

export type RegisterPayPalArgs = {
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE";
  receiver: string;
};

function normaliseRecipientTypeInput(
  type: RegisterPayPalArgs["recipientType"]
): string {
  switch (type) {
    case "EMAIL":
      return "EMAIL";
    case "PAYPAL_ID":
      return "PAYPAL_ID";
    case "PHONE":
      return "PHONE";
    case "USER_HANDLE":
      return "USER_HANDLE";
    default:
      return "EMAIL";
  }
}

export async function prepareRegisterPayPalRecipientTransaction(
  connection: Connection,
  user: PublicKey,
  args: RegisterPayPalArgs
): Promise<{
  transaction: Transaction;
  blockhash: BlockhashWithExpiryBlockHeight;
}> {
  const receiver = args.receiver.trim();
  if (!receiver) {
    throw new Error("PayPal receiver information is required");
  }

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL);
  const encoded = instructionCoder.encode("register_paypal_recipient", {
    args: {
      recipient_type: normaliseRecipientTypeInput(args.recipientType),
      receiver,
    },
  });

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encoded,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;

  return { transaction, blockhash };
}

/**
 * Prepare subscribe service transaction with Arcium MPC encryption
 * @param connection - Solana connection
 * @param user - User's public key
 * @param service - Subscription service details
 * @param currentTotal - Current total monthly commitment (0 for first subscription)
 * @returns Transaction, blockhash, and encryption context (client secret key and cipher)
 */
export async function prepareSubscribeServiceTransaction(
  connection: Connection,
  user: PublicKey,
  service: SubscriptionServiceEntry,
  currentTotal: bigint = 0n
): Promise<{
  transaction: Transaction;
  blockhash: BlockhashWithExpiryBlockHeight;
  clientSecretKey: Uint8Array;
  cipher: RescueCipher;
  computationOffset: bigint;
}> {
  const [configPda] = PublicKey.findProgramAddressSync(
    [CONFIG_SEED],
    PROGRAM_ID
  );
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID
  );
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const userPositionInfo = await connection.getAccountInfo(userPositionPda);
  if (!userPositionInfo) {
    throw new Error("No staking position found. Stake before subscribing.");
  }

  // Get MXE public key and generate client keypair
  const mxePublicKey = await getMXEPublicKey(connection, PROGRAM_ID);
  const {
    secretKey: clientSecretKey,
    publicKey: clientPublicKey,
    cipher,
  } = generateClientKeypair(mxePublicKey);

  // Encrypt subscription data
  // All values must use the same nonce for Enc<Shared, T>
  const serviceId = BigInt(service.id);
  const monthlyPrice = service.monthlyPrice;

  const { nonce, ciphertexts } = createSharedEncryptionBundle(
    cipher,
    [currentTotal, serviceId, monthlyPrice],
    clientPublicKey
  );

  // Generate computation offset
  const computationOffset = generateComputationOffset();

  // Get Arcium accounts
  const arciumAccounts = getArciumAccounts(PROGRAM_ID, computationOffset);

  // Prepare instruction arguments
  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL);
  const encoded = instructionCoder.encode("subscribe_service", {
    computation_offset: new BN(computationOffset.toString()),
    args: {
      encryption_pubkey: Array.from(clientPublicKey),
      nonce: Array.from(nonce),
      total_ciphertext: Array.from(ciphertexts[0]),
      subscription_service_id_ciphertext: Array.from(ciphertexts[1]),
      subscription_monthly_price_ciphertext: Array.from(ciphertexts[2]),
    },
  });

  // Build instruction with all required accounts
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userPositionPda, isSigner: false, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      {
        pubkey: arciumAccounts.signPdaAccount,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: arciumAccounts.mxeAccount, isSigner: false, isWritable: false },
      {
        pubkey: arciumAccounts.mempoolAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: arciumAccounts.executingPool,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: arciumAccounts.computationAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: arciumAccounts.compDefAccount,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: arciumAccounts.clusterAccount,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: ARCIUM_FEE_POOL_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_CLOCK_ACCOUNT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      {
        pubkey: arciumAccounts.arciumProgram,
        isSigner: false,
        isWritable: false,
      },
    ],
    data: encoded,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;

  return { transaction, blockhash, clientSecretKey, cipher, computationOffset };
}

export async function prepareUnsubscribeServiceTransaction(
  connection: Connection,
  user: PublicKey,
  subscriptionId: number
): Promise<{
  transaction: Transaction;
  blockhash: BlockhashWithExpiryBlockHeight;
}> {
  if (subscriptionId < 0) {
    throw new Error("Invalid subscription identifier");
  }

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const userSubscriptionsInfo = await connection.getAccountInfo(
    userSubscriptionsPda
  );
  if (!userSubscriptionsInfo) {
    throw new Error("No subscription record found for this wallet");
  }

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL);
  const encoded = instructionCoder.encode("unsubscribe_service", {
    args: {
      subscription_id: new BN(subscriptionId),
    },
  });

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
    ],
    data: encoded,
  });

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = user;

  const blockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash.blockhash;

  return { transaction, blockhash };
}

export function parseUsdcAmount(input: string): bigint {
  const value = input.trim();
  if (!/^(\d+)(\.\d{0,6})?$/.test(value)) {
    throw new Error("Enter a valid USDC amount with up to 6 decimal places");
  }

  const [whole, fraction = ""] = value.split(".");
  const paddedFraction = (fraction + "000000").slice(0, USDC_DECIMALS);

  const wholeAmount = BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS);
  const fractionalAmount = BigInt(paddedFraction || "0");

  return wholeAmount + fractionalAmount;
}

export function formatUsdcFromSmallest(amount: bigint): string {
  const divisor = 10n ** BigInt(USDC_DECIMALS);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0")}`;
}

export function formatUsdcFromSmallestToDisplay(amount: bigint): string {
  return Number(formatUsdcFromSmallest(amount)).toFixed(2);
}

export function formatUsdcAmountDisplay(amount: string | number): string {
  const parsed = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(parsed)) {
    return "0.00";
  }
  return parsed.toFixed(2);
}

export const SUBLY_PROGRAM_ID = PROGRAM_ID;

export async function fetchUserStakeEntries(
  connection: Connection,
  user: PublicKey
): Promise<StakeEntrySummary[]> {
  const [userPositionPda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(userPositionPda);
  if (!accountInfo) {
    return [];
  }

  const coder = getCoder();
  const decoded = coder.decode("UserStake", accountInfo.data) as any;
  const entries = (decoded.entries ?? []) as any[];

  return entries.map((entry) => ({
    trancheId: Number(entry.tranche_id),
    principal: BigInt(entry.principal.toString()),
    depositedAt: Number(entry.deposited_at),
    lockEndTs: Number(entry.lock_end_ts),
    lockDuration: Number(entry.lock_duration),
  }));
}
export type StakeEntrySummary = {
  trancheId: number;
  principal: bigint;
  depositedAt: number;
  lockEndTs: number;
  lockDuration: number;
};
