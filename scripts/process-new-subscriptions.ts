import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { ConfirmOptions, Finality, PublicKey } from "@solana/web3.js";

import { SublySolanaProgram } from "../target/types/subly_solana_program";
import {
  PayPalClient,
  buildDueEntryPayload,
} from "./paypal-client";

const SEED_CONFIG = "config";
const SEED_USER_SUBSCRIPTIONS = "user_subscriptions";
const SEED_REGISTRY = "subscription_registry";
const BILLING_PERIOD_SECONDS = 30 * 24 * 60 * 60; // must match on-chain constant

const finality: Finality = (process.env.COMMITMENT as Finality) ?? "confirmed";
const START_SLOT = Number(process.env.NEW_SUBS_START_SLOT ?? 0);
const FETCH_LIMIT = Number(process.env.NEW_SUBS_FETCH_LIMIT ?? 100);
const MAX_TRANSACTIONS = Number(process.env.NEW_SUBS_MAX_TX ?? 1000);
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.SublySolanaProgram as Program<SublySolanaProgram>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_CONFIG)],
    program.programId,
  );
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_REGISTRY)],
    program.programId,
  );

  const config = await program.account.sublyConfig.fetch(configPda);
  if (!config.authority.equals(wallet.publicKey)) {
    throw new Error(
      `Wallet ${wallet.publicKey.toBase58()} is not the configured authority (${config.authority.toBase58()}). ` +
        "Use the config authority wallet to run the batch.",
    );
  }

  const eventCoder = new anchor.BorshEventCoder(program.idl);
  const payPalClient = new PayPalClient({
    baseUrl: PAYPAL_API_BASE,
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
  });

  const registry = await program.account.subscriptionRegistry.fetch(registryPda);
  const serviceNameById = new Map<number, string>();
  registry.services.forEach((service) => {
    serviceNameById.set(service.id.toNumber(), service.name);
  });

  let processed = 0;
  let before: string | undefined = process.env.NEW_SUBS_BEFORE_SIGNATURE;
  let finished = false;

  while (!finished && processed < MAX_TRANSACTIONS) {
    const signatures = await provider.connection.getSignaturesForAddress(
      program.programId,
      { before, limit: FETCH_LIMIT },
      finality,
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

      const events = await decodeEvents(provider, eventCoder, info.signature);
      const activations = events.filter(
        (event) => event.name.toLowerCase() === "subscriptionactivated",
      );
      if (activations.length === 0) {
        continue;
      }

      for (const evt of activations) {
        await handleActivation(
          program,
          configPda,
          payPalClient,
          serviceNameById,
          evt.data,
          info.signature,
        );
      }

      processed += 1;
      if (processed >= MAX_TRANSACTIONS) {
        break;
      }
    }
  }

  console.log(`Processed ${processed} transactions for SubscriptionActivated events.`);
}

type ActivationEvent = {
  user: PublicKey;
  subscriptionId: BN;
  serviceId: BN;
  monthlyPriceUsdc: BN;
  recipientType: string;
  receiver: string;
};

async function handleActivation(
  program: Program<SublySolanaProgram>,
  configPda: PublicKey,
  payPalClient: PayPalClient,
  serviceNameById: Map<number, string>,
  activation: ActivationEvent,
  signature: string,
) {
  console.log(
    `\nPayout for new subscription ${activation.subscriptionId.toNumber()} to user ${activation.user.toBase58()} (tx ${signature})`,
  );

  const serviceIdNum = activation.serviceId.toNumber();
  const serviceName = serviceNameById.get(serviceIdNum) ?? `service-${serviceIdNum}`;

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_SUBSCRIPTIONS), activation.user.toBuffer()],
    program.programId,
  );

  const userSubscriptionsAccount = await program.account.userSubscriptions.fetchNullable(
    userSubscriptionsPda,
  );
  if (!userSubscriptionsAccount) {
    console.warn("  -> User subscriptions account not found. Skipping payout.");
    return;
  }

  const subscriptionEntry = userSubscriptionsAccount.subscriptions.find((subscription: any) => {
    if (subscription.id?.eq) {
      return subscription.id.eq(activation.subscriptionId);
    }
    return Number(subscription.id) === activation.subscriptionId.toNumber();
  });

  if (!subscriptionEntry) {
    console.warn("  -> Subscription entry not found in PDA. Skipping payout.");
    return;
  }

  const toNumber = (value: any): number => {
    if (!value) {
      return 0;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "string") {
      return Number(value);
    }
    if (typeof value.toNumber === "function") {
      return value.toNumber();
    }
    if (typeof value.toString === "function") {
      return Number(value.toString());
    }
    return Number(value);
  };

  const startedAt = toNumber(subscriptionEntry.startedAt ?? subscriptionEntry.started_at);
  const lastPaymentTs = toNumber(
    subscriptionEntry.lastPaymentTs ?? subscriptionEntry.last_payment_ts,
  );
  const nextBillingTs = toNumber(
    subscriptionEntry.nextBillingTs ?? subscriptionEntry.next_billing_ts,
  );

  const alreadyProcessed =
    lastPaymentTs > startedAt ||
    nextBillingTs > startedAt + BILLING_PERIOD_SECONDS

  if (alreadyProcessed) {
    console.log("  -> Initial payout already processed. Skipping duplicate.");
    return;
  }

  await payPalClient.createPayout(
    buildDueEntryPayload({
      recipientType: activation.recipientType,
      receiver: activation.receiver,
      monthlyPriceUsdc: activation.monthlyPriceUsdc,
      serviceName,
      subscriptionId: activation.subscriptionId,
    }),
  );

  const paymentSig = await program.methods
    .recordSubscriptionPayment({
      subscriptionId: activation.subscriptionId,
      paymentTs: null,
    })
    .accountsStrict({
      config: configPda,
      operator: program.provider.wallet.publicKey,
      user: activation.user,
      userSubscriptions: userSubscriptionsPda,
    })
    .rpc();

  console.log(`Initial payment recorded on-chain. Tx: ${paymentSig}`);
}

async function decodeEvents(
  provider: AnchorProvider,
  eventCoder: anchor.BorshEventCoder,
  signature: string,
) {
  let attempts = 0;
  let tx = null;
  while (attempts < 5 && !tx) {
    tx = await provider.connection.getTransaction(signature, {
      commitment: finality,
    });
    if (!tx) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    attempts += 1;
  }

  const logs = tx?.meta?.logMessages ?? [];
  const events: Array<{ name: string; data: any }> = [];
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) {
      continue;
    }
    const encoded = log.slice("Program data: ".length);
    try {
      const decoded = eventCoder.decode(encoded);
      if (decoded) {
        events.push(decoded as { name: string; data: any });
      }
    } catch (_err) {
      // ignore
    }
  }
  return events;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Initial subscription batch failed", err);
    process.exit(1);
  });
