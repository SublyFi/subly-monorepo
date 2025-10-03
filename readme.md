# Subly Solana Program

## デプロイ情報

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

## 環境変数の設定

### ルートディレクトリ（バックエンド & スクリプト）

`/.env` に以下を記載しておくと、各種スクリプトがそのまま利用できます。

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=$HOME/.config/solana/id.json

# PayPal Sandbox
PAYPAL_CLIENT_ID=YOUR_PAYPAL_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_PAYPAL_SANDBOX_CLIENT_SECRET
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com

# 任意: スクリプトの挙動調整
COMMITMENT=confirmed
NEW_SUBS_START_SLOT=0
NEW_SUBS_FETCH_LIMIT=100
NEW_SUBS_MAX_TX=1000
LOOK_AHEAD_SECONDS=86400      # process-subscriptions.ts 用
BATCH_SIZE=16                 # process-subscriptions.ts 用
```

> `ANCHOR_WALLET` には契約オペレーター（config authority）の秘密鍵を指定してください。PayPal の資格情報はサンドボックス用を推奨します。

### フロントエンド (`frontend/.env.local`)

```bash
NEXT_PUBLIC_SUBLY_PROGRAM_ID=GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22
NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_SOLANA_RPC_WEBSOCKET=wss://api.devnet.solana.com
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id   # Privy を使わない場合は未設定で可
```

## スクリプトの使い方

### initialize-devnet.ts

- 用途: `config` / `subscription_registry` / `vault` などの初期 PDA を作成。
- 実行: `anchor run initialize-devnet` もしくは `npx ts-node --project tsconfig.json scripts/initialize-devnet.ts`
- 前提: `ANCHOR_PROVIDER_URL` と `ANCHOR_WALLET` が正しく設定され、対象プログラムがデプロイ済みであること。
- 備考: 既にアカウントが存在する場合はスクリプトがスキップします。再初期化したい場合は既存 PDA をクローズしてから実行してください。

### register-subscription-services.ts

- 用途: JSON で定義したサブスクリプションサービスを一括登録。
- デフォルト入力: `scripts/subscription-services.json`
- 実行例: `anchor run register-services` または `yarn register-subscription-services path/to/file.json`
- 備考: `subscription_registry` が初期化済みであることが前提です。既に登録済みのサービス名はスキップされます。

### process-new-subscriptions.ts

- 用途: `SubscriptionActivated` イベントを追跡し、初回支払いを PayPal へ送金。オンチェーンの `initial_payment_recorded` フラグを見て重複送金を避けます。
- 実行例: `npx ts-node --project tsconfig.json scripts/process-new-subscriptions.ts`
- 必須環境: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET`
- 備考: config authority のウォレットで実行してください。`NEW_SUBS_*` 環境変数でスキャン範囲を調整できます。

### process-subscriptions.ts

- 用途: `find_due_subscriptions` を用いて近々期限が来るサブスクリプションを探し、PayPal 送金と `record_subscription_payment` を実行。
- 実行例: `npx ts-node --project tsconfig.json scripts/process-subscriptions.ts`
- 主な環境変数: `LOOK_AHEAD_SECONDS`, `BATCH_SIZE`（デフォルト: 24h / 16 件）
- 備考: 定期ジョブとして実行する想定です。こちらも config authority ウォレットを使用します。

### paypal-client.ts

- 直接実行するスクリプトではありません。PayPal REST API 呼び出しをまとめたユーティリティで、上記 2 つのバッチスクリプトから利用されています。

### subscription-services.json

- `register-subscription-services.ts` で読み込むデフォルトのサービス定義ファイルです。以下のようなフォーマットでサービスを追加します。

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

## 初期化とセットアップまとめ

- ルートで `yarn install` を実行し依存関係をインストールします。
- `.env` / `frontend/.env.local` を上記の例を参考に用意します。
- `anchor run initialize-devnet` で初期 PDA を作成します。
- 必要に応じて `anchor run register-services` でサブスクサービスを登録します。
- PayPal 資格情報を設定した上で
  - `npx ts-node --project tsconfig.json scripts/process-new-subscriptions.ts`
  - `npx ts-node --project tsconfig.json scripts/process-subscriptions.ts`
    を定期的に実行すると、初回支払いと月次支払いが自動化されます。

## フロントエンドから Stake / Subscribe / Profile を操作する

- `cd frontend && pnpm install` で依存関係をインストールし、`pnpm dev` でローカルサーバーを起動します。
- `NEXT_PUBLIC_SUBLY_PROGRAM_ID` および RPC エンドポイントを設定した状態で Privy を使ってウォレットを接続します。
- Stake タブ: 所持 USDC 残高とステーク量を確認しながら入出金が可能です。
- Subscription タブ: 登録済みサービスの一覧を取得し、所持したステーキング利回りが足りる範囲で Subscribe / Unsubscribe が行えます。
- Profile タブ: PayPal 情報の登録・更新が可能です（サブスク利用前に必須）。

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
