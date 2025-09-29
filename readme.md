# Subly Solana Program

## デプロイ情報

```
Deploying program "subly_solana_program"...
Program path: /Users/yukikimura/work/cypherpank/subly-solana-program/target/deploy/subly_solana_program.so...
Program Id: GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22

Signature: 2e36tHzK4nMJASnqhKotrwzkV1YJjPRHHvYcuehhqP6FZmNRhSPtTxpqnoSMaBQbWC2wciy4kzQCX4pQXc62BVCN

Deploy success
```

## initialize 関数の呼び出し手順

- ルートディレクトリで `yarn install` を済ませ、`~/.config/solana/id.json` に Devnet 用のキーペアを用意してください。
- `anchor run initialize-devnet` を実行すると、`Anchor.toml` の設定を使って `scripts/initialize-devnet.ts` が走り、`config`/`subscription_registry`/`vault` の PDA を作成します。既に初期化済みの場合はスキップされます。
- 直接実行する場合は `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json yarn initialize-devnet` としても同じ結果になります。
- トランザクション署名と PDA がログに表示されるので控えておくと後続作業が楽です。

## フロントエンドから Stake を実行する

- `frontend/.env.local` に以下を追加してください（環境に合わせて書き換え可能です）。

  ```
  NEXT_PUBLIC_SUBLY_PROGRAM_ID=GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22
  NEXT_PUBLIC_SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
  ```

- `cd frontend && pnpm install`（または `yarn install` / `npm install`）を行い、`pnpm dev` などでローカルサーバーを起動します。
- Privy でウォレット接続後、`Stake` タブから金額を入力して実行すると `prepareStakeTransaction` が新しい Program ID 宛てにトランザクションを生成します。USDC ATA が無い場合は自動で作成されます。
- Devnet 上で USDC 残高が不足しているとトランザクションが失敗するため、事前にトークンを用意してください。

## Subscription サービスを登録する

- `scripts/subscription-services.json` に登録したいサービス情報を追記できます（`monthlyPriceUsd` は USD 金額）。
- `anchor run register-services` を実行すると JSON に含まれる全サービスが `register_subscription_service` 経由で順番に登録されます。
- 別のファイルを使いたい場合は `yarn register-subscription-services path/to/file.json` を直接実行してください。
- 登録済みのサービスはフロントエンドの「Subscribe」タブで全ユーザーが閲覧できるようになっています。

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
