import * as anchor from "@coral-xyz/anchor"
import { AnchorProvider, Program } from "@coral-xyz/anchor"
import { PublicKey, SystemProgram } from "@solana/web3.js"
import fs from "fs"
import path from "path"

import { SublySolanaProgram } from "../target/types/subly_solana_program"

const SUBSCRIPTION_REGISTRY_SEED = "subscription_registry"
const USDC_DECIMALS = 6

type ServiceDefinition = {
  name: string
  monthlyPriceUsd: number
  details: string
  logoUrl: string
  provider: string
}

type ScriptConfig = {
  filePath: string
}

function readServices(filePath: string): ServiceDefinition[] {
  const resolvedPath = path.resolve(filePath)
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service definition file not found: ${resolvedPath}`)
  }

  const raw = fs.readFileSync(resolvedPath, "utf8")
  const parsed = JSON.parse(raw)

  if (!Array.isArray(parsed)) {
    throw new Error("Service definition file must contain an array")
  }

  return parsed.map((entry, index) => {
    const { name, monthlyPriceUsd, details, logoUrl, provider } = entry ?? {}

    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`Service at index ${index} is missing a valid 'name'`)
    }

    if (typeof monthlyPriceUsd !== "number" || Number.isNaN(monthlyPriceUsd) || monthlyPriceUsd <= 0) {
      throw new Error(`Service '${name}' is missing a valid 'monthlyPriceUsd'`)
    }

    return {
      name: name.trim(),
      monthlyPriceUsd,
      details: typeof details === "string" ? details.trim() : "",
      logoUrl: typeof logoUrl === "string" ? logoUrl.trim() : "",
      provider: typeof provider === "string" ? provider.trim() : "",
    }
  })
}

function parseArgs(): ScriptConfig {
  const [, , filePathArg] = process.argv

  if (!filePathArg) {
    throw new Error(
      "Usage: yarn register-subscription-services <path-to-services.json>",
    )
  }

  return { filePath: filePathArg }
}

function toUsdcAmount(amountUsd: number) {
  const scaled = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS))
  return new anchor.BN(scaled.toString())
}

async function main() {
  const { filePath } = parseArgs()
  const services = readServices(filePath)

  const provider = AnchorProvider.env()
  anchor.setProvider(provider)

  const wallet = provider.wallet as anchor.Wallet
  const program = anchor.workspace.SublySolanaProgram as Program<SublySolanaProgram>

  const [subscriptionRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SUBSCRIPTION_REGISTRY_SEED)],
    program.programId,
  )

  const registryAccount = await program.account.subscriptionRegistry.fetchNullable(
    subscriptionRegistryPda,
  )
  const existingNames = new Set<string>(
    (registryAccount?.services ?? []).map((service: any) => String(service.name).toLowerCase()),
  )

  console.log(`Loaded ${services.length} service(s) from ${path.resolve(filePath)}`)
  console.log(`Program ID: ${program.programId.toBase58()}`)
  console.log(`Registry PDA: ${subscriptionRegistryPda.toBase58()}`)
  console.log("------------------------------------------------------------")

  let registeredCount = 0

  for (const service of services) {
    if (existingNames.has(service.name.toLowerCase())) {
      console.log(`Skipping '${service.name}' – already registered.`)
      continue
    }

    try {
      console.log(`Registering service '${service.name}' ...`)

      const signature = await program.methods
        .registerSubscriptionService({
          name: service.name,
          monthlyPriceUsdc: toUsdcAmount(service.monthlyPriceUsd),
          details: service.details,
          logoUrl: service.logoUrl,
          provider: service.provider,
        })
        .accountsStrict({
          payer: wallet.publicKey,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc()

      console.log(`  ✓ Success. Signature: ${signature}`)
      registeredCount += 1
      existingNames.add(service.name.toLowerCase())
    } catch (error) {
      console.error(`  ✗ Failed to register '${service.name}':`, error)
      throw error
    }
  }

  console.log(
    registeredCount > 0
      ? `Completed. Registered ${registeredCount} new service(s).`
      : "No new services were registered.",
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Script failed", error)
    process.exit(1)
  })
