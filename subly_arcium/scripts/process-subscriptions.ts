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
import { decodeProgramEvents } from "./utils/events";
import {
  PayPalClient,
  formatUsdc,
  recipientHashKeyFromParts,
} from "./paypal-client";
import { loadServiceMap } from "./utils/service-cache";
import type { ServiceCacheEntry } from "./utils/service-cache";

const CONFIG_SEED = "config";
const USER_SUBSCRIPTIONS_SEED = "user_subscriptions";
const DEFAULT_LOOK_AHEAD_SECONDS = 24 * 60 * 60;
const RECIPIENT_MAP_DEFAULT = path.resolve(__dirname, "paypal-recipients.json");

type RecipientCacheEntry = {
  hash: string;
  recipientType: string;
  receiver: string;
};

type SubscriptionsDueEvent = {
  user: PublicKey;
  recipientType: string;
  receiverHashLow: anchor.BN;
  receiverHashHigh: anchor.BN;
  entries: DueEntry[];
};

type DueEntry = {
  subscriptionId: anchor.BN;
  serviceId: anchor.BN;
  monthlyPriceUsdc: anchor.BN;
  dueTs: anchor.BN;
  initialPaymentRecorded: boolean;
};

const commitment =
  (process.env.COMMITMENT as anchor.web3.Commitment) ?? "confirmed";
const LOOK_AHEAD_SECONDS = Number(
  process.env.LOOK_AHEAD_SECONDS ?? DEFAULT_LOOK_AHEAD_SECONDS
);
const RECIPIENT_MAP_PATH = process.env.RECIPIENT_MAP_PATH
  ? path.resolve(process.env.RECIPIENT_MAP_PATH)
  : RECIPIENT_MAP_DEFAULT;
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

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SublyArcium as Program<SublyArcium>;
  const ctx = await createArciumContext(program, commitment);
  await ctx.ensureCompDef(
    "find_due_subscriptions_subly",
    "initFindDueSubscriptionsSublyCompDef"
  );
  await ctx.ensureCompDef(
    "record_subscription_payment_subly",
    "initRecordSubscriptionPaymentSublyCompDef"
  );

  const wallet = ctx.wallet;
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId
  );

  const config = await program.account.sublyConfig.fetch(configPda);
  if (!config.authority.equals(wallet.publicKey)) {
    throw new Error(
      `Wallet ${wallet.publicKey.toBase58()} is not the config authority (${config.authority.toBase58()}).`
    );
  }

  const recipientMap = loadRecipientMap(RECIPIENT_MAP_PATH);
  const serviceMap = loadServiceMap();
  const allUserSubscriptions = await program.account.userSubscriptionsAccount.all();

  if (allUserSubscriptions.length === 0) {
    console.log("No user subscription accounts found. Nothing to process.");
    return;
  }

  const payPalClient = new PayPalClient({
    baseUrl: PAYPAL_API_BASE,
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
  });

  console.log(
    `Scanning ${allUserSubscriptions.length} user subscription accounts with look-ahead ${LOOK_AHEAD_SECONDS} seconds...`
  );

  let processedUsers = 0;
  let processedPayments = 0;

  for (const accountInfo of allUserSubscriptions) {
    const userSubscriptions = accountInfo.account as any;
    const owner: PublicKey | undefined = userSubscriptions.owner;
    if (!owner || owner.equals(PublicKey.default)) {
      continue;
    }

    const dueEvent = await findDueSubscriptionsForUser(
      ctx,
      program,
      configPda,
      owner,
      accountInfo.publicKey
    );

    if (!dueEvent || dueEvent.entries.length === 0) {
      continue;
    }

    processedUsers += 1;
    for (const entry of dueEvent.entries) {
      const success = await handleDueEntry(
        ctx,
        program,
        payPalClient,
        dueEvent,
        entry,
        configPda,
        accountInfo.publicKey,
        serviceMap,
        recipientMap
      );
      if (success) {
        processedPayments += 1;
      }
    }
  }

  console.log(
    `Processed ${processedPayments} subscription payments across ${processedUsers} user(s).`
  );
}

async function findDueSubscriptionsForUser(
  ctx: Awaited<ReturnType<typeof createArciumContext>>,
  program: Program<SublyArcium>,
  configPda: PublicKey,
  user: PublicKey,
  userSubscriptionsPda: PublicKey
): Promise<SubscriptionsDueEvent | null> {
  const computationOffset = randomComputationOffset();
  const baseAccounts = ctx.baseAccounts(
    "find_due_subscriptions_subly",
    computationOffset
  );

  await program.methods
    .findDueSubscriptions(computationOffset, {
      lookAheadSeconds: new anchor.BN(LOOK_AHEAD_SECONDS),
    })
    .accounts({
      payer: ctx.wallet.publicKey,
      config: configPda,
      user,
      userSubscriptions: userSubscriptionsPda,
      systemProgram: SystemProgram.programId,
      ...baseAccounts,
    })
    .signers([ctx.wallet.payer])
    .rpc({ commitment: ctx.defaultCommitment });

  const finalizeSig = await waitForFinalization(ctx, computationOffset, commitment);
  const events = await decodeProgramEvents(program, finalizeSig, commitment);
  const dueEvent = events.find(
    (evt) => evt.name === "subscriptionsDueForUser"
  ) as { data: SubscriptionsDueEvent } | undefined;

  return dueEvent?.data ?? null;
}

async function handleDueEntry(
  ctx: Awaited<ReturnType<typeof createArciumContext>>,
  program: Program<SublyArcium>,
  payPalClient: PayPalClient,
  dueEvent: SubscriptionsDueEvent,
  entry: DueEntry,
  configPda: PublicKey,
  userSubscriptionsPda: PublicKey,
  serviceMap: Map<number, ServiceCacheEntry>,
  recipientMap: Map<string, RecipientCacheEntry>
): Promise<boolean> {
  const monthlyPriceUsdc = new anchor.BN(entry.monthlyPriceUsdc);
  const serviceId = entry.serviceId.toNumber();
  const serviceMeta = serviceMap.get(serviceId);
  const serviceName = serviceMeta?.name ?? `service-${serviceId}`;

  const recipientKey = recipientHashKeyFromParts(
    dueEvent.receiverHashLow,
    dueEvent.receiverHashHigh
  );
  const recipientInfo = recipientMap.get(recipientKey);
  if (!recipientInfo) {
    console.warn(
      `Missing recipient mapping for hash ${recipientKey}. Unable to send payout for subscription ${entry.subscriptionId.toString()}.`
    );
    return false;
  }

  const dueDateIso = new Date(Number(entry.dueTs.toString()) * 1000).toISOString();
  console.log(
    `\nProcessing subscription ${entry.subscriptionId.toString()} for user ${dueEvent.user.toBase58()} (${serviceName}) due at ${dueDateIso}`
  );
  console.log(`  Recipient    : ${recipientInfo.recipientType}:${recipientInfo.receiver}`);
  console.log(`  Amount       : ${formatUsdc(monthlyPriceUsdc)} USDC`);

  await payPalClient.createPayout({
    recipientType: recipientInfo.recipientType,
    receiver: recipientInfo.receiver,
    monthlyPriceUsdc,
    serviceName,
    subscriptionId: entry.subscriptionId,
  });

  const computationOffset = randomComputationOffset();
  const baseAccounts = ctx.baseAccounts(
    "record_subscription_payment_subly",
    computationOffset
  );

  const signature = await program.methods
    .recordSubscriptionPayment(computationOffset, {
      subscriptionId: entry.subscriptionId,
      paymentTs: null,
    })
    .accounts({
      payer: ctx.wallet.publicKey,
      config: configPda,
      user: dueEvent.user,
      userSubscriptions: userSubscriptionsPda,
      systemProgram: SystemProgram.programId,
      ...baseAccounts,
    })
    .signers([ctx.wallet.payer])
    .rpc({ commitment: ctx.defaultCommitment });

  console.log(`  → Payment recorded on-chain. Tx: ${signature}`);

  const finalizeSig = await waitForFinalization(ctx, computationOffset, commitment);
  const events = await decodeProgramEvents(program, finalizeSig, commitment);
  const paymentEvent = events.find(
    (evt) => evt.name === "subscriptionPaymentRecorded"
  );
  if (paymentEvent) {
    const status = paymentEvent.data?.status ?? "UNKNOWN";
    const nextBilling = paymentEvent.data?.nextBillingTs
      ? new Date(Number(paymentEvent.data.nextBillingTs.toString()) * 1000).toISOString()
      : "n/a";
    console.log(
      `  → Finalized via ${finalizeSig}. Status: ${status}. Next billing: ${nextBilling}`
    );
  } else {
    console.log(`  → Finalized via ${finalizeSig}.`);
  }

  return true;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Batch processing failed", error);
    process.exit(1);
  });
