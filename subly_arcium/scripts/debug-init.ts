import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import { randomBytes } from "crypto";
import { awaitComputationFinalization } from "@arcium-hq/client";
import { createArciumContext } from "./utils/arcium";

const randomOffset = () => new BN(randomBytes(8));

async function main() {
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const wallet = provider.wallet as anchor.Wallet;

  console.log("Provider:", provider.connection.rpcEndpoint);
  console.log("Wallet:", wallet.publicKey.toBase58());

  const program = anchor.workspace.SublyArcium as anchor.Program<any>;

  const sig = await provider.connection.requestAirdrop(
    wallet.publicKey,
    10 * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  console.log("Airdrop signature:", sig);

  const arciumCtx = await createArciumContext(program as any);
  const { baseAccounts, ensureCompDef } = arciumCtx;
  const sample = baseAccounts("initialize_subly", new BN(1));
  console.log("Raw base accounts signPdaAccount:", sample.signPdaAccount?.toBase58?.());

  const mint = await createMint(
    provider.connection,
    wallet.payer,
    wallet.publicKey,
    null,
    6
  );
  console.log("Mint:", mint.toBase58());

  const userKeypair = anchor.web3.Keypair.generate();
  const userAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    wallet.payer,
    mint,
    userKeypair.publicKey
  );

  const authorityAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    wallet.payer,
    mint,
    wallet.publicKey
  );

  await mintTo(
    provider.connection,
    wallet.payer,
    mint,
    userAta.address,
    wallet.payer,
    BigInt(10_000_000_000)
  );

  await mintTo(
    provider.connection,
    wallet.payer,
    mint,
    authorityAta.address,
    wallet.payer,
    BigInt(10_000_000_000)
  );

  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  )[0];
  const registryPda = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_registry")],
    program.programId
  )[0];
  const vaultPda = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  )[0];

  await ensureCompDef("initialize_subly", "initInitializeSublyCompDef");

  const initOffset = randomOffset();
  console.log("Initialize offset:", initOffset.toString());

  try {
    const txSig = await program.methods
      .initialize(initOffset, { authority: wallet.publicKey })
      .accounts({
        payer: wallet.publicKey,
        usdcMint: mint,
        config: configPda,
        subscriptionRegistry: registryPda,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        ...baseAccounts("initialize_subly", initOffset),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    console.log("Initialize txn:", txSig);

    await awaitComputationFinalization(
      provider,
      initOffset,
      program.programId,
      "confirmed"
    );
    console.log("Computation finalized");
  } catch (err: any) {
    console.error("Initialize error:", err);
    if (err.logs) {
      console.error("Logs:", err.logs);
    } else if (err.error?.logs) {
      console.error("Logs:", err.error.logs);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
