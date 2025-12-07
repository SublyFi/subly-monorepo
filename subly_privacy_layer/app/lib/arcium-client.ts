/**
 * Arcium MPC Client Utilities for Subly
 * Handles encryption, decryption, and MPC computation interactions
 */

import { Connection, PublicKey } from "@solana/web3.js";
import {
  RescueCipher,
  x25519,
  getMXEPublicKey as getArciumMXEPublicKey,
  getArciumProgramId,
  getClusterAccAddress,
  getCompDefAccAddress,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
} from "@arcium-hq/client";
import { AnchorProvider } from "@coral-xyz/anchor";
import { createHash, randomBytes } from "crypto";

export { getArciumEnv } from "@arcium-hq/client";

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
  clusterOffset: number,
  maxRetries = 60,
  retryDelay = 2000
): Promise<string> {
  const computationAccount = getComputationAccAddress(
    clusterOffset,
    computationOffset
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
 * Derive computation definition offset from instruction name (matches Rust comp_def_offset)
 */
export function deriveCompDefOffset(instructionName: string): number {
  const hash = createHash("sha256").update(instructionName).digest();
  return hash.readUInt32LE(0);
}

/**
 * Arcium program ID (mainnet/devnet)
 */
export const ARCIUM_PROGRAM_ID = getArciumProgramId();

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
export function getClusterAccountAddress(clusterOffset: number): PublicKey {
  return getClusterAccAddress(clusterOffset);
}

/**
 * Derive all Arcium-related accounts for subscribe_service instruction
 */
export function getArciumAccounts(
  programId: PublicKey,
  clusterOffset: number,
  computationOffset: bigint,
  compDefOffset = deriveCompDefOffset("subscribe_service")
) {
  const SIGNER_ACCOUNT_SEED = Buffer.from("SignerAccount");

  const [signPdaAccount] = PublicKey.findProgramAddressSync(
    [SIGNER_ACCOUNT_SEED],
    programId
  );

  const mxeAccount = getMXEAccAddress(programId);
  const mempoolAccount = getMempoolAccAddress(clusterOffset);
  const executingPool = getExecutingPoolAccAddress(clusterOffset);
  const computationAccount = getComputationAccAddress(
    clusterOffset,
    computationOffset
  );
  const compDefAccount = getCompDefAccAddress(programId, compDefOffset);
  const clusterAccount = getClusterAccAddress(clusterOffset);

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
