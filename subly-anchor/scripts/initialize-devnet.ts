import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { SublySolanaProgram } from "../target/types/subly_solana_program";

const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

const CONFIG_SEED = "config";
const SUBSCRIPTION_REGISTRY_SEED = "subscription_registry";
const VAULT_SEED = "vault";

async function main() {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  const program = anchor.workspace.SublySolanaProgram as Program<SublySolanaProgram>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId,
  );
  const [subscriptionRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SUBSCRIPTION_REGISTRY_SEED)],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_SEED)],
    program.programId,
  );

  const existingConfig = await connection.getAccountInfo(configPda);
  if (existingConfig) {
    console.log("Subly config already exists on this cluster. Nothing to do.");
    console.log(`Config PDA: ${configPda.toBase58()}`);
    console.log(`Vault PDA : ${vaultPda.toBase58()}`);
    console.log(`Registry  : ${subscriptionRegistryPda.toBase58()}`);
    return;
  }

  console.log("Initializing Subly config on Devnet...");
  console.log(`Program ID: ${program.programId.toBase58()}`);
  console.log(`Authority : ${wallet.publicKey.toBase58()}`);
  console.log(`USDC mint : ${USDC_DEVNET_MINT.toBase58()}`);
  console.log(`Config PDA: ${configPda.toBase58()}`);
  console.log(`Vault PDA : ${vaultPda.toBase58()}`);
  console.log(`Registry  : ${subscriptionRegistryPda.toBase58()}`);

  const signature = await program.methods
    .initialize({ authority: wallet.publicKey })
    .accountsStrict({
      payer: wallet.publicKey,
      usdcMint: USDC_DEVNET_MINT,
      config: configPda,
      subscriptionRegistry: subscriptionRegistryPda,
      vault: vaultPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log(`Initialization transaction: ${signature}`);

  const configAccount = await connection.getAccountInfo(configPda);
  if (!configAccount) {
    throw new Error("Config account was not created as expected.");
  }

  console.log("Initialization completed successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to initialize Subly config", err);
    process.exit(1);
  });
