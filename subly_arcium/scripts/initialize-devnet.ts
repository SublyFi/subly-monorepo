import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import type { SublyArcium } from "../target/types/subly_arcium";
import {
  createArciumContext,
  randomComputationOffset,
  waitForFinalization,
} from "./utils/arcium";

const CONFIG_SEED = "config";
const REGISTRY_SEED = "subscription_registry";
const VAULT_SEED = "vault";
const DEFAULT_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SublyArcium as Program<SublyArcium>;
  const ctx = await createArciumContext(program);
  const wallet = ctx.wallet;

  const usdcMint = new PublicKey(process.env.USDC_MINT ?? DEFAULT_USDC_MINT);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId
  );
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(REGISTRY_SEED)],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED)],
    program.programId
  );

  const existingConfig = await program.account.sublyConfig.fetchNullable(configPda);
  if (existingConfig) {
    console.log("Subly config already exists. Nothing to initialize.");
    console.log(`Config PDA : ${configPda.toBase58()}`);
    console.log(`Registry PDA: ${registryPda.toBase58()}`);
    console.log(`Vault PDA   : ${vaultPda.toBase58()}`);
    return;
  }

  await ctx.ensureCompDef("initialize_subly", "initInitializeSublyCompDef");

  const computationOffset = randomComputationOffset();

  console.log("Initializing Subly configuration (Arcium)...");
  console.log(`Program ID : ${program.programId.toBase58()}`);
  console.log(`Authority  : ${wallet.publicKey.toBase58()}`);
  console.log(`USDC mint  : ${usdcMint.toBase58()}`);
  console.log(`Config PDA : ${configPda.toBase58()}`);
  console.log(`Registry PDA: ${registryPda.toBase58()}`);
  console.log(`Vault PDA  : ${vaultPda.toBase58()}`);
  console.log(`Comp offset: ${computationOffset.toString()}`);

  const baseAccounts = ctx.baseAccounts("initialize_subly", computationOffset);

  const signature = await program.methods
    .initialize(computationOffset, { authority: wallet.publicKey })
    .accounts({
      payer: wallet.publicKey,
      usdcMint,
      config: configPda,
      subscriptionRegistry: registryPda,
      vault: vaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      ...baseAccounts,
    })
    .signers([wallet.payer])
    .rpc({ commitment: ctx.defaultCommitment });

  console.log(`Initialize transaction: ${signature}`);

  const finalizeSig = await waitForFinalization(ctx, computationOffset);
  console.log(`Finalized computation via: ${finalizeSig}`);

  const configAccount = await program.account.sublyConfig.fetchNullable(configPda);
  if (!configAccount) {
    throw new Error("Config account missing after initialization.");
  }

  console.log("Initialization completed successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to initialize Subly config", error);
    process.exit(1);
  });
