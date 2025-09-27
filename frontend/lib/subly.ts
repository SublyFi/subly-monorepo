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

const PROGRAM_ID = new PublicKey("GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22")

const SUBLY_IDL: Idl = {
  version: "0.1.0",
  name: "sublySolanaProgram",
  instructions: [
    {
      name: "stake",
      accounts: [
        { name: "config", isMut: true, isSigner: false },
        { name: "user", isMut: true, isSigner: true },
        { name: "userPosition", isMut: true, isSigner: false },
        { name: "userTokenAccount", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "lockOption", type: "u8" },
      ],
    },
    {
      name: "unstake",
      accounts: [
        { name: "config", isMut: true, isSigner: false },
        { name: "user", isMut: true, isSigner: true },
        { name: "userPosition", isMut: true, isSigner: false },
        { name: "vault", isMut: true, isSigner: false },
        { name: "userTokenAccount", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [{ name: "trancheId", type: "u64" }],
    },
  ],
  accounts: [
    {
      name: "sublyConfig",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "pubkey" },
          { name: "usdcMint", type: "pubkey" },
          { name: "vault", type: "pubkey" },
          { name: "totalPrincipal", type: "u64" },
          { name: "rewardPool", type: "u64" },
          { name: "accIndex", type: "u128" },
          { name: "apyBps", type: "u16" },
          { name: "lastUpdateTs", type: "i64" },
          { name: "paused", type: "bool" },
          { name: "bump", type: "u8" },
          { name: "vaultBump", type: "u8" },
        ],
      },
    },
    {
      name: "userStake",
      type: {
        kind: "struct",
        fields: [
          { name: "owner", type: "pubkey" },
          { name: "totalPrincipal", type: "u64" },
          { name: "lastUpdatedTs", type: "i64" },
          { name: "nextTrancheId", type: "u64" },
          {
            name: "entries",
            type: { vec: { defined: { name: "stakeEntry" } } },
          },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
  types: [
    {
      name: "stakeEntry",
      type: {
        kind: "struct",
        fields: [
          { name: "trancheId", type: "u64" },
          { name: "principal", type: "u64" },
          { name: "depositedAt", type: "i64" },
          { name: "lockEndTs", type: "i64" },
          { name: "lockDuration", type: "i64" },
          { name: "startAccIndex", type: "u128" },
          { name: "lastAccIndex", type: "u128" },
          { name: "claimedOperator", type: "u64" },
          { name: "claimedUser", type: "u64" },
          { name: "unrealizedYield", type: "u64" },
        ],
      },
    },
  ],
}

const CONFIG_SEED = Buffer.from("config")
const USER_POSITION_SEED = Buffer.from("user_position")
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
  const decoded = coder.decode("sublyConfig", accountInfo.data) as any

  return {
    authority: decoded.authority as PublicKey,
    usdcMint: decoded.usdcMint as PublicKey,
    vault: decoded.vault as PublicKey,
    totalPrincipal: BigInt(decoded.totalPrincipal.toString()),
    rewardPool: BigInt(decoded.rewardPool.toString()),
    accIndex: BigInt(decoded.accIndex.toString()),
    apyBps: decoded.apyBps,
    lastUpdateTs: BigInt(decoded.lastUpdateTs.toString()),
    paused: decoded.paused,
    bump: decoded.bump,
    vaultBump: decoded.vaultBump,
  }
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
    lockOption: DEFAULT_LOCK_OPTION,
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
    trancheId: new BN(trancheId),
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
  const decoded = coder.decode("userStake", accountInfo.data) as any
  const entries = (decoded.entries ?? []) as any[]

  return entries.map((entry) => ({
    trancheId: Number(entry.trancheId),
    principal: BigInt(entry.principal.toString()),
    depositedAt: Number(entry.depositedAt),
    lockEndTs: Number(entry.lockEndTs),
    lockDuration: Number(entry.lockDuration),
  }))
}
export type StakeEntrySummary = {
  trancheId: number
  principal: bigint
  depositedAt: number
  lockEndTs: number
  lockDuration: number
}
