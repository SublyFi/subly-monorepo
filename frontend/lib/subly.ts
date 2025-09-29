import { BorshAccountsCoder, BorshInstructionCoder, BN, Idl } from "@coral-xyz/anchor"
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token"
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js"

import rawIdl from "./idl/subly_solana_program.json"

const DEFAULT_PROGRAM_ID = (rawIdl as any).address as string

function resolveProgramId(): PublicKey {
  const fromEnv = process.env.NEXT_PUBLIC_SUBLY_PROGRAM_ID?.trim()
  if (!fromEnv) {
    return new PublicKey(DEFAULT_PROGRAM_ID)
  }

  try {
    return new PublicKey(fromEnv)
  } catch (error) {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUBLY_PROGRAM_ID: ${(error as Error).message ?? "unknown error"}`,
    )
  }
}

const SUBLY_IDL = rawIdl as Idl

const PROGRAM_ID = resolveProgramId()

const CONFIG_SEED = Buffer.from("config")
const USER_POSITION_SEED = Buffer.from("user_position")
const USER_SUBSCRIPTIONS_SEED = Buffer.from("user_subscriptions")
const SUBSCRIPTION_REGISTRY_SEED = Buffer.from("subscription_registry")
const DEFAULT_LOCK_OPTION = 3
const USDC_DECIMALS = 6

type SublyConfig = {
  authority: PublicKey
  usdcMint: PublicKey
  vault: PublicKey
  totalPrincipal: bigint
  rewardPool: bigint
  accIndex: bigint
  apyBps: number
  lastUpdateTs: bigint
  paused: boolean
  bump: number
  vaultBump: number
}

function getCoder() {
  return new BorshAccountsCoder(SUBLY_IDL)
}

export async function fetchSublyConfig(connection: Connection): Promise<SublyConfig> {
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const accountInfo = await connection.getAccountInfo(configPda)
  if (!accountInfo) {
    throw new Error("Subly config account not found on the connected cluster")
  }

  const coder = getCoder()
  const decoded = coder.decode("SublyConfig", accountInfo.data) as any

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
  }
}

export type PayPalRecipientDetails = {
  configured: boolean
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE" | null
  receiver: string
}

function mapRecipientType(raw: any): PayPalRecipientDetails["recipientType"] {
  if (!raw || typeof raw !== "object") {
    return null
  }

  const [variant] = Object.keys(raw)
  if (!variant) {
    return null
  }

  switch (variant.toLowerCase()) {
    case "email":
      return "EMAIL"
    case "paypalid":
      return "PAYPAL_ID"
    case "phone":
      return "PHONE"
    case "userhandle":
      return "USER_HANDLE"
    default:
      return null
  }
}

export async function fetchPayPalRecipient(
  connection: Connection,
  user: PublicKey,
): Promise<PayPalRecipientDetails | null> {
  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const accountInfo = await connection.getAccountInfo(userSubscriptionsPda)
  if (!accountInfo) {
    return null
  }

  const coder = getCoder()
  const decoded = coder.decode("UserSubscriptions", accountInfo.data) as any

  return {
    configured: Boolean(decoded.paypal_configured),
    recipientType: mapRecipientType(decoded.paypal_recipient_type),
    receiver: decoded.paypal_receiver as string,
  }
}

export type SubscriptionServiceEntry = {
  id: number
  creator: PublicKey
  name: string
  monthlyPrice: bigint
  details: string
  logoUrl: string
  provider: string
  createdAt: number
}

export async function fetchSubscriptionServices(
  connection: Connection,
): Promise<SubscriptionServiceEntry[]> {
  const [subscriptionRegistryPda] = PublicKey.findProgramAddressSync(
    [SUBSCRIPTION_REGISTRY_SEED],
    PROGRAM_ID,
  )

  const accountInfo = await connection.getAccountInfo(subscriptionRegistryPda)
  if (!accountInfo) {
    return []
  }

  const coder = getCoder()
  const decoded = coder.decode("SubscriptionRegistry", accountInfo.data) as any
  const services = (decoded.services ?? []) as any[]

  return services.map((service) => ({
    id: Number(service.id),
    creator: new PublicKey(service.creator),
    name: String(service.name),
    monthlyPrice: BigInt(service.monthly_price_usdc.toString()),
    details: String(service.details),
    logoUrl: String(service.logo_url),
    provider: String(service.provider),
    createdAt: Number(service.created_at),
  }))
}

export async function prepareStakeTransaction(
  connection: Connection,
  user: PublicKey,
  amount: bigint,
): Promise<{ transaction: Transaction; blockhash: BlockhashWithExpiryBlockHeight }> {
  if (amount <= 0n) {
    throw new Error("Stake amount must be greater than zero")
  }

  const config = await fetchSublyConfig(connection)
  if (config.paused) {
    throw new Error("Staking is currently paused")
  }

  const usdcMint = config.usdcMint
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [userPositionPda] = PublicKey.findProgramAddressSync([
    USER_POSITION_SEED,
    user.toBuffer(),
  ], PROGRAM_ID)
  const userTokenAccount = await getAssociatedTokenAddress(usdcMint, user)
  const userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount)

  const instructions: TransactionInstruction[] = []

  if (!userTokenAccountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        user,
        userTokenAccount,
        user,
        usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    )
  }

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL)
  const encoded = instructionCoder.encode("stake", {
    amount: new BN(amount.toString()),
    lock_option: DEFAULT_LOCK_OPTION,
  })

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
  })

  instructions.push(stakeIx)

  const transaction = new Transaction().add(...instructions)
  transaction.feePayer = user

  const blockhash = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash.blockhash

  return { transaction, blockhash }
}

export async function prepareUnstakeTransaction(
  connection: Connection,
  user: PublicKey,
  trancheId: number,
): Promise<{ transaction: Transaction; blockhash: BlockhashWithExpiryBlockHeight }> {
  if (trancheId < 0) {
    throw new Error("Invalid tranche identifier")
  }

  const config = await fetchSublyConfig(connection)

  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], PROGRAM_ID)
  const [userPositionPda] = PublicKey.findProgramAddressSync([
    USER_POSITION_SEED,
    user.toBuffer(),
  ], PROGRAM_ID)
  const userTokenAccount = await getAssociatedTokenAddress(config.usdcMint, user)
  const userTokenAccountInfo = await connection.getAccountInfo(userTokenAccount)

  const instructions: TransactionInstruction[] = []

  if (!userTokenAccountInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        user,
        userTokenAccount,
        user,
        config.usdcMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    )
  }

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL)
  const encoded = instructionCoder.encode("unstake", {
    tranche_id: new BN(trancheId),
  })

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
    }),
  )

  const transaction = new Transaction().add(...instructions)
  transaction.feePayer = user

  const blockhash = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash.blockhash

  return { transaction, blockhash }
}

export type RegisterPayPalArgs = {
  recipientType: "EMAIL" | "PAYPAL_ID" | "PHONE" | "USER_HANDLE"
  receiver: string
}

function normaliseRecipientTypeInput(type: RegisterPayPalArgs["recipientType"]): string {
  switch (type) {
    case "EMAIL":
      return "EMAIL"
    case "PAYPAL_ID":
      return "PAYPAL_ID"
    case "PHONE":
      return "PHONE"
    case "USER_HANDLE":
      return "USER_HANDLE"
    default:
      return "EMAIL"
  }
}

export async function prepareRegisterPayPalRecipientTransaction(
  connection: Connection,
  user: PublicKey,
  args: RegisterPayPalArgs,
): Promise<{ transaction: Transaction; blockhash: BlockhashWithExpiryBlockHeight }> {
  const receiver = args.receiver.trim()
  if (!receiver) {
    throw new Error("PayPal receiver information is required")
  }

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [USER_SUBSCRIPTIONS_SEED, user.toBuffer()],
    PROGRAM_ID,
  )

  const instructionCoder = new BorshInstructionCoder(SUBLY_IDL)
  const encoded = instructionCoder.encode("register_paypal_recipient", {
    args: {
      recipient_type: normaliseRecipientTypeInput(args.recipientType),
      receiver,
    },
  })

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: userSubscriptionsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encoded,
  })

  const transaction = new Transaction().add(instruction)
  transaction.feePayer = user

  const blockhash = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash.blockhash

  return { transaction, blockhash }
}

export function parseUsdcAmount(input: string): bigint {
  const value = input.trim()
  if (!/^(\d+)(\.\d{0,6})?$/.test(value)) {
    throw new Error("Enter a valid USDC amount with up to 6 decimal places")
  }

  const [whole, fraction = ""] = value.split(".")
  const paddedFraction = (fraction + "000000").slice(0, USDC_DECIMALS)

  const wholeAmount = BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS)
  const fractionalAmount = BigInt(paddedFraction || "0")

  return wholeAmount + fractionalAmount
}

export function formatUsdcFromSmallest(amount: bigint): string {
  const divisor = 10n ** BigInt(USDC_DECIMALS)
  const whole = amount / divisor
  const fraction = amount % divisor
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0")}`
}

export const SUBLY_PROGRAM_ID = PROGRAM_ID

export async function fetchUserStakeEntries(
  connection: Connection,
  user: PublicKey,
): Promise<StakeEntrySummary[]> {
  const [userPositionPda] = PublicKey.findProgramAddressSync([
    USER_POSITION_SEED,
    user.toBuffer(),
  ], PROGRAM_ID)

  const accountInfo = await connection.getAccountInfo(userPositionPda)
  if (!accountInfo) {
    return []
  }

  const coder = getCoder()
  const decoded = coder.decode("UserStake", accountInfo.data) as any
  const entries = (decoded.entries ?? []) as any[]

  return entries.map((entry) => ({
    trancheId: Number(entry.tranche_id),
    principal: BigInt(entry.principal.toString()),
    depositedAt: Number(entry.deposited_at),
    lockEndTs: Number(entry.lock_end_ts),
    lockDuration: Number(entry.lock_duration),
  }))
}
export type StakeEntrySummary = {
  trancheId: number
  principal: bigint
  depositedAt: number
  lockEndTs: number
  lockDuration: number
}
