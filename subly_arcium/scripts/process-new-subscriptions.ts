import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { Finality, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";
import path from "path";

import type { SublyArcium } from "../target/types/subly_arcium";
import {
  createArciumContext,
  randomComputationOffset,
  waitForFinalization,
} from "./utils/arcium";
import { PayPalClient, recipientHashKeyFromParts, formatUsdc } from "./paypal-client";
import { loadServiceMap } from "./utils/service-cache";
import type { ServiceCacheEntry } from "./utils/service-cache";
import { decodeProgramEvents } from "./utils/events";

const CONFIG_SEED = "config";
const USER_SUBSCRIPTIONS_SEED = "user_subscriptions";
const RECIPIENT_MAP_DEFAULT = path.resolve(__dirname, "paypal-recipients.json");
const PROCESSED_TRACKER_DEFAULT = path.resolve(
  __dirname,
  "processed-activations.json"
);

type RecipientCacheEntry = {
  hash: string;
  recipientType: string;
  receiver: string;
};

type ProcessedTrackerFile = {
  processed: string[];
};

type ActivationEvent = {
  user: PublicKey;
  subscriptionId: anchor.BN;
  serviceId: anchor.BN;
  recipientType: string;
  receiverHashLow: anchor.BN;
  receiverHashHigh: anchor.BN;
};

const finality: Finality = (process.env.COMMITMENT as Finality) ?? "confirmed";
const START_SLOT = Number(process.env.NEW_SUBS_START_SLOT ?? 0);
const FETCH_LIMIT = Number(process.env.NEW_SUBS_FETCH_LIMIT ?? 100);
const MAX_TRANSACTIONS = Number(process.env.NEW_SUBS_MAX_TX ?? 1_000);
const RECIPIENT_MAP_PATH = process.env.RECIPIENT_MAP_PATH
  ? path.resolve(process.env.RECIPIENT_MAP_PATH)
  : RECIPIENT_MAP_DEFAULT;
const PROCESSED_TRACKER_PATH = process.env.PROCESSED_ACTIVATIONS_PATH
  ? path.resolve(process.env.PROCESSED_ACTIVATIONS_PATH)
  : PROCESSED_TRACKER_DEFAULT;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

function loadRecipientMap(filePath: string): Map<string, RecipientCacheEntry> {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Recipient map must be an array.");
    }
    const entries = parsed.flatMap((value) => {
      const entry = value ?? {};
      if (
        typeof entry.hash === "string" &&
        typeof entry.receiver === "string" &&
        typeof entry.recipientType === "string"
      ) {
        return [
          {
            hash: entry.hash,
            receiver: entry.receiver,
            recipientType: entry.recipientType,
          } satisfies RecipientCacheEntry,
        ];
      }
      return [];
    });
    return new Map(entries.map((entry) => [entry.hash, entry]));
  } catch (err) {
    throw new Error(`Failed to read recipient map '${filePath}': ${String(err)}`);
  }
}

function loadProcessedActivations(filePath: string): Set<string> {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ProcessedTrackerFile;
    if (!parsed || !Array.isArray(parsed.processed)) {
      throw new Error("Invalid processed tracker schema.");
    }
    return new Set(parsed.processed);
  } catch (err) {
    throw new Error(
      `Failed to read processed activation tracker '${filePath}': ${String(err)}`
    );
  }
}

function persistProcessedActivations(filePath: string, values: Set<string>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload: ProcessedTrackerFile = {
    processed: Array.from(values.values()).sort(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function activationKey(user: PublicKey, subscriptionId: anchor.BN): string {
  return `${user.toBase58()}:${subscriptionId.toString()}`;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SublyArcium as Program<SublyArcium>;
  const ctx = await createArciumContext(program);
  await ctx.ensureCompDef(
    "record_subscription_payment_subly",
    "initRecordSubscriptionPaymentSublyCompDef"
  );

  const wallet = ctx.wallet;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId
  );

  const configAccount = await program.account.sublyConfig.fetch(configPda);
  if (!configAccount.authority.equals(wallet.publicKey)) {
    throw new Error(
      `Wallet ${wallet.publicKey.toBase58()} is not the config authority (${configAccount.authority.toBase58()}).`
    );
  }

  const serviceMap = loadServiceMap();
  const recipientMap = loadRecipientMap(RECIPIENT_MAP_PATH);
  const processedActivations = loadProcessedActivations(PROCESSED_TRACKER_PATH);

  const payPalClient = new PayPalClient({
    baseUrl: PAYPAL_API_BASE,
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
  });

  let processed = 0;
  let before: string | undefined = process.env.NEW_SUBS_BEFORE_SIGNATURE;
  let finished = false;

  console.log("Scanning for SubscriptionActivated events...");
  console.log(`Recipient map entries : ${recipientMap.size}`);
  console.log(`Processed activations : ${processedActivations.size}`);
  console.log(`Start slot threshold  : ${START_SLOT}`);

  while (!finished && processed < MAX_TRANSACTIONS) {
    const signatures = await provider.connection.getSignaturesForAddress(
      program.programId,
      { before, limit: FETCH_LIMIT },
      finality
    );

    if (signatures.length === 0) {
      break;
    }

    for (const info of signatures) {
      before = info.signature;
      if (info.err) {
        continue;
      }
      if (info.slot < START_SLOT) {
        finished = true;
        break;
      }

      const events = await decodeProgramEvents(program, info.signature, finality);
      if (events.length === 0) {
        continue;
      }

      const activations = events.filter(
        (event) => event.name === "subscriptionActivated"
      ) as Array<{ name: string; data: ActivationEvent }>;
      if (activations.length === 0) {
        continue;
      }

      for (const evt of activations) {
        const activation = evt.data;
        await handleActivation(
          ctx,
          program,
          payPalClient,
          activation,
          configPda,
          serviceMap,
          recipientMap,
          processedActivations
        );
      }

      processed += 1;
      if (processed >= MAX_TRANSACTIONS) {
        break;
      }
    }
  }

  persistProcessedActivations(PROCESSED_TRACKER_PATH, processedActivations);

  console.log(`Processed ${processed} transactions containing SubscriptionActivated events.`);
}

async function handleActivation(
  ctx: Awaited<ReturnType<typeof createArciumContext>>,
  program: Program<SublyArcium>,
  payPalClient: PayPalClient,
  activation: ActivationEvent,
  configPda: PublicKey,
  serviceMap: Map<number, ServiceCacheEntry>,
  recipientMap: Map<string, RecipientCacheEntry>,
  processedActivations: Set<string>
): Promise<void> {
  const subscriptionKey = activationKey(
    activation.user,
    activation.subscriptionId
  );
  if (processedActivations.has(subscriptionKey)) {
    return;
  }

  const serviceId = activation.serviceId.toNumber();
  const serviceMeta = serviceMap.get(serviceId);
  if (!serviceMeta) {
    console.warn(
      `  -> Missing service metadata for ID ${serviceId}. Update local cache before processing.`
    );
    return;
  }

  const recipientKey = recipientHashKeyFromParts(
    activation.receiverHashLow,
    activation.receiverHashHigh
  );
  const recipientInfo = recipientMap.get(recipientKey);
  if (!recipientInfo) {
    console.warn(
      `  -> Missing recipient mapping for hash ${recipientKey}. Unable to send payout.`
    );
    return;
  }

  const monthlyPriceUsdc = new anchor.BN(serviceMeta.monthlyPriceUsdc);
  console.log(
    `\nInitial payout for subscription ${activation.subscriptionId.toString()} (service ${serviceMeta.name})`
  );
  console.log(`  User         : ${activation.user.toBase58()}`);
  console.log(`  Recipient    : ${recipientInfo.recipientType}:${recipientInfo.receiver}`);
  console.log(`  Monthly price: ${formatUsdc(monthlyPriceUsdc)} USDC`);

  await payPalClient.createPayout({
    recipientType: recipientInfo.recipientType,
    receiver: recipientInfo.receiver,
    monthlyPriceUsdc,
    serviceName: serviceMeta.name,
    subscriptionId: activation.subscriptionId,
  });

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(USER_SUBSCRIPTIONS_SEED), activation.user.toBuffer()],
    program.programId
  );

  const computationOffset = randomComputationOffset();
  const baseAccounts = ctx.baseAccounts(
    "record_subscription_payment_subly",
    computationOffset
  );

  const signature = await program.methods
    .recordSubscriptionPayment(computationOffset, {
      subscriptionId: activation.subscriptionId,
      paymentTs: null,
    })
    .accounts({
      payer: ctx.wallet.publicKey,
      config: configPda,
      user: activation.user,
      userSubscriptions: userSubscriptionsPda,
      systemProgram: SystemProgram.programId,
      ...baseAccounts,
    })
    .signers([ctx.wallet.payer])
    .rpc({ commitment: ctx.defaultCommitment });

  console.log(`  → Recorded payment. Tx: ${signature}`);

  const finalizeSig = await waitForFinalization(ctx, computationOffset);
  console.log(`  → Finalized via: ${finalizeSig}`);

  processedActivations.add(subscriptionKey);
  persistProcessedActivations(PROCESSED_TRACKER_PATH, processedActivations);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Initial subscription batch failed", error);
    process.exit(1);
  });
