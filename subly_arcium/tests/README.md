# Subly Arcium Tests

This directory contains comprehensive tests for the Subly Arcium subscription management system built on Arcium's Multi-Party Computation (MPC) network.

## Test Coverage

The test suite (`subly_arcium.ts`) covers the complete workflow of the Subly platform:

### 1. System Initialization

- Initializes the Subly system with encrypted state
- Sets up configuration, vault, and subscription registry
- Performs initialization through MPC computation

### 2. PayPal Recipient Registration

- Registers encrypted PayPal recipient information
- Supports email and phone recipient types
- User subscription data remains confidential

### 3. Subscription Service Registration

- Service creators can register subscription services
- Service metadata and pricing stored in encrypted form
- Billing intervals and hashes managed securely

### 4. Staking Operations

- Users can stake USDC tokens
- Multiple lock duration options available
- Stake data encrypted through MPC

### 5. Service Subscription

- Users can subscribe to registered services
- Subscription contracts created with encrypted state
- Subscription status tracked privately

### 6. Due Subscription Detection

- Finds subscriptions that are due for payment
- Computation performed in MPC environment
- Results returned securely

### 7. Payment Recording

- Records subscription payments
- Updates encrypted subscription state
- Maintains payment history privately

### 8. Unsubscription

- Users can unsubscribe from services
- Updates subscription status through MPC
- Handles pending commitments

### 9. Unstaking

- Users can unstake tokens after lock period
- Amount withdrawals validated in MPC
- Transfers tokens from vault back to user

## Prerequisites

Before running the tests, ensure you have:

1. **Solana Test Validator running**

   ```bash
   solana-test-validator
   ```

2. **Arcium Network Access**

   - Configure Arcium environment variables
   - Ensure MPC network is accessible
   - Set up Arcium cluster connection

3. **Built Program**

   ```bash
   anchor build
   ```

4. **Deployed Program**

   ```bash
   anchor deploy
   ```

5. **Computation Definitions**
   - All `.arcis` circuit files must be built
   - Located in `build/` directory
   - Generated from `encrypted-ixs/src/lib.rs`

## Running Tests

### Run all tests

```bash
anchor test
```

### Run tests without deploying

```bash
anchor test --skip-deploy
```

### Run tests with detailed output

```bash
anchor test -- --features "test-output"
```

### Run specific test file

```bash
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/subly_arcium.ts
```

## Test Structure

The test follows this flow:

```
Initialize System
    ↓
Register PayPal Recipient
    ↓
Register Subscription Service
    ↓
Stake USDC
    ↓
Subscribe to Service
    ↓
Find Due Subscriptions
    ↓
Record Payment
    ↓
Unsubscribe
    ↓
Unstake USDC
```

Each step:

1. Queues a computation to the Arcium MPC network
2. Waits for computation finalization
3. Receives encrypted results via callback
4. Updates on-chain state with encrypted data

## Helper Functions

The test includes helper functions for initializing computation definitions:

- `initInitializeCompDef()` - Initialize system computation definition
- `initRegisterPaypalRecipientCompDef()` - PayPal registration computation
- `initRegisterSubscriptionServiceCompDef()` - Service registration computation
- `initSubscribeServiceCompDef()` - Subscription computation
- `initStakeCompDef()` - Staking computation
- `initUnstakeCompDef()` - Unstaking computation
- `initUnsubscribeServiceCompDef()` - Unsubscription computation
- `initRecordSubscriptionPaymentCompDef()` - Payment recording computation
- `initFindDueSubscriptionsCompDef()` - Due subscription detection computation

## Key Concepts

### Computation Definitions

Each encrypted operation requires a computation definition that:

- Defines the MPC circuit to execute
- Specifies input/output parameters
- Sets up callback instructions

### Computation Offsets

- Random 64-bit offsets identify each computation
- Used to track computation status
- Required for awaiting finalization

### Encrypted State

- All sensitive data stored in encrypted form
- Encrypted using Arcium's MPC network
- Only decrypted within trusted execution environment

### Callbacks

- Automatically invoked when computation completes
- Update on-chain state with encrypted results
- Validate computation success

## Troubleshooting

### Test Timeouts

If tests timeout, ensure:

- Arcium network is responsive
- Computation definitions are properly initialized
- Network has sufficient capacity

### Computation Failures

Check:

- Circuit files are correctly built
- Input parameters match expected types
- Account constraints are satisfied

### Account Errors

Verify:

- PDAs are derived correctly
- Account ownership is proper
- Space allocations are sufficient

## Example Output

```
SublyArcium
  Test complete Subly subscription flow
    Owner address: xyz...
    Service creator address: abc...
    Subscriber address: def...

    === Step 1: Initialize Subly System ===
    Initialize transaction signature: sig1...
    Initialize finalize signature: sig2...

    === Step 2: Register PayPal Recipient ===
    Register PayPal signature: sig3...
    Register PayPal finalize signature: sig4...

    ...

    === All Tests Completed Successfully ===
    ✓ Test complete Subly subscription flow (120000ms)
```

## References

- [Arcium Documentation](https://docs.arcium.com)
- [Arcium Hello World](https://docs.arcium.com/developers/hello-world)
- [Arcium JS Client Library](https://docs.arcium.com/developers/js-client-library)
- [Arcium Example Applications](https://github.com/arcium-hq/examples)

## Notes

- Tests use local devnet USDC mint
- All computations run on Arcium testnet
- Encryption keys generated per test run
- Accounts automatically created as needed
