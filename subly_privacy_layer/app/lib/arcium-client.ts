/**
 * Arcium MPC Client Utilities for Subly
 * Handles encryption, decryption, and MPC computation interactions
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { x25519 } from "@noble/curves/ed25519";
import { randomBytes } from "crypto";

/**
 * Rescue cipher implementation for Arcium encryption
 * Based on @arcium-hq/client RescueCipher
 */
export class RescueCipher {
  private sharedSecret: Uint8Array;

  constructor(sharedSecret: Uint8Array) {
    this.sharedSecret = sharedSecret;
  }

  /**
   * Encrypt plaintext values using Rescue cipher
   * @param plaintexts - Array of bigint values to encrypt
   * @param nonce - 16-byte nonce for encryption
   * @returns Array of 32-byte ciphertexts
   */
  encrypt(plaintexts: bigint[], nonce: Uint8Array): Uint8Array[] {
    if (nonce.length !== 16) {
      throw new Error("Nonce must be 16 bytes");
    }

    // TODO: Implement actual Rescue cipher encryption
    // For now, this is a placeholder that needs to be replaced with the real implementation
    // The actual implementation should use the Rescue hash function

    console.warn(
      "RescueCipher.encrypt is not fully implemented - using placeholder"
    );

    return plaintexts.map((value) => {
      // Placeholder: just convert bigint to 32 bytes
      const bytes = new Uint8Array(32);
      const hex = value.toString(16).padStart(64, "0");
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    });
  }

  /**
   * Decrypt ciphertexts using Rescue cipher
   * @param ciphertexts - Array of 32-byte ciphertexts
   * @param nonce - 16-byte nonce used for encryption
   * @returns Array of decrypted bigint values
   */
  decrypt(ciphertexts: Uint8Array[], nonce: Uint8Array): bigint[] {
    if (nonce.length !== 16) {
      throw new Error("Nonce must be 16 bytes");
    }

    // TODO: Implement actual Rescue cipher decryption
    console.warn(
      "RescueCipher.decrypt is not fully implemented - using placeholder"
    );

    return ciphertexts.map((ciphertext) => {
      if (ciphertext.length !== 32) {
        throw new Error("Ciphertext must be 32 bytes");
      }

      // Placeholder: just convert bytes to bigint
      let value = 0n;
      for (let i = 0; i < 32; i++) {
        value = (value << 8n) | BigInt(ciphertext[i]);
      }
      return value;
    });
  }
}

/**
 * Get MXE public key for the Subly program
 * @param connection - Solana connection
 * @param programId - Subly program ID
 * @returns MXE public key as Uint8Array
 */
export async function getMXEPublicKey(
  connection: Connection,
  programId: PublicKey
): Promise<Uint8Array> {
  // Derive MXE account PDA
  const [mxeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("mxe")],
    new PublicKey("BKck65TgoKRokMjQM3datB9oRwJ8rAj2jxPXvHXUvcL6") // Arcium program ID
  );

  const accountInfo = await connection.getAccountInfo(mxeAccount);
  if (!accountInfo) {
    throw new Error("MXE account not found");
  }

  // MXE public key is stored in the account data
  // Format: [discriminator(8), public_key(32), ...]
  const mxePublicKey = accountInfo.data.slice(8, 40);

  return mxePublicKey;
}

/**
 * Generate a client keypair for encryption
 * @returns Object with private key, public key, and cipher
 */
export function generateClientKeypair(mxePublicKey: Uint8Array) {
  const clientSecretKey = x25519.utils.randomPrivateKey();
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
  ciphertexts: Uint8Array[];
} {
  const nonce = randomBytes(16);
  const ciphertexts = cipher.encrypt(values, nonce);

  return {
    nonce,
    encryptionKey: clientPublicKey,
    ciphertexts,
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
  const ciphertexts = bundle.ciphertexts
    .slice(0, bundle.ciphertextCount)
    .map((ct) => Uint8Array.from(ct));

  return cipher.decrypt(ciphertexts, Uint8Array.from(bundle.nonce));
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
