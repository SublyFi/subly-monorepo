import { BN, BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor"
import type { Commitment, Connection } from "@solana/web3.js"
import { PublicKey } from "@solana/web3.js"
import { Buffer } from "buffer"

import sublyIdl from "@/lib/idl/subly_arcium.json"

// Ensure Buffer is available in browser environments
if (typeof globalThis !== "undefined" && (globalThis as { Buffer?: typeof Buffer }).Buffer === undefined) {
  ;(globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer
}

const textEncoder = new TextEncoder()

const SEED_SIGNER = textEncoder.encode("SignerAccount")
const SEED_MXE = textEncoder.encode("MXEAccount")
const SEED_MEMPOOL = textEncoder.encode("Mempool")
const SEED_EXEC_POOL = textEncoder.encode("Execpool")
const SEED_COMPUTATION = textEncoder.encode("ComputationAccount")
const SEED_COMP_DEF = textEncoder.encode("ComputationDefinitionAccount")
const SEED_CLUSTER = textEncoder.encode("Cluster")

const POOL_ACCOUNT_ADDRESS = "7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3"
const CLOCK_ACCOUNT_ADDRESS = "FHriyvoZotYiFnbUzKFjzRSb2NiaC8RPWY7jtKuKhg65"

const SUBLY_IDL = sublyIdl as Idl

export const PROGRAM_ID = new PublicKey((sublyIdl as { address: string }).address)
export const ARCIUM_PROGRAM_ID = new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6")

const PROGRAM_ID_BYTES = PROGRAM_ID.toBytes()

const DEFAULT_CLUSTER_INDEX = Number.parseInt(
  process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_INDEX ?? "0",
  10,
)

const COMP_DEF_OFFSETS: Record<string, number> = {
  initialize_subly: 3045730717,
  register_paypal_recipient_subly: 1588789750,
  get_paypal_recipient_subly: 1480803056,
  register_subscription_service_subly: 3297283538,
  get_subscription_services_subly: 4049456913,
  subscribe_service_subly: 2295280082,
  get_user_subscriptions_subly: 3013405559,
  get_user_available_services_subly: 535142390,
  get_user_stake_subly: 1278200474,
  stake_subly: 1331113561,
  unstake_subly: 1744244012,
  find_due_subscriptions_subly: 1301062559,
  record_subscription_payment_subly: 2914155411,
  claim_user_subly: 282780897,
  claim_operator_subly: 1124497209,
  sync_yield_subly: 2990627078,
  fund_rewards_subly: 768915987,
  unsubscribe_service_subly: 3394667449,
}

const sublyCoder = new BorshCoder(SUBLY_IDL)
const sublyEventParser = new EventParser(PROGRAM_ID, sublyCoder)

function toU32LE(value: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, value >>> 0, true)
  return new Uint8Array(view.buffer)
}

function bnToU64LE(value: BN): Uint8Array {
  const buf = value.toArrayLike(Buffer, "le", 8)
  return new Uint8Array(buf)
}

function derivePda(seeds: Uint8Array[]): PublicKey {
  const seedBuffers = seeds.map((seed) => Buffer.from(seed))
  return PublicKey.findProgramAddressSync(seedBuffers, ARCIUM_PROGRAM_ID)[0]
}

export type DerivedArciumAccounts = {
  signPdaAccount: PublicKey
  mxeAccount: PublicKey
  mempoolAccount: PublicKey
  executingPool: PublicKey
  computationAccount: PublicKey
  compDefAccount: PublicKey
  clusterAccount: PublicKey
  poolAccount: PublicKey
  clockAccount: PublicKey
  arciumProgram: PublicKey
}

export function deriveArciumAccounts(
  computationOffset: BN,
  label: keyof typeof COMP_DEF_OFFSETS,
  clusterIndex: number = DEFAULT_CLUSTER_INDEX,
): DerivedArciumAccounts {
  const compDefOffset = COMP_DEF_OFFSETS[label]
  if (compDefOffset === undefined) {
    throw new Error(`Unknown computation label '${label}'`)
  }

  const programBytes = new Uint8Array(PROGRAM_ID_BYTES)

  const signPdaAccount = derivePda([SEED_SIGNER])
  const mxeAccount = derivePda([SEED_MXE, programBytes])
  const mempoolAccount = derivePda([SEED_MEMPOOL, programBytes])
  const executingPool = derivePda([SEED_EXEC_POOL, programBytes])
  const computationAccount = derivePda([
    SEED_COMPUTATION,
    programBytes,
    bnToU64LE(computationOffset),
  ])
  const compDefAccount = derivePda([
    SEED_COMP_DEF,
    programBytes,
    toU32LE(compDefOffset),
  ])
  const clusterAccount = derivePda([SEED_CLUSTER, toU32LE(clusterIndex)])

  return {
    signPdaAccount,
    mxeAccount,
    mempoolAccount,
    executingPool,
    computationAccount,
    compDefAccount,
    clusterAccount,
    poolAccount: new PublicKey(POOL_ACCOUNT_ADDRESS),
    clockAccount: new PublicKey(CLOCK_ACCOUNT_ADDRESS),
    arciumProgram: ARCIUM_PROGRAM_ID,
  }
}

export function randomComputationOffset(): BN {
  const bytes = new Uint8Array(8)
  if (!(typeof globalThis.crypto !== "undefined" && "getRandomValues" in globalThis.crypto)) {
    throw new Error("Secure random generator is unavailable in this environment")
  }
  globalThis.crypto.getRandomValues(bytes)

  // Ensure the offset is non-zero to avoid collisions.
  if (bytes.every((byte) => byte === 0)) {
    bytes[0] = 1
  }

  return new BN(Buffer.from(bytes), "le")
}

export type SublyEventResult<TData = unknown> = {
  name: string
  signature: string
  data: TData
}

export async function waitForSublyEvent<TData = unknown>(
  connection: Connection,
  eventName: string,
  {
    commitment = "confirmed",
    timeoutMs = 60_000,
    filter,
  }: {
    commitment?: Commitment
    timeoutMs?: number
    filter?: (data: TData) => boolean
  } = {},
): Promise<SublyEventResult<TData>> {
  let subscriptionId: number | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (subscriptionId !== null) {
      void connection.removeOnLogsListener(subscriptionId).catch(() => undefined)
      subscriptionId = null
    }
  }

  return await new Promise<SublyEventResult<TData>>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for event '${eventName}'`))
    }, timeoutMs)

    const handleLogs = (logs: Parameters<Parameters<typeof connection.onLogs>[1]>[0]) => {
      try {
        for (const parsed of sublyEventParser.parseLogs(logs.logs)) {
          if (parsed.name !== eventName) {
            continue
          }

          const eventData = parsed.data as TData
          if (filter && !filter(eventData)) {
            continue
          }

          cleanup()
          resolve({
            name: parsed.name,
            signature: logs.signature,
            data: eventData,
          })
          return
        }
      } catch (error) {
        cleanup()
        reject(error)
      }
    }

    void connection
      .onLogs(PROGRAM_ID, handleLogs, commitment)
      .then((id) => {
        subscriptionId = id
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}
