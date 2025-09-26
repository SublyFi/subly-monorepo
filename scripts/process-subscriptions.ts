import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { ConfirmOptions, PublicKey } from "@solana/web3.js";

import { SublySolanaProgram } from "../target/types/subly_solana_program";
import {
  PayPalClient,
  buildDueEntryPayload,
  formatUsdc,
  httpRequest,
} from "./paypal-client";

const DEFAULT_LOOK_AHEAD_SECONDS = 24 * 60 * 60; // 24 hours
const DEFAULT_CHUNK_SIZE = 16;

const SEED_CONFIG = "config";
const SEED_REGISTRY = "subscription_registry";
const SEED_USER_SUBSCRIPTIONS = "user_subscriptions";

const commitment: ConfirmOptions["commitment"] = (process.env.COMMITMENT as ConfirmOptions["commitment"]) ?? "confirmed";
const LOOK_AHEAD_SECONDS = Number(process.env.LOOK_AHEAD_SECONDS ?? DEFAULT_LOOK_AHEAD_SECONDS);
const CHUNK_SIZE = Number(process.env.BATCH_SIZE ?? DEFAULT_CHUNK_SIZE);
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

  const allUserSubscriptions = await program.account.userSubscriptions.all();
  if (allUserSubscriptions.length === 0) {
    console.log("No user subscription accounts found. Nothing to do.");
    return;
  }

  console.log(
    `Scanning ${allUserSubscriptions.length} user subscription accounts with look-ahead ${LOOK_AHEAD_SECONDS} seconds...`,
  );

  const eventCoder = new anchor.BorshEventCoder(program.idl);
  const payPalClient = new PayPalClient({
    baseUrl: PAYPAL_API_BASE,
    clientId: PAYPAL_CLIENT_ID,
    clientSecret: PAYPAL_CLIENT_SECRET,
  });

  const chunks = chunkAccounts(allUserSubscriptions.map((account) => account.publicKey), CHUNK_SIZE);
  for (const batch of chunks) {
    const remainingAccounts = batch.map((pda) => ({
      pubkey: pda,
      isSigner: false,
      isWritable: false,
    }));

    const signature = await program.methods
      .findDueSubscriptions({ lookAheadSeconds: new BN(LOOK_AHEAD_SECONDS) })
      .accounts({
        config: configPda,
        subscriptionRegistry: registryPda,
      })
      .remainingAccounts(remainingAccounts)
      .rpc({ commitment });

    const events = await decodeEvents(provider, eventCoder, signature);
    const dueEvent = events.find((event) => event.name.toLowerCase() === "subscriptionsdue");
    if (!dueEvent || dueEvent.data.entries.length === 0) {
      continue;
    }

    console.log(`Found ${dueEvent.data.entries.length} subscriptions due in tx ${signature}`);

    for (const rawEntry of dueEvent.data.entries as Array<DueEntryRaw>) {
      await handleDueEntry(program, configPda, payPalClient, rawEntry);
    }
  }

  console.log("Batch processing completed.");
}

type DueEntryRaw = {
  user: PublicKey;
  subscriptionId: BN;
  serviceId: BN;
  serviceName: string;
  monthlyPriceUsdc: BN;
  recipientType: string;
  receiver: string;
  dueTs: BN;
};

async function handleDueEntry(
  program: Program<SublySolanaProgram>,
  configPda: PublicKey,
  payPalClient: PayPalClient,
  entry: DueEntryRaw,
) {
  console.log(
    `\nProcessing subscription ${entry.subscriptionId.toNumber()} for user ${entry.user.toBase58()} ` +
      `(${entry.serviceName}) due at ${entry.dueTs.toNumber()}`,
  );

  await payPalClient.createPayout(
    buildDueEntryPayload({
      recipientType: entry.recipientType,
      receiver: entry.receiver,
      monthlyPriceUsdc: entry.monthlyPriceUsdc,
      serviceName: entry.serviceName,
      subscriptionId: entry.subscriptionId,
    }),
  );

  const [userSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_USER_SUBSCRIPTIONS), entry.user.toBuffer()],
    program.programId,
  );

  const signature = await program.methods
    .recordSubscriptionPayment({
      subscriptionId: entry.subscriptionId,
      paymentTs: null,
    })
    .accounts({
      config: configPda,
      operator: program.provider.wallet.publicKey,
      user: entry.user,
      userSubscriptions: userSubscriptionsPda,
    })
    .rpc();

  console.log(`Payment recorded on-chain. Tx: ${signature}`);
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
      commitment,
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

function chunkAccounts(accounts: PublicKey[], chunkSize: number): PublicKey[][] {
  const chunks: PublicKey[][] = [];
  for (let i = 0; i < accounts.length; i += chunkSize) {
    chunks.push(accounts.slice(i, i + chunkSize));
  }
  return chunks;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Batch processing failed", err);
    process.exit(1);
  });
