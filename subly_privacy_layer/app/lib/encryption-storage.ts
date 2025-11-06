/**
 * Client-side encryption key management for Arcium
 * Handles storage and retrieval of client secret keys for subscription decryption
 */

import { x25519, RescueCipher } from "@arcium-hq/client";

const STORAGE_KEY_PREFIX = "subly_arcium_";

/**
 * Store client secret key in localStorage
 * @param walletAddress - User's wallet address (used as key)
 * @param secretKey - Client secret key (32 bytes)
 */
export function storeClientSecretKey(
  walletAddress: string,
  secretKey: Uint8Array
): void {
  if (typeof window === "undefined") return;

  try {
    const key = `${STORAGE_KEY_PREFIX}${walletAddress}`;
    const hex = Buffer.from(secretKey).toString("hex");
    localStorage.setItem(key, hex);
  } catch (error) {
    console.error("Failed to store client secret key:", error);
  }
}

/**
 * Retrieve client secret key from localStorage
 * @param walletAddress - User's wallet address
 * @returns Client secret key or null if not found
 */
export function getClientSecretKey(walletAddress: string): Uint8Array | null {
  if (typeof window === "undefined") return null;

  try {
    const key = `${STORAGE_KEY_PREFIX}${walletAddress}`;
    const hex = localStorage.getItem(key);

    if (!hex) return null;

    return Uint8Array.from(Buffer.from(hex, "hex"));
  } catch (error) {
    console.error("Failed to retrieve client secret key:", error);
    return null;
  }
}

/**
 * Clear client secret key from localStorage
 * @param walletAddress - User's wallet address
 */
export function clearClientSecretKey(walletAddress: string): void {
  if (typeof window === "undefined") return;

  try {
    const key = `${STORAGE_KEY_PREFIX}${walletAddress}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Failed to clear client secret key:", error);
  }
}

/**
 * Create or retrieve cipher for a wallet
 * @param walletAddress - User's wallet address
 * @param mxePublicKey - MXE public key
 * @returns Cipher instance and whether a new key was generated
 */
export function getOrCreateCipher(
  walletAddress: string,
  mxePublicKey: Uint8Array
): { cipher: RescueCipher; secretKey: Uint8Array; isNew: boolean } {
  // Try to retrieve existing secret key
  let secretKey = getClientSecretKey(walletAddress);
  let isNew = false;

  if (!secretKey) {
    // Generate new secret key
    secretKey = x25519.utils.randomSecretKey();
    storeClientSecretKey(walletAddress, secretKey);
    isNew = true;
  }

  // Derive shared secret and create cipher
  const sharedSecret = x25519.getSharedSecret(secretKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  return { cipher, secretKey, isNew };
}

/**
 * Decrypt a ciphertext bundle using stored client key
 * @param walletAddress - User's wallet address
 * @param mxePublicKey - MXE public key
 * @param bundle - Encrypted bundle from on-chain
 * @returns Decrypted values or null if decryption failed
 */
export function decryptWithStoredKey(
  walletAddress: string,
  mxePublicKey: Uint8Array,
  bundle: {
    ciphertexts: number[][];
    ciphertextCount: number;
    nonce: number[];
  }
): bigint[] | null {
  try {
    const { cipher } = getOrCreateCipher(walletAddress, mxePublicKey);

    const ciphertexts = bundle.ciphertexts.slice(0, bundle.ciphertextCount);
    const nonce = Uint8Array.from(bundle.nonce);

    return cipher.decrypt(ciphertexts, nonce);
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
}
