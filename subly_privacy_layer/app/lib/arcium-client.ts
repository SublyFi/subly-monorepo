/**
 * Arcium MPC Client Utilities for Subly
 * Handles encryption, decryption, and MPC computation interactions
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  RescueCipher,
  x25519,
  getMXEPublicKey as getArciumMXEPublicKey,
} from "@arcium-hq/client";
import { randomBytes } from "crypto";
import { AnchorProvider } from "@coral-xyz/anchor";

// Re-export RescueCipher for use in other modules
export { RescueCipher };

/**
 * Get MXE public key for the Subly program
 * @param connection - Solana connection
 * @param programId - MXE program ID
 * @returns MXE public key as Uint8Array
 */
export async function getMXEPublicKey(
  connection: Connection,
  programId: PublicKey
): Promise<Uint8Array> {
  // Create a minimal AnchorProvider for the Arcium SDK
  // Note: wallet is not needed for read-only operations
  const provider = new AnchorProvider(
    connection,
    {} as any, // Wallet not needed for read-only
    AnchorProvider.defaultOptions()
  );

  const mxePublicKey = await getArciumMXEPublicKey(provider, programId);

  if (!mxePublicKey) {
    throw new Error("MXE account not found or public key not set");
  }

  return mxePublicKey;
}

/**
 * Generate a client keypair for encryption
 * @returns Object with private key, public key, and cipher
 */
export function generateClientKeypair(mxePublicKey: Uint8Array) {
  const clientSecretKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientSecretKey);
  const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);

  return {
    secretKey: clientSecretKey,
    publicKey: clientPublicKey,
    cipher: new RescueCipher(sharedSecret),
  };
}

/**
 * Create encryption bundle for Enc<Shared, T> types
 * All encrypted values must share the same nonce and encryption key
 */
export function createSharedEncryptionBundle(
  cipher: RescueCipher,
  values: bigint[],
  clientPublicKey: Uint8Array
): {
  nonce: Uint8Array;
  encryptionKey: Uint8Array;
  ciphertexts: number[][];
} {
  const nonce = randomBytes(16);
  const ciphertexts = cipher.encrypt(values, nonce);

  return {
    nonce,
    encryptionKey: clientPublicKey,
    ciphertexts: ciphertexts.map((ct) => Array.from(ct)),
  };
}

/**
 * Decrypt a confidential bundle
 */
export function decryptConfidentialBundle(
  cipher: RescueCipher,
  bundle: {
    ciphertexts: number[][];
    ciphertextCount: number;
    nonce: number[];
  }
): bigint[] {
  const ciphertexts = bundle.ciphertexts.slice(0, bundle.ciphertextCount);
  const nonce = Uint8Array.from(bundle.nonce);

  return cipher.decrypt(ciphertexts, nonce);
}

/**
 * Wait for computation to be finalized by Arcium MXE network
 * @param connection - Solana connection
 * @param computationOffset - Computation offset BN
 * @param programId - Subly program ID
 * @param maxRetries - Maximum number of retries
 * @param retryDelay - Delay between retries in ms
 * @returns Transaction signature of finalization
 */
export async function awaitComputationFinalization(
  connection: Connection,
  computationOffset: bigint,
  programId: PublicKey,
  maxRetries = 60,
  retryDelay = 2000
): Promise<string> {
  // Derive computation account PDA
  const offsetBytes = Buffer.alloc(8);
  offsetBytes.writeBigUInt64LE(computationOffset);

  const [computationAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("computation"), offsetBytes],
    new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6") // Arcium program ID
  );

  let attempts = 0;
  while (attempts < maxRetries) {
    const accountInfo = await connection.getAccountInfo(computationAccount);

    if (accountInfo) {
      // Check if computation is finalized
      // The account data structure varies, but typically:
      // - discriminator(8)
      // - status field indicating finalization

      // For simplicity, we'll check for specific status bytes
      // This needs to be adjusted based on actual Arcium account structure
      const status = accountInfo.data.readUInt8(8);

      if (status === 2) {
        // Assuming 2 = Finalized
        // Get the transaction signature from recent confirmed transactions
        const signatures = await connection.getSignaturesForAddress(
          computationAccount,
          { limit: 1 }
        );

        if (signatures.length > 0) {
          return signatures[0].signature;
        }
      }
    }

    attempts++;
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  throw new Error(
    `Computation finalization timeout after ${
      (maxRetries * retryDelay) / 1000
    }s`
  );
}

/**
 * Generate computation offset for MPC instruction
 */
export function generateComputationOffset(): bigint {
  const bytes = randomBytes(8);
  return bytes.readBigUInt64LE(0);
}

/**
 * Arcium program ID (mainnet/devnet)
 */
export const ARCIUM_PROGRAM_ID = new PublicKey(
  "BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6"
);

/**
 * Arcium fee pool account
 */
export const ARCIUM_FEE_POOL_ACCOUNT = new PublicKey([
  94, 87, 49, 175, 232, 200, 92, 37, 140, 243, 194, 109, 249, 141, 31, 66, 59,
  91, 113, 165, 232, 167, 54, 30, 164, 219, 3, 225, 61, 227, 94, 8,
]);

/**
 * Arcium clock account
 */
export const ARCIUM_CLOCK_ACCOUNT = new PublicKey([
  212, 85, 34, 0, 53, 147, 95, 180, 158, 156, 108, 40, 138, 177, 241, 37, 193,
  113, 49, 48, 98, 57, 195, 10, 201, 244, 92, 111, 3, 191, 25, 130,
]);

/**
 * Get cluster account address for Arcium
 */
export function getClusterAccountAddress(clusterId: number): PublicKey {
  const clusterIdBytes = Buffer.alloc(4);
  clusterIdBytes.writeUInt32LE(clusterId);

  const [clusterAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("cluster"), clusterIdBytes],
    ARCIUM_PROGRAM_ID
  );

  return clusterAccount;
}

/**
 * Get computation definition account address
 */
export function getCompDefAccountAddress(
  programId: PublicKey,
  offset: number
): PublicKey {
  const offsetBytes = Buffer.alloc(4);
  offsetBytes.writeUInt32LE(offset);

  const [compDefAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("comp_def"), offsetBytes],
    programId
  );

  return compDefAccount;
}

/**
 * Derive all Arcium-related accounts for subscribe_service instruction
 */
export function getArciumAccounts(
  programId: PublicKey,
  computationOffset: bigint
) {
  const SIGNER_ACCOUNT_SEED = Buffer.from("SignerAccount");

  const [signPdaAccount] = PublicKey.findProgramAddressSync(
    [SIGNER_ACCOUNT_SEED],
    programId
  );

  const [mxeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("mxe")],
    ARCIUM_PROGRAM_ID
  );

  const [mempoolAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("mempool")],
    programId
  );

  const [executingPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("executing_pool")],
    programId
  );

  const offsetBytes = Buffer.alloc(8);
  offsetBytes.writeBigUInt64LE(computationOffset);

  const [computationAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("computation"), offsetBytes],
    programId
  );

  // Get computation definition offset for subscribe_service
  // This should match the value from build/subscribe_service.arcis
  const compDefOffset = 2598735807; // From test output
  const compDefAccount = getCompDefAccountAddress(programId, compDefOffset);

  const clusterAccount = getClusterAccountAddress(0); // Cluster ID 0

  return {
    signPdaAccount,
    mxeAccount,
    mempoolAccount,
    executingPool,
    computationAccount,
    compDefAccount,
    clusterAccount,
    arciumProgram: ARCIUM_PROGRAM_ID,
  };
}
