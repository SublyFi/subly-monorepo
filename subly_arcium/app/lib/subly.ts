import {
  BN,
  BorshAccountsCoder,
  BorshInstructionCoder,
  type Idl,
} from "@coral-xyz/anchor"
import {
  BlockhashWithExpiryBlockHeight,
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js"
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import bs58 from "bs58"

import {
  PROGRAM_ID,
  deriveArciumAccounts,
  randomComputationOffset,
  waitForSublyEvent,
  type SublyEventResult,
} from "@/lib/arcium"
import sublyIdl from "@/lib/idl/subly_arcium.json"

const SUBLY_IDL = sublyIdl as Idl
const instructionCoder = new BorshInstructionCoder(SUBLY_IDL)
const accountCoder = new BorshAccountsCoder(SUBLY_IDL)

const CONFIG_SEED = Buffer.from("config")
const USER_POSITION_SEED = Buffer.from("user_position")
const USER_SUBSCRIPTIONS_SEED = Buffer.from("user_subscriptions")
const SUBSCRIPTION_REGISTRY_SEED = Buffer.from("subscription_registry")
const VAULT_SEED = Buffer.from("vault")

const USDC_DECIMALS = 6
const USDC_EXPONENT = 10n ** BigInt(USDC_DECIMALS)

export type SendAndConfirmFn = (
  transaction: Transaction,
  blockhash: BlockhashWithExpiryBlockHeight,
) => Promise<{ signature: string }>

export type PreparedComputation = {
  computationOffset: BN
  transaction: Transaction
  blockhash: BlockhashWithExpiryBlockHeight
}

export type ExecuteComputationResult<TEvent = unknown> = {
  userTxSignature: string
  event?: SublyEventResult<TEvent>
}

export type StakeEntrySummary = {
  trancheId: number
  principal: bigint
  depositedAt: number
  lockEndTs: number
  lockDuration: number
  claimedOperator: bigint
  claimedUser: bigint
  unrealizedYield: bigint
}

export type PayPalRecipientDetails = {
  configured: boolean
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE" | null
  receiverHashLow: bigint
  receiverHashHigh: bigint
}

export type RegisterPayPalArgs = {
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE"
  receiver: string
}

export type SubscriptionServiceEntry = {
  id: number
  name: string
  monthlyPrice: number
  details: string
  logoUrl: string
  provider: string
}

export type UserSubscriptionEntry = {
  subscriptionId: number
  serviceId: number
  monthlyPrice: bigint
  status: "ACTIVE" | "PENDING_CANCELLATION" | "CANCELLED"
  startedAt: number
  lastPaymentTs: number
  nextBillingTs: number
  pendingUntilTs: number
  initialPaymentRecorded: boolean
}

export type UserSubscriptionsView = {
  totalActiveCommitment: bigint
  totalPendingCommitment: bigint
  subscriptions: UserSubscriptionEntry[]
}

export type UserAvailableBudget = {
  totalPrincipal: bigint
  apyBps: number
  monthlyBudgetUsdc: bigint
  activeCommitmentUsdc: bigint
  pendingCommitmentUsdc: bigint
  availableBudgetUsdc: bigint
}

export type SublyConfigAccount = {
  authority: PublicKey
  usdcMint: PublicKey
  vault: PublicKey
  paused: boolean
  pendingInitializeOffset: BN | null
  pendingConfigOffset: BN | null
  bump: number
  vaultBump: number
}

export function formatUsdcFromSmallest(amount: bigint): string {
  const whole = amount / USDC_EXPONENT
  const fraction = amount % USDC_EXPONENT
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0")}`
}

export function formatUsdcFromSmallestToDisplay(amount: bigint): string {
  return Number(formatUsdcFromSmallest(amount)).toFixed(2)
}

export function formatUsdcAmountDisplay(value: string | number): string {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return "0.00"
  }
  return parsed.toFixed(2)
}

export function parseUsdcAmount(input: string): bigint {
  const value = input.trim()
  if (!/^(\d+)(\.\d{0,6})?$/.test(value)) {
    throw new Error("Enter a valid USDC amount with up to 6 decimal places")
  }

  const [whole, fraction = ""] = value.split(".")
  const paddedFraction = (fraction + "000000").slice(0, USDC_DECIMALS)

  const wholeAmount = BigInt(whole || "0") * USDC_EXPONENT
  const fractionalAmount = BigInt(paddedFraction || "0")

  return wholeAmount + fractionalAmount
}

export async function executeComputation<TEvent = unknown>(
  connection: Connection,
  prepared: PreparedComputation,
  sendAndConfirm: SendAndConfirmFn,
  {
    expectedEvent,
    eventFilter,
    commitment = "confirmed",
    timeoutMs = 60_000,
  }: {
    expectedEvent?: string
    eventFilter?: (data: TEvent) => boolean
    commitment?: Commitment
    timeoutMs?: number
  } = {},
): Promise<ExecuteComputationResult<TEvent>> {
  const eventPromise =
    expectedEvent !== undefined
      ? waitForSublyEvent<TEvent>(connection, expectedEvent, {
          commitment,
          timeoutMs,
          filter: eventFilter,
        })
      : undefined

  const { signature: userTxSignature } = await sendAndConfirm(
    prepared.transaction,
    prepared.blockhash,
  )

  const event = eventPromise ? await eventPromise : undefined

  return {
    userTxSignature,
    event,
  }
}

export async function fetchSublyConfig(connection: Connection): Promise<SublyConfigAccount> {
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const accountInfo = await connection.getAccountInfo(configPda)
  if (!accountInfo) {
    throw new Error("Subly config account not found on the connected cluster")
  }

  const decoded = accountCoder.decode("SublyConfig", accountInfo.data) as any

  return {
    authority: decoded.authority as PublicKey,
    usdcMint: decoded.usdc_mint as PublicKey,
    vault: decoded.vault as PublicKey,
    paused: Boolean(decoded.paused),
    pendingInitializeOffset: decoded.pending_initialize_offset ?? null,
    pendingConfigOffset: decoded.pending_config_offset ?? null,
    bump: decoded.bump,
    vaultBump: decoded.vault_bump,
  }
}

function newTransaction(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  blockhash: BlockhashWithExpiryBlockHeight,
): Transaction {
  const tx = new Transaction().add(...instructions)
  tx.feePayer = payer
  tx.recentBlockhash = blockhash.blockhash
  return tx
}

async function ensureAtaInstruction(
  connection: Connection,
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): Promise<TransactionInstruction | null> {
  const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID)
  const info = await connection.getAccountInfo(ata)
  if (info) {
    return null
  }
  return createAssociatedTokenAccountInstruction(
    payer,
    ata,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}

export async function prepareStakeTransaction(
  connection: Connection,
  user: PublicKey,
  amount: bigint,
  lockOption: number,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "stake_subly")

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID,
  )
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID)

  const configAccount = await fetchSublyConfig(connection)
  const usdcMint = configAccount.usdcMint
  const userTokenAccount = await getAssociatedTokenAddress(usdcMint, user)

  const instructions: TransactionInstruction[] = []
  const maybeCreateAta = await ensureAtaInstruction(connection, user, user, usdcMint)
  if (maybeCreateAta) {
    instructions.push(maybeCreateAta)
  }

  const data = instructionCoder.encode("stake", {
    computation_offset: computationOffset,
    args: {
      amount: new BN(amount.toString()),
      lock_option: lockOption,
    },
  })

  instructions.push(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user, isSigner: true, isWritable: true }, // payer
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true }, // user
        { pubkey: userStakePda, isSigner: false, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
        { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
      ],
      data,
    }),
  )

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, instructions, blockhash),
  }
}

export async function prepareUnstakeTransaction(
  connection: Connection,
  user: PublicKey,
  trancheId: number,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "unstake_subly")

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID,
  )
  const [vaultPda] = PublicKey.findProgramAddressSync([VAULT_SEED], PROGRAM_ID)

  const configAccount = await fetchSublyConfig(connection)
  const userTokenAccount = await getAssociatedTokenAddress(configAccount.usdcMint, user)

  const data = instructionCoder.encode("unstake", {
    computation_offset: computationOffset,
    args: {
      tranche_id: new BN(trancheId),
    },
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true }, // payer
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userStakePda, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareGetUserStakeTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "get_user_stake_subly")

  const [userStakePda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("get_user_stake", {
    computation_offset: computationOffset,
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userStakePda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareGetUserSubscriptionsTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "get_user_subscriptions_subly")

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("get_user_subscriptions", {
    computation_offset: computationOffset,
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareGetUserAvailableServicesTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(
    computationOffset,
    "get_user_available_services_subly",
  )

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID,
  )
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("get_user_available_services", {
    computation_offset: computationOffset,
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: userStakePda, isSigner: false, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareGetPayPalRecipientTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "get_paypal_recipient_subly")

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("get_paypal_recipient", {
    computation_offset: computationOffset,
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareRegisterPayPalRecipientTransaction(
  connection: Connection,
  user: PublicKey,
  args: RegisterPayPalArgs,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(
    computationOffset,
    "register_paypal_recipient_subly",
  )

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("register_paypal_recipient", {
    computation_offset: computationOffset,
    args: {
      recipient_type: args.recipientType,
      receiver: args.receiver,
    },
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

function serviceIdToSeed(serviceId: number): Buffer {
  return new BN(serviceId).toArrayLike(Buffer, "le", 8)
}

export async function prepareSubscribeServiceTransaction(
  connection: Connection,
  user: PublicKey,
  serviceId: number,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(computationOffset, "subscribe_service_subly")

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [registryPda] = PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_REGISTRY_SEED],
    PROGRAM_ID,
  )
  const [servicePda] = PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_REGISTRY_SEED, serviceIdToSeed(serviceId)],
    PROGRAM_ID,
  )
  const [userStakePda] = PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, user.toBuffer()],
    PROGRAM_ID,
  )
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("subscribe_service", {
    computation_offset: computationOffset,
    args: {
      service_id: new BN(serviceId),
    },
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true }, // payer == user
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: registryPda, isSigner: false, isWritable: true },
      { pubkey: servicePda, isSigner: false, isWritable: false },
      { pubkey: userStakePda, isSigner: false, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

export async function prepareUnsubscribeServiceTransaction(
  connection: Connection,
  user: PublicKey,
  subscriptionId: number,
): Promise<PreparedComputation> {
  const computationOffset = randomComputationOffset()
  const arcium = deriveArciumAccounts(
    computationOffset,
    "unsubscribe_service_subly",
  )

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const data = instructionCoder.encode("unsubscribe_service", {
    computation_offset: computationOffset,
    args: {
      subscription_id: new BN(subscriptionId),
    },
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
      { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
      { pubkey: arcium.clockAccount, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false },
    ],
    data,
  })

  const blockhash = await connection.getLatestBlockhash()
  return {
    computationOffset,
    blockhash,
    transaction: newTransaction(user, [instruction], blockhash),
  }
}

function mapStakeEntries(rawEntries: any[]): StakeEntrySummary[] {
  return rawEntries
    .map((entry) => ({
      trancheId: Number(entry.tranche_id),
      principal: BigInt(entry.principal.toString()),
      depositedAt: Number(entry.deposited_at),
      lockEndTs: Number(entry.lock_end_ts),
      lockDuration: Number(entry.lock_duration),
      claimedOperator: BigInt(entry.claimed_operator.toString()),
      claimedUser: BigInt(entry.claimed_user.toString()),
      unrealizedYield: BigInt(entry.unrealized_yield.toString()),
    }))
    .filter((entry) => entry.principal > 0n)
}

function mapSubscriptionEntries(rawEntries: any[]): UserSubscriptionEntry[] {
  return rawEntries.map((entry) => ({
    subscriptionId: Number(entry.subscription_id),
    serviceId: Number(entry.service_id),
    monthlyPrice: BigInt(entry.monthly_price_usdc.toString()),
    status: (entry.status as string) as UserSubscriptionEntry["status"],
    startedAt: Number(entry.started_at),
    lastPaymentTs: Number(entry.last_payment_ts),
    nextBillingTs: Number(entry.next_billing_ts),
    pendingUntilTs: Number(entry.pending_until_ts),
    initialPaymentRecorded: Boolean(entry.initial_payment_recorded),
  }))
}

export async function fetchUserStakeEntries(
  connection: Connection,
  user: PublicKey,
  sendAndConfirm: SendAndConfirmFn,
  options: { commitment?: Commitment; timeoutMs?: number } = {},
): Promise<{ totalPrincipal: bigint; entries: StakeEntrySummary[]; signature: string }> {
  const prepared = await prepareGetUserStakeTransaction(connection, user)
  const result = await executeComputation<{ user: PublicKey; total_principal: BN; entries: any[] }>(
    connection,
    prepared,
    sendAndConfirm,
    {
      expectedEvent: "UserStakeFetched",
      eventFilter: (data) => data.user.equals(user),
      commitment: options.commitment,
      timeoutMs: options.timeoutMs,
    },
  )

  if (!result.event) {
    throw new Error("Stake snapshot event not received")
  }

  const { data, signature } = result.event
  const totalPrincipal = BigInt(data.total_principal.toString())
  const entries = mapStakeEntries(data.entries)

  return {
    totalPrincipal,
    entries,
    signature,
  }
}

export async function fetchUserSubscriptions(
  connection: Connection,
  user: PublicKey,
  sendAndConfirm: SendAndConfirmFn,
  options: { commitment?: Commitment; timeoutMs?: number } = {},
): Promise<{ view: UserSubscriptionsView; signature: string }> {
  const prepared = await prepareGetUserSubscriptionsTransaction(connection, user)
  const result = await executeComputation<{
    user: PublicKey
    total_active_commitment: BN
    total_pending_commitment: BN
    subscriptions: any[]
  }>(connection, prepared, sendAndConfirm, {
    expectedEvent: "UserSubscriptionsFetched",
    eventFilter: (data) => data.user.equals(user),
    commitment: options.commitment,
    timeoutMs: options.timeoutMs,
  })

  if (!result.event) {
    throw new Error("Subscription snapshot event not received")
  }

  const { data, signature } = result.event
  const view: UserSubscriptionsView = {
    totalActiveCommitment: BigInt(data.total_active_commitment.toString()),
    totalPendingCommitment: BigInt(data.total_pending_commitment.toString()),
    subscriptions: mapSubscriptionEntries(data.subscriptions),
  }

  return { view, signature }
}

export async function fetchUserAvailableServices(
  connection: Connection,
  user: PublicKey,
  sendAndConfirm: SendAndConfirmFn,
  options: { commitment?: Commitment; timeoutMs?: number } = {},
): Promise<{ summary: UserAvailableBudget; signature: string }> {
  const prepared = await prepareGetUserAvailableServicesTransaction(connection, user)
  const result = await executeComputation<{
    user: PublicKey
    total_principal: BN
    apy_bps: number
    monthly_budget_usdc: BN
    active_commitment_usdc: BN
    pending_commitment_usdc: BN
    available_budget_usdc: BN
  }>(connection, prepared, sendAndConfirm, {
    expectedEvent: "UserAvailableServicesFetched",
    eventFilter: (data) => data.user.equals(user),
    commitment: options.commitment,
    timeoutMs: options.timeoutMs,
  })

  if (!result.event) {
    throw new Error("User available services event not received")
  }

  const { data, signature } = result.event
  const summary: UserAvailableBudget = {
    totalPrincipal: BigInt(data.total_principal.toString()),
    apyBps: Number(data.apy_bps),
    monthlyBudgetUsdc: BigInt(data.monthly_budget_usdc.toString()),
    activeCommitmentUsdc: BigInt(data.active_commitment_usdc.toString()),
    pendingCommitmentUsdc: BigInt(data.pending_commitment_usdc.toString()),
    availableBudgetUsdc: BigInt(data.available_budget_usdc.toString()),
  }

  return { summary, signature }
}

export async function fetchPayPalRecipient(
  connection: Connection,
  user: PublicKey,
  sendAndConfirm: SendAndConfirmFn,
  options: { commitment?: Commitment; timeoutMs?: number } = {},
): Promise<{ details: PayPalRecipientDetails; signature: string }> {
  const prepared = await prepareGetPayPalRecipientTransaction(connection, user)
  const result = await executeComputation<{
    user: PublicKey
    configured: boolean
    recipient_type: string
    receiver_hash_low: BN
    receiver_hash_high: BN
  }>(connection, prepared, sendAndConfirm, {
    expectedEvent: "PayPalRecipientFetched",
    eventFilter: (data) => data.user.equals(user),
    commitment: options.commitment,
    timeoutMs: options.timeoutMs,
  })

  if (!result.event) {
    throw new Error("PayPal recipient event not received")
  }

  const { data, signature } = result.event

  const details: PayPalRecipientDetails = {
    configured: Boolean(data.configured),
    recipientType: (data.recipient_type as PayPalRecipientDetails["recipientType"]) ?? null,
    receiverHashLow: BigInt(data.receiver_hash_low.toString()),
    receiverHashHigh: BigInt(data.receiver_hash_high.toString()),
  }

  return { details, signature }
}

export function shortenSignature(signature: string): string {
  if (signature.length <= 16) {
    return signature
  }
  return `${signature.slice(0, 8)}…${signature.slice(-8)}`
}

export function decodeSignature(bytes: Uint8Array): string {
  return bs58.encode(bytes)
}
