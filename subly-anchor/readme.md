# Subly Solana Program

## Deploy information

```
Deploying program "subly_solana_program"...
Program path: /Users/yukikimura/work/cypherpank/subly-solana-program/target/deploy/subly_solana_program.so...
Program Id: GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22

Signature: 2e36tHzK4nMJASnqhKotrwzkV1YJjPRHHvYcuehhqP6FZmNRhSPtTxpqnoSMaBQbWC2wciy4kzQCX4pQXc62BVCN

Deploy success
```

```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: /Users/yukikimura/.config/solana/id.json
Deploying program "subly_solana_program"...
Program path: /Users/yukikimura/work/cypherpank/subly-solana-program/target/deploy/subly_solana_program.so...
Program Id: C1gJtFGfd2Tt3omV6eWvezeofymZbp7RYj94Hg4drWq1

Signature: 53e8gNTNnfr2DF9rLbESSrJVijHgnvNGNMVVxWjeqWHKFNo7j3tTntqDDMJHV9cjT6jSkhFKpvhXcCT2gmH8nVhC

Deploy success
```

## Environment Variables Setup

### Root Directory (Backend & Scripts)

Add the following to `/.env` to use the various scripts as-is.

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=$HOME/.config/solana/id.json

# PayPal Sandbox
PAYPAL_CLIENT_ID=YOUR_PAYPAL_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_PAYPAL_SANDBOX_CLIENT_SECRET
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com

# Optional: Script behavior adjustment
COMMITMENT=confirmed
NEW_SUBS_START_SLOT=0
NEW_SUBS_FETCH_LIMIT=100
NEW_SUBS_MAX_TX=1000
LOOK_AHEAD_SECONDS=86400      # for process-subscriptions.ts
BATCH_SIZE=16                 # for process-subscriptions.ts
```

> Set `ANCHOR_WALLET` to the secret key of the contract operator (config authority). PayPal credentials should be for the sandbox environment.

### Frontend (`frontend/.env.local`)

```bash
NEXT_PUBLIC_SUBLY_PROGRAM_ID=GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22
NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_WEBSOCKET=wss://api.devnet.solana.com
NEXT_PUBLIC_PHANTOM_APP_ID=your_phantom_app_id
NEXT_PUBLIC_PHANTOM_REDIRECT_URL=http://localhost:3000/phantom/callback
# Optional override (defaults to https://connect.phantom.app/login)
NEXT_PUBLIC_PHANTOM_AUTH_URL=https://connect.phantom.app/login
```

## How to Use Scripts

### initialize-devnet.ts

- Purpose: Create initial PDAs such as `config` / `subscription_registry` / `vault`.
- Execution: `anchor run initialize-devnet` or `npx ts-node --project tsconfig.json scripts/initialize-devnet.ts`
- Prerequisites: `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` must be properly configured, and the target program must be deployed.
- Notes: If accounts already exist, the script will skip them. To reinitialize, close existing PDAs before running.

### register-subscription-services.ts

- Purpose: Bulk registration of subscription services defined in JSON.
- Default input: `scripts/subscription-services.json`
- Execution example: `anchor run register-services` or `yarn register-subscription-services path/to/file.json`
- Notes: Assumes `subscription_registry` has been initialized. Already registered service names will be skipped.

### process-new-subscriptions.ts

- Purpose: Track `SubscriptionActivated` events and send initial payment to PayPal. Checks the on-chain `initial_payment_recorded` flag to avoid duplicate payments.
- Execution example: `npx ts-node --project tsconfig.json scripts/process-new-subscriptions.ts`
- Required environment: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET`
- Notes: Execute with the config authority wallet. Scan range can be adjusted with `NEW_SUBS_*` environment variables.

### process-subscriptions.ts

- Purpose: Use `find_due_subscriptions` to find subscriptions that are coming due soon, then execute PayPal payment and `record_subscription_payment`.
- Execution example: `npx ts-node --project tsconfig.json scripts/process-subscriptions.ts`
- Main environment variables: `LOOK_AHEAD_SECONDS`, `BATCH_SIZE` (defaults: 24h / 16 items)
- Notes: Intended to be run as a scheduled job. Also uses the config authority wallet.

### paypal-client.ts

- Not a directly executable script. This is a utility that consolidates PayPal REST API calls, used by the above two batch scripts.

### subscription-services.json

- Default service definition file read by `register-subscription-services.ts`. Add services in the following format:

```json
[
  {
    "name": "Netflix",
    "monthlyPriceUsd": 15.49,
    "details": "Stream movies and TV shows",
    "logoUrl": "https://example.com/netflix.png",
    "provider": "Netflix Inc."
  }
]
```

## Initialization and Setup Summary

- Run `yarn install` in the root directory to install dependencies.
- Prepare `.env` / `frontend/.env.local` referring to the examples above.
- Run `anchor run initialize-devnet` to create initial PDAs.
- If needed, run `anchor run register-services` to register subscription services.
- After setting up PayPal credentials:
  - `npx ts-node --project tsconfig.json scripts/process-new-subscriptions.ts`
  - `npx ts-node --project tsconfig.json scripts/process-subscriptions.ts`
    Run these periodically to automate initial and monthly payments.

## Operating Stake / Subscribe / Profile from the Frontend

- Run `cd frontend && pnpm install` to install dependencies, then `pnpm dev` to start the local server.
- Connect your wallet through Phantom Connect (embedded wallet) after configuring the `NEXT_PUBLIC_PHANTOM_*` variables along with `NEXT_PUBLIC_SUBLY_PROGRAM_ID` and RPC endpoints.
- Stake tab: Check your USDC balance and stake amount while depositing/withdrawing.
- Subscription tab: Retrieve the list of registered services and Subscribe / Unsubscribe within your staking yield capacity.
- Profile tab: Register/update PayPal information (required before using subscriptions).

# Initialize

```
$ ts-node --project tsconfig.json scripts/initialize-devnet.ts
Initializing Subly config on Devnet...
Program ID: GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22
Authority : nHSjCbSd3XD3UwGy5uAAUqEfDf4kBDYaJZ4eF82nCDZ
USDC mint : 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
Config PDA: 1vDemzZYkm9ke3VUBnx8GRXzcSQVE4GgQaH9k8e1ArX
Vault PDA : Aq9dUZXEQ3nfQ1XUaNxiiacQafnWtngKFa33VZFg7iU3
Registry  : AyNWCP8FN3Pw9RB4b8tBwccf5pTu4XD1kmZR8xCCwQET
Initialization transaction: 2hmLnU58jFL5E7tXQ1KSJJXeoRD4PAGw1kJToRyJXfpgvgFmYWkmtx7cpNpniFv6tHLT6ayRSY5bdhEeYd6DYMzJ
Initialization completed successfully.
✨  Done in 1.53s.
```
