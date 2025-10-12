import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";

import type { SublyArcium } from "../target/types/subly_arcium";
import {
  createArciumContext,
  randomComputationOffset,
  waitForFinalization,
} from "./utils/arcium";
import { loadServiceCache, upsertServiceEntry } from "./utils/service-cache";

const REGISTRY_SEED = "subscription_registry";
const USDC_DECIMALS = 6;

type ServiceDefinition = {
  name: string;
  monthlyPriceUsd: number;
  details?: string;
  logoUrl?: string;
  provider?: string;
};

type ScriptConfig = {
  filePath: string;
};

function readServices(filePath: string): ServiceDefinition[] {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Service definition file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Service definition file must contain an array.");
  }
  return parsed.map((value, index) => {
    const entry = value ?? {};
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const monthlyPriceUsd =
      typeof entry.monthlyPriceUsd === "number" ? entry.monthlyPriceUsd : NaN;
    if (!name) {
      throw new Error(`Service at index ${index} is missing a valid 'name'.`);
    }
    if (!Number.isFinite(monthlyPriceUsd) || monthlyPriceUsd <= 0) {
      throw new Error(`Service '${name}' is missing a valid 'monthlyPriceUsd'.`);
    }

    return {
      name,
      monthlyPriceUsd,
      details: typeof entry.details === "string" ? entry.details : undefined,
      logoUrl: typeof entry.logoUrl === "string" ? entry.logoUrl : undefined,
      provider: typeof entry.provider === "string" ? entry.provider : undefined,
    };
  });
}

function parseArgs(): ScriptConfig {
  const [, , filePathArg] = process.argv;
  if (!filePathArg) {
    throw new Error(
      "Usage: yarn register-subscription-services <path-to-services.json>"
    );
  }
  return { filePath: filePathArg };
}

function toUsdcAmount(amountUsd: number): anchor.BN {
  const scaled = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  return new anchor.BN(scaled.toString());
}

async function main() {
  const { filePath } = parseArgs();
  const services = readServices(filePath);
  if (services.length === 0) {
    console.log("No services to register.");
    return;
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SublyArcium as Program<SublyArcium>;
  const ctx = await createArciumContext(program);
  await ctx.ensureCompDef(
    "register_subscription_service_subly",
    "initRegisterSubscriptionServiceSublyCompDef"
  );

  const wallet = ctx.wallet;
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(REGISTRY_SEED)],
    program.programId
  );

  const registryAccount = await program.account.subscriptionRegistry.fetch(registryPda);
  if (registryAccount.pendingComputationOffset) {
    throw new Error(
      "Subscription registry has a pending computation. Wait for it to finalize before registering new services."
    );
  }

  const existingCache = loadServiceCache();
  const existingNames = new Set(existingCache.map((svc) => svc.name.toLowerCase()));

  let pendingRegistrations = services.filter(
    (svc) => !existingNames.has(svc.name.toLowerCase())
  );
  if (pendingRegistrations.length === 0) {
    console.log("All services in the definition file are already present in the local cache.");
    return;
  }

  console.log(
    `Loaded ${services.length} definition(s). ${pendingRegistrations.length} require registration.`
  );
  console.log(`Program ID : ${program.programId.toBase58()}`);
  console.log(`Registry PDA: ${registryPda.toBase58()}`);
  console.log("------------------------------------------------------------");

  let nextServiceId = new anchor.BN(registryAccount.nextServiceId.toString());

  for (const service of pendingRegistrations) {
    const idBuffer = nextServiceId.toArrayLike(Buffer, "le", 8);
    const [servicePda] = PublicKey.findProgramAddressSync(
      [Buffer.from(REGISTRY_SEED), idBuffer],
      program.programId
    );

    const existing = await program.account.subscriptionServiceAccount.fetchNullable(servicePda);
    if (existing) {
      console.log(
        `Skipping '${service.name}' – on-chain service already exists with ID ${existing.id.toNumber()}.`
      );
      nextServiceId = nextServiceId.addn(1);
      continue;
    }

    const monthlyPriceUsdc = toUsdcAmount(service.monthlyPriceUsd);
    const computationOffset = randomComputationOffset();
    const baseAccounts = ctx.baseAccounts(
      "register_subscription_service_subly",
      computationOffset
    );

    console.log(
      `Registering service '${service.name}' with expected ID ${nextServiceId.toNumber()}...`
    );

    const signature = await program.methods
      .registerSubscriptionService(computationOffset, {
        name: service.name,
        monthlyPriceUsdc,
        details: service.details ?? "",
        logoUrl: service.logoUrl ?? "",
        provider: service.provider ?? "",
      })
      .accounts({
        payer: wallet.publicKey,
        creator: wallet.publicKey,
        subscriptionRegistry: registryPda,
        subscriptionService: servicePda,
        systemProgram: SystemProgram.programId,
        ...baseAccounts,
      })
      .signers([wallet.payer])
      .rpc({ commitment: ctx.defaultCommitment });

    console.log(`  → Submitted transaction: ${signature}`);

    const finalizeSig = await waitForFinalization(ctx, computationOffset);
    console.log(`  → Finalized via: ${finalizeSig}`);

    upsertServiceEntry({
      id: nextServiceId.toNumber(),
      name: service.name,
      monthlyPriceUsdc: monthlyPriceUsdc.toString(),
      monthlyPriceUsd: service.monthlyPriceUsd,
      details: service.details,
      logoUrl: service.logoUrl,
      provider: service.provider,
    });

    existingNames.add(service.name.toLowerCase());
    nextServiceId = nextServiceId.addn(1);
  }

  console.log("Service registration completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to register services", error);
    process.exit(1);
  });
