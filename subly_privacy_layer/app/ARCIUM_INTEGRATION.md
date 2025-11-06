# Arcium Integration Plan for Subly Frontend

## Overview

This document outlines the integration of Arcium MPC encryption into the Subly frontend application.

## Current Status: Phase 4 - Complete Privacy Implementation

### Backend (Solana Program)

✅ All plaintext fields removed from `UserSubscription`
✅ Encryption using `Enc<Shared, T>` for user-accessible data
✅ Encryption using `Enc<Mxe, SubscriptionMetadata>` for timestamps/status
✅ MPC computations for `subscribe_service` and `create_subscription_metadata`

### Frontend Integration Tasks

#### 1. Install Required Dependencies

```bash
cd app
pnpm add @noble/curves @coral-xyz/anchor @arcium-hq/client
```

#### 2. Encryption/Decryption Flow

**For Subscribe Service:**

1. Get MXE public key from on-chain account
2. Generate client X25519 keypair
3. Derive shared secret: `sharedSecret = x25519(clientSecret, mxePublic)`
4. Create RescueCipher instance
5. Encrypt subscription data (service_id, monthly_price) with same nonce
6. Send encrypted data to `subscribe_service` instruction
7. Wait for MPC computation finalization
8. Decrypt output using same cipher

**For Reading Subscriptions:**

1. Fetch `UserSubscriptions` account
2. For each subscription:
   - Extract `encrypted_data` (contains service_id, monthly_price)
   - Extract encryption_key and nonce from bundle
   - Reconstruct shared secret using client secret + encryption_key
   - Decrypt ciphertexts to get plaintext values
3. Display decrypted values in UI

#### 3. Key Components to Update

##### `lib/subly.ts`

- ✅ `arcium-client.ts` created with encryption utilities
- ⏳ Update `prepareSubscribeServiceTransaction()` to:
  - Accept encrypted subscription data
  - Include Arcium accounts (MXE, mempool, computation, etc.)
  - Build proper instruction with encrypted arguments
- ⏳ Update `fetchUserSubscriptions()` to:
  - Return encrypted bundles instead of plaintext
  - Remove fields that no longer exist (startedAt, nextBillingTs, status, etc.)

##### `components/subscription-interface.tsx`

- ⏳ Add encryption before calling subscribe
- ⏳ Add decryption when displaying subscriptions
- ⏳ Update UI to show "Decrypting..." state
- ⏳ Handle encrypted metadata gracefully

##### `components/profile-interface.tsx`

- ⏳ Similar decryption logic for profile view

#### 4. Important Notes

**Encryption Context:**

- All encrypted values for `Enc<Shared, T>` MUST use the same nonce and encryption key
- This is critical for struct fields (like `SubscriptionInfo { service_id, monthly_price }`)
- Each separate computation needs a unique nonce

**MPC Computation Flow:**

1. Client calls `subscribe_service` with encrypted data
2. Transaction queues computation in Arcium mempool
3. MXE network executes computation
4. Callback writes results to UserSubscriptions account
5. Frontend can fetch updated encrypted data

**Privacy Guarantees:**

- Service ID and monthly price: Encrypted with user's key (user can decrypt)
- Timestamps and status: Encrypted with MXE-only key (only MPC can decrypt)
- Budget check result: Only boolean revealed (within_budget: bool)

#### 5. Testing Checklist

- [ ] Can subscribe to a service with encrypted data
- [ ] Can decrypt and display subscription details
- [ ] Can view all subscriptions with correct data
- [ ] Loading states work properly
- [ ] Error handling for decryption failures
- [ ] Edge cases: no subscriptions, failed computations

#### 6. Known Limitations (Phase 4)

**Not Yet Implemented:**

- `find_due_subscriptions_mpc` - Currently stubbed (returns empty list)
- `update_subscription_metadata` - Payment recording needs MPC
- `cancel_subscription_metadata` - Full integration pending

**Workarounds:**

- Due subscriptions: Frontend should not rely on this for now
- Payment status: Cannot be decrypted by frontend (MXE-only)
- Cancellation: Status change is encrypted, not visible to frontend

## Implementation Priority

### Phase 1: Core Encryption (CURRENT)

1. ✅ Create `arcium-client.ts` with encryption utilities
2. ⏳ Update `prepareSubscribeServiceTransaction()`
3. ⏳ Update `fetchUserSubscriptions()` with decryption
4. ⏳ Test end-to-end subscription flow

### Phase 2: UI Updates

5. ⏳ Update subscription interface component
6. ⏳ Add loading/error states
7. ⏳ Test user experience

### Phase 3: Advanced Features (Future)

8. ❌ Implement due subscriptions when MPC version available
9. ❌ Implement payment status display when metadata decryption available
10. ❌ Add subscription analytics dashboard

## Code Examples

### Encrypting Subscription Data

```typescript
import {
  generateClientKeypair,
  createSharedEncryptionBundle,
  getMXEPublicKey,
} from "@/lib/arcium-client";

// Get MXE public key
const mxePublicKey = await getMXEPublicKey(connection, SUBLY_PROGRAM_ID);

// Generate client keypair
const { publicKey: clientPubKey, cipher } = generateClientKeypair(mxePublicKey);

// Current total (0 for first subscription)
const currentTotal = 0n;

// Service details
const serviceId = BigInt(service.id);
const monthlyPrice = service.monthlyPrice; // already bigint

// Encrypt all values with same nonce
const { nonce, ciphertexts } = createSharedEncryptionBundle(
  cipher,
  [currentTotal, serviceId, monthlyPrice],
  clientPubKey
);

// Use in instruction:
// - encryption_pubkey: clientPubKey
// - nonce: nonce
// - total_ciphertext: ciphertexts[0]
// - subscription_service_id_ciphertext: ciphertexts[1]
// - subscription_monthly_price_ciphertext: ciphertexts[2]
```

### Decrypting Subscription Data

```typescript
import { decryptConfidentialBundle } from "@/lib/arcium-client";

// Fetch subscriptions
const subscriptionsAccount = await fetchUserSubscriptions(
  connection,
  userPublicKey
);

// For each subscription
for (const sub of subscriptionsAccount.subscriptions) {
  // Reconstruct cipher with stored encryption key
  const encryptionKey = Uint8Array.from(sub.encrypted_data.encryption_key);
  // Note: Need to store client secret key locally or derive deterministically
  const sharedSecret = x25519.getSharedSecret(clientSecretKey, encryptionKey);
  const cipher = new RescueCipher(sharedSecret);

  // Decrypt
  const decrypted = decryptConfidentialBundle(cipher, sub.encrypted_data);

  const serviceId = Number(decrypted[0]);
  const monthlyPrice = decrypted[1];

  console.log({ serviceId, monthlyPrice });
}
```

## Resources

- [Arcium Documentation](https://docs.arcium.com/developers/deployment)
- [JS Client Library](https://docs.arcium.com/developers/js-client-library)
- [Encryption Guide](https://docs.arcium.com/developers/js-client-library/encryption)
- [Arcis Language](https://docs.arcium.com/developers/arcis)
- [Best Practices](https://docs.arcium.com/developers/arcis/best-practices)
