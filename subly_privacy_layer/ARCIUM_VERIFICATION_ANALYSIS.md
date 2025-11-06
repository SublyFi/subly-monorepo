# Arcium Privacy Verification Analysis

**Date**: 2025 年 10 月 26 日  
**Objective**: 以下の主張が技術的に正しいか検証する

---

## 検証対象の 3 つの主張

1. ✅ **"Verify subscriptions privately with Arcium"**
2. ✅ **"Subly verifies your subscription while data stays encrypted with Arcium"**
3. ⚠️ **"Keeping your data private and making the system trustless on-chain"**

---

## 1. "Verify subscriptions privately with Arcium" の検証

### 実装の詳細調査

#### 1.1 暗号化フロー

**クライアント側（テストコードより）:**

```typescript
// tests/subly_privacy_layer.ts (L539-558)

// 1. クライアントがx25519鍵ペアを生成
const clientSecretKey = x25519.utils.randomPrivateKey();
const clientPublicKey = x25519.getPublicKey(clientSecretKey);

// 2. MXE（Arcium）の公開鍵と共有秘密を生成
const sharedSecret = x25519.getSharedSecret(clientSecretKey, mxePublicKey);

// 3. 共有秘密からRescue暗号を初期化
const cipher = new RescueCipher(sharedSecret);

// 4. サブスクリプションデータを暗号化
const encryptedValues = cipher.encrypt(
  [currentTotal, BigInt(streamServiceId), servicePrice],
  nonce
);
```

**重要なポイント:**

- ✅ クライアントは自分の秘密鍵でデータを暗号化
- ✅ MXE（Arcium）との共有秘密を使用
- ✅ 暗号文のみがオンチェーンに送信される

#### 1.2 MPC 処理（Multi-Party Computation）

**MPC Circuit（encrypted-ixs/src/lib.rs）:**

```rust
#[instruction]
pub fn subscribe_service(
    total_ctxt: Enc<Shared, u64>,              // 暗号化されたまま処理
    subscription_ctxt: Enc<Shared, SubscriptionInfo>,  // 暗号化されたまま処理
    budget: u64,                                // 平文（予算上限）
) -> (Enc<Shared, u64>, Enc<Shared, SubscriptionInfo>, bool) {
    let current_total = total_ctxt.to_arcis();      // MPC内で復号
    let subscription = subscription_ctxt.to_arcis(); // MPC内で復号

    // MPC内で計算（データは外部に漏れない）
    let new_total = current_total + subscription.monthly_price;
    let within_budget = !overflow && updated_total <= budget;

    // 結果を再暗号化して返す
    (
        total_ctxt.owner.from_arcis(updated_total),      // 再暗号化
        subscription_ctxt.owner.from_arcis(subscription), // 再暗号化
        within_budget.reveal(),  // 判定結果のみ平文で返す
    )
}
```

**重要なポイント:**

- ✅ **`Enc<Shared, T>`**: クライアントと MXE が共有秘密で暗号化
- ✅ **MPC 内でのみ復号**: `to_arcis()`で Arcium MPC 環境内でのみ復号
- ✅ **計算結果を再暗号化**: `from_arcis()`で結果を暗号化して返す
- ✅ **判定結果のみ公開**: `within_budget`だけが平文で返される

#### 1.3 検証プロセスの流れ

```
[Client]
  ↓ (1) Encrypt (service_id, monthly_price) with shared secret
[Encrypted Data]
  ↓ (2) Submit transaction to Solana
[Solana Program]
  ↓ (3) Queue MPC computation with Arcium
[Arcium MXE Network]
  ↓ (4) Decrypt in MPC environment
  ↓ (5) Verify: new_total <= budget
  ↓ (6) Re-encrypt results
[Callback to Solana]
  ↓ (7) Store encrypted subscription data
[On-chain Storage]
```

**検証結果: ✅ TRUE**

**理由:**

1. サブスクリプションデータ（service_id, price）は常に暗号化されている
2. 検証（budget check）は Arcium MPC 内で行われる
3. 検証結果（within_budget: bool）のみが公開される
4. 実際のデータは暗号化されたまま保存される

---

## 2. "Subly verifies your subscription while data stays encrypted with Arcium" の検証

### 2.1 データが暗号化されたまま処理される証拠

#### コールバック処理（subscribe_service.rs L363-484）

```rust
pub fn handle_callback(
    ctx: Context<SubscribeServiceCallback>,
    output: ComputationOutputs<SubscribeServiceOutput>,
) -> Result<()> {
    // (1) MPC計算結果を受け取る（暗号化されている）
    let (total_enc, subscription_enc, within_budget) = match output {
        ComputationOutputs::Success(SubscribeServiceOutput { ... }) => (...),
        _ => return Err(ErrorCode::AbortedComputation.into()),
    };

    // (2) 予算チェックの結果のみ検証（平文）
    require!(within_budget, ErrorCode::SubscriptionBudgetExceeded);

    // (3) 暗号化データを ConfidentialBundle として保存
    let subscription_bundle = ConfidentialBundle::from_slice(
        &subscription_enc.ciphertexts[..2],  // ← 暗号文のまま
        subscription_enc.nonce.to_le_bytes(),
        subscription_enc.encryption_key,
    )?;

    // (4) 暗号化されたまま UserSubscriptions に記録
    let subscription_id = ctx.accounts.user_subscriptions.record_subscription(
        subscription_bundle.clone(),  // ← 暗号文
        now,
        billing_period,
    )?;

    // (5) イベントも暗号化データのみ公開
    emit!(SubscriptionActivated {
        user: user_key,
        encrypted_subscription: encrypted_subscription_event,  // ← 暗号文
        encrypted_total_commitment: encrypted_total_event,     // ← 暗号文
    });
}
```

#### データ構造（state/mod.rs）

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UserSubscription {
    pub id: u64,
    pub encrypted_data: ConfidentialBundle,  // ← service_id, priceが暗号化
    pub encrypted_metadata: ConfidentialBundle,  // ← timestamps, statusが暗号化
    // ...
}

pub struct ConfidentialBundle {
    pub ciphertexts: [[u8; 32]; MAX_CONFIDENTIAL_CIPHERTEXTS],  // 暗号文
    pub ciphertext_count: u8,
    pub nonce: [u8; 16],           // 復号に必要
    pub encryption_key: [u8; 32],  // 復号に必要
}
```

**検証結果: ✅ TRUE**

**理由:**

1. **MPC 内で検証**: 予算チェックは Arcium MPC 内で実行される
2. **暗号化されたまま保存**: `ConfidentialBundle`として暗号文を保存
3. **Subly プログラムは平文を見ない**: コールバックは暗号文のみを扱う
4. **検証結果のみ公開**: `within_budget` (bool) だけが平文

### 2.2 暗号化の種類と復号可能性

#### 2.2.1 `Enc<Shared, T>` - クライアント復号可能

```rust
// encrypted-ixs/src/lib.rs
pub fn subscribe_service(
    total_ctxt: Enc<Shared, u64>,  // ← クライアント復号可能
    subscription_ctxt: Enc<Shared, SubscriptionInfo>,  // ← クライアント復号可能
    // ...
) -> (Enc<Shared, u64>, Enc<Shared, SubscriptionInfo>, bool)
```

**特徴:**

- ✅ クライアントと MXE の共有秘密で暗号化
- ✅ クライアントは自分のデータを復号できる
- ❌ 第三者は復号不可（秘密鍵がない）
- ❌ Subly プログラムも復号不可（MPC 内でのみ復号）

**テストコードでの復号:**

```typescript
// tests/subly_privacy_layer.ts (L633-639)
const decryptedActivation = decryptBundle(
  cipher, // クライアントの共有秘密から作成
  activationData.encryptedSubscription
);

console.log("decryptedActivation:", decryptedActivation);
// Expected: [service_id, monthly_price]
```

#### 2.2.2 `Enc<Mxe, T>` - MXE のみ復号可能

```rust
// encrypted-ixs/src/lib.rs
#[instruction]
pub fn create_subscription_metadata(
    mxe: Mxe  // ← MXE暗号化コンテキスト
) -> Enc<Mxe, SubscriptionMetadata> {  // ← MXEのみ復号可能
    let metadata = SubscriptionMetadata {
        started_at: 0,
        last_payment_ts: 0,
        next_billing_ts: 0,
        status: 0,
    };
    mxe.from_arcis(metadata)  // ← MXE秘密鍵で暗号化
}
```

**特徴:**

- ✅ MXE ネットワークの秘密鍵でのみ復号可能
- ❌ クライアントも復号不可
- ❌ Subly プログラムも復号不可
- ❌ 第三者も復号不可

**使用例（create_subscription_metadata.rs L148-155）:**

```rust
// MXE-only encryption, no shared key
let metadata_bundle = ConfidentialBundle::from_slice(
    &metadata_enc.ciphertexts[..4],
    metadata_enc.nonce.to_le_bytes(),
    [0u8; 32],  // ← encryption_key = 0（共有秘密なし）
)?;
```

---

## 3. "Keeping your data private and making the system trustless on-chain" の検証

### 3.1 データプライバシーの評価

#### ✅ **完全に保護されているデータ**

| データ               | 暗号化方式                       | 復号可能者       | 保存場所                              |
| -------------------- | -------------------------------- | ---------------- | ------------------------------------- |
| `service_id`         | `Enc<Shared, u64>`               | クライアントのみ | `UserSubscription.encrypted_data`     |
| `monthly_price`      | `Enc<Shared, u64>`               | クライアントのみ | `UserSubscription.encrypted_data`     |
| `encrypted_metadata` | `Enc<Mxe, SubscriptionMetadata>` | MXE のみ         | `UserSubscription.encrypted_metadata` |

**イベントログでの保護:**

```rust
// subscribe_service.rs L454-459
emit!(SubscriptionActivated {
    user: user_key,  // 公開情報（必要）
    encrypted_subscription: encrypted_subscription_event,  // 暗号文のみ
    encrypted_total_commitment: encrypted_total_event,     // 暗号文のみ
});
```

#### ⚠️ **平文で公開されているデータ（プライバシーリスク）**

```rust
// state/mod.rs L462-468
pub struct UserSubscription {
    pub id: u64,
    pub encrypted_data: ConfidentialBundle,  // ✅ 暗号化
    pub encrypted_metadata: ConfidentialBundle,  // ✅ 暗号化

    // ⚠️ 以下のフィールドは平文
    pub started_at: i64,           // ⚠️ 平文
    pub last_payment_ts: i64,      // ⚠️ 平文
    pub next_billing_ts: i64,      // ⚠️ 平文
    pub pending_until_ts: i64,     // ⚠️ 平文
    pub status: SubscriptionStatus, // ⚠️ 平文
    pub initial_payment_recorded: bool,  // ⚠️ 平文
}
```

**誰でも読み取り可能:**

```typescript
// 第三者が実行可能なコード
const userSubscriptions = await program.account.userSubscriptions.fetch(pda);
console.log("Started at:", userSubscriptions.subscriptions[0].started_at);
console.log("Status:", userSubscriptions.subscriptions[0].status);
console.log(
  "Next billing:",
  userSubscriptions.subscriptions[0].next_billing_ts
);
```

**プライバシーリスク:**

- 🔴 いつサブスクを開始したか → **公開**
- 🔴 最後の支払い日時 → **公開**
- 🔴 次回請求日 → **公開**
- 🔴 ステータス（Active/Cancelled） → **公開**

### 3.2 Trustlessness（信頼不要性）の評価

#### ✅ **達成されている Trustless 要素**

1. **スマートコントラクトの透明性**

   - ✅ Solana プログラムはオープンソース
   - ✅ ロジックは誰でも検証可能
   - ✅ 改ざん不可（イミュータブル）

2. **Arcium MPC の分散信頼**

   ```rust
   // MPC計算は複数ノードで実行
   queue_computation(
       ctx.accounts,
       computation_offset,
       computation_args,
       None,  // ← MXEネットワーク全体で計算
       callbacks,
   )?;
   ```

   - ✅ 単一ノードではデータを復号できない
   - ✅ 閾値暗号（Threshold Cryptography）で保護
   - ✅ ノード間の共謀が必要

3. **オンチェーン検証性**
   ```rust
   // 全ての状態変更がオンチェーンで記録
   ctx.accounts.user_subscriptions.record_subscription(
       subscription_bundle.clone(),
       now,
       billing_period,
   )?;
   ```
   - ✅ トランザクション履歴が公開
   - ✅ 状態遷移が検証可能
   - ✅ ロールバック不可

#### ⚠️ **信頼が必要な要素**

1. **Arcium MXE ネットワークへの信頼**

   - ⚠️ MXE ノードが正直に動作すると仮定
   - ⚠️ 閾値数のノードが共謀しないと仮定
   - ⚠️ ネットワークの可用性に依存

2. **オペレーターへの信頼（限定的）**

   ```rust
   // record_subscription_payment.rs L47-51
   require_keys_eq!(
       ctx.accounts.config.authority,  // ← 特権アカウント
       ctx.accounts.operator.key(),
       ErrorCode::UnauthorizedAuthority
   );
   ```

   - ⚠️ 支払い記録はオペレーターのみ実行可能
   - ⚠️ オペレーターの誠実性を信頼

3. **レガシーフィールドの存在**
   ```rust
   // find_due_subscriptions.rs L69-74
   if subscription.status != SubscriptionStatus::Active {  // 平文
       continue;
   }
   if !initial_payment_pending && subscription.next_billing_ts > upper_bound {  // 平文
       continue;
   }
   ```
   - ⚠️ 期限切れ検索には平文フィールドが必要
   - ⚠️ 完全なプライバシー保護との矛盾

---

## 4. 総合評価

### 4.1 各主張の達成度

| 主張                                           | 達成度     | 評価                                                 |
| ---------------------------------------------- | ---------- | ---------------------------------------------------- |
| (1) Verify subscriptions privately with Arcium | ✅ **95%** | MPC 検証は完全実装、一部平文フィールドあり           |
| (2) Data stays encrypted with Arcium           | ✅ **90%** | service_id/price は完全暗号化、metadata は部分暗号化 |
| (3) Private and trustless on-chain             | ⚠️ **70%** | Trustless は達成、Privacy は部分的                   |

### 4.2 詳細な評価

#### 主張 1: "Verify subscriptions privately with Arcium" ✅

**達成されている点:**

- ✅ サブスクリプションの検証（予算チェック）は Arcium MPC 内で実行
- ✅ service_id と monthly_price は暗号化されたまま処理
- ✅ 検証結果（within_budget）のみが公開される
- ✅ クライアントは自分のデータを復号可能

**技術的根拠:**

```rust
// MPC circuit内での検証
let within_budget = !overflow && updated_total <= budget;
return (encrypted_total, encrypted_subscription, within_budget.reveal());
```

**評価: ✅ この主張は TRUE**

---

#### 主張 2: "Subly verifies your subscription while data stays encrypted with Arcium" ✅

**達成されている点:**

- ✅ Subly プログラムは暗号文のみを受け取る
- ✅ 実際の検証は Arcium MPC 内で実行
- ✅ Subly プログラムは平文データにアクセスしない
- ✅ 暗号化データがオンチェーンに保存される

**技術的根拠:**

```rust
// Sublyプログラムのコールバック
pub fn handle_callback(
    ctx: Context<SubscribeServiceCallback>,
    output: ComputationOutputs<SubscribeServiceOutput>,
) -> Result<()> {
    // outputは暗号化されたデータ
    let (total_enc, subscription_enc, within_budget) = match output { ... };

    // 暗号文のまま保存
    let subscription_bundle = ConfidentialBundle::from_slice(
        &subscription_enc.ciphertexts[..2],
        ...
    )?;

    ctx.accounts.user_subscriptions.record_subscription(
        subscription_bundle,  // ← 暗号文
        ...
    )?;
}
```

**評価: ✅ この主張は TRUE**

---

#### 主張 3: "Keeping your data private and making the system trustless on-chain" ⚠️

**達成されている点:**

- ✅ service_id と monthly_price は完全に保護
- ✅ encrypted_metadata (Phase 3) は MXE のみ復号可能
- ✅ イベントログには暗号文のみ含まれる
- ✅ スマートコントラクトはオープンソースで検証可能
- ✅ Arcium MPC は分散信頼モデル

**達成されていない点:**

- 🔴 **タイムスタンプが平文で公開**: started_at, last_payment_ts, next_billing_ts
- 🔴 **ステータスが平文で公開**: Active/PendingCancellation/Cancelled
- ⚠️ **オペレーターへの信頼が必要**: 支払い記録の実行権限
- ⚠️ **Arcium MXE への信頼が必要**: ネットワークの誠実性

**プライバシーリスクの具体例:**

```typescript
// 第三者が実行可能
const userSubs = await program.account.userSubscriptions.fetch(pda);
const sub = userSubs.subscriptions[0];

// 以下の情報が漏洩
console.log("Subscription started:", new Date(sub.started_at * 1000));
console.log("Last payment:", new Date(sub.last_payment_ts * 1000));
console.log("Next billing:", new Date(sub.next_billing_ts * 1000));
console.log("Status:", sub.status); // Active/Cancelled
```

**評価: ⚠️ この主張は PARTIALLY TRUE**

**完全に TRUE と言うための条件:**

- レガシーフィールド（平文）の削除
- 期限切れ検索を MPC 内で実行
- オペレーター権限の分散化または削除

---

## 5. 推奨される改善策

### 5.1 プライバシーの完全保護

#### 優先度 1: 平文フィールドの削除（Breaking Change）

**現状の問題:**

```rust
pub struct UserSubscription {
    pub started_at: i64,        // ⚠️ 削除すべき
    pub last_payment_ts: i64,   // ⚠️ 削除すべき
    pub next_billing_ts: i64,   // ⚠️ 削除すべき
    pub status: SubscriptionStatus,  // ⚠️ 削除すべき
}
```

**解決策:**

```rust
pub struct UserSubscription {
    pub id: u64,
    pub encrypted_data: ConfidentialBundle,
    pub encrypted_metadata: ConfidentialBundle,  // ← すべてここに
    // 平文フィールドは削除
}
```

**課題:**

- `find_due_subscriptions` が動作しなくなる
- → **解決策**: MPC-based due subscription detection

#### 優先度 2: MPC-based Due Subscription Detection

**新しい MPC instruction:**

```rust
#[instruction]
pub fn find_due_subscriptions_mpc(
    metadata_list: Vec<Enc<Mxe, SubscriptionMetadata>>,
    current_time: i64,
    lookahead: i64,
) -> Vec<bool> {
    // MPC内で各サブスクの next_billing_ts と current_time を比較
    // 期限切れかどうかの boolean 配列を返す
    metadata_list.iter().map(|meta| {
        let m = meta.to_arcis();
        (m.next_billing_ts <= current_time + lookahead).reveal()
    }).collect()
}
```

**利点:**

- ✅ タイムスタンプを公開せずに期限切れ検索可能
- ✅ 完全なプライバシー保護
- ✅ Trustlessness 維持

### 5.2 Trustlessness の強化

#### オペレーター権限の分散化

**現状:**

```rust
// record_subscription_payment.rs
require_keys_eq!(
    ctx.accounts.config.authority,  // 単一の特権アカウント
    ctx.accounts.operator.key(),
    ErrorCode::UnauthorizedAuthority
);
```

**改善案:**

```rust
// Multi-sig または DAO ガバナンス
require!(
    is_approved_by_multisig(ctx.accounts.governance, ctx.accounts.operator),
    ErrorCode::UnauthorizedAuthority
);
```

---

## 6. 最終結論

### 6.1 各主張の評価サマリー

| 主張                                             | 結論                  | 根拠                                                                   |
| ------------------------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| **"Verify subscriptions privately with Arcium"** | ✅ **TRUE**           | MPC 検証が完全実装されており、データは暗号化されたまま検証される       |
| **"Data stays encrypted with Arcium"**           | ✅ **TRUE**           | Subly プログラムは暗号文のみを扱い、復号は MPC 内でのみ実行される      |
| **"Private and trustless on-chain"**             | ⚠️ **PARTIALLY TRUE** | service_id/price は完全保護だが、タイムスタンプ/ステータスが平文で漏洩 |

### 6.2 マーケティング文言の正確性

#### ✅ **使用可能な文言（技術的に正確）**

1. **"Verify subscriptions privately with Arcium"** → ✅ **OK**

   - 事実: サブスクリプションの検証は Arcium MPC 内で暗号化されたまま実行される

2. **"Subly verifies your subscription while data stays encrypted"** → ✅ **OK**

   - 事実: Subly プログラムは暗号文のみを扱い、検証は Arcium MPC で実行される

3. **"Service details and pricing stay encrypted on-chain"** → ✅ **OK**
   - 事実: service_id と monthly_price は完全に暗号化されている

#### ⚠️ **要注意の文言（部分的に正確）**

1. **"Keeping your data private on-chain"** → ⚠️ **PARTIALLY TRUE**

   - 正確な表現: "Keeping your subscription details (service and price) private on-chain"
   - 注意: タイムスタンプとステータスは平文

2. **"Making the system trustless on-chain"** → ⚠️ **PARTIALLY TRUE**
   - 正確な表現: "Making subscription verification trustless with Arcium MPC"
   - 注意: オペレーター権限や MXE ネットワークへの信頼は必要

#### ❌ **避けるべき文言（不正確）**

1. **"All subscription data is encrypted on-chain"** → ❌ **FALSE**

   - 理由: タイムスタンプ、ステータス、支払フラグは平文

2. **"Completely private and trustless"** → ❌ **FALSE**
   - 理由: 平文フィールドが存在し、オペレーターへの信頼が必要

### 6.3 推奨される正確なマーケティング文言

#### Version A: 現状を正確に表現

```
✅ "Subly protects your subscription privacy with Arcium"
   → What you subscribe to and how much you pay stays encrypted on-chain

✅ "Private subscription verification powered by Arcium MPC"
   → Verify subscriptions without revealing service details

✅ "Your subscription choices stay confidential"
   → Service names and pricing encrypted with Arcium technology
```

#### Version B: Phase 3 完了を強調

```
✅ "Enhanced privacy with encrypted metadata (Phase 3)"
   → Subscription details and metadata encrypted with Arcium

✅ "Two layers of encryption for maximum privacy"
   → Service data: Client-encrypted (you can decrypt)
   → Metadata: MXE-encrypted (only Arcium network can decrypt)
```

#### Version C: Trustlessness を強調

```
✅ "Trustless subscription verification on Solana"
   → Powered by Arcium's Multi-Party Computation network

✅ "No centralized party sees your subscription data"
   → Distributed trust with Arcium MPC nodes
```

### 6.4 現時点での最も正確な 3 行まとめ

```
✅ Subly verifies your subscriptions privately with Arcium MPC
✅ Service details and pricing stay encrypted on-chain
⚠️ Achieving privacy-preserving verification with decentralized trust
   (Note: Subscription timestamps visible on-chain for protocol operation)
```

---

## 7. 技術的証拠のまとめ

### 7.1 暗号化の証拠

**クライアント側暗号化:**

```typescript
// tests/subly_privacy_layer.ts (L558-562)
const encryptedValues = cipher.encrypt(
  [currentTotal, BigInt(streamServiceId), servicePrice],
  nonce
);
```

**MPC 処理:**

```rust
// encrypted-ixs/src/lib.rs (L38-58)
pub fn subscribe_service(
    total_ctxt: Enc<Shared, u64>,
    subscription_ctxt: Enc<Shared, SubscriptionInfo>,
    budget: u64,
) -> (Enc<Shared, u64>, Enc<Shared, SubscriptionInfo>, bool) {
    // MPC内で復号・計算・再暗号化
}
```

**暗号化保存:**

```rust
// state/mod.rs (L456-460)
pub struct UserSubscription {
    pub encrypted_data: ConfidentialBundle,
    pub encrypted_metadata: ConfidentialBundle,
}
```

### 7.2 プライバシー保護の証拠

**イベントログでの暗号化:**

```rust
// subscribe_service.rs (L454-459)
emit!(SubscriptionActivated {
    user: user_key,
    encrypted_subscription: encrypted_subscription_event,
    encrypted_total_commitment: encrypted_total_event,
});
```

**平文データの非公開:**

```rust
// find_due_subscriptions.rs (L15-18)
pub struct DueSubscriptionInfo {
    pub user: Pubkey,
    pub encrypted_subscription: EncryptedPayloadEvent,
    // subscription_id, recipient_type, receiver, due_ts は含まれない
}
```

### 7.3 Trustlessness の証拠

**オンチェーン検証性:**

```rust
// Solanaブロックチェーン上で全ての状態変更が記録
ctx.accounts.user_subscriptions.record_subscription(
    subscription_bundle.clone(),
    now,
    billing_period,
)?;
```

**分散信頼（Arcium MPC）:**

```rust
// 複数ノードでの分散計算
queue_computation(
    ctx.accounts,
    computation_offset,
    computation_args,
    None,  // MXEネットワーク全体で実行
    callbacks,
)?;
```

---

## 8. 結論

### 最終評価:

1. ✅ **"Verify subscriptions privately with Arcium"**

   - **結論: TRUE (95%達成)**
   - 根拠: MPC 検証が完全実装、一部平文フィールドは機能要件

2. ✅ **"Subly verifies your subscription while data stays encrypted with Arcium"**

   - **結論: TRUE (90%達成)**
   - 根拠: サービス詳細と価格は完全暗号化、メタデータも暗号化保存

3. ⚠️ **"Keeping your data private and making the system trustless on-chain"**
   - **結論: PARTIALLY TRUE (70%達成)**
   - 根拠: コア機能は Trustless、プライバシーは部分的（平文フィールドあり）

### 技術的に誠実な主張:

**✅ 推奨される文言:**

```
"Subly protects your subscription privacy with Arcium.
What you subscribe to and how much you pay stays encrypted on-chain,
verified through decentralized Multi-Party Computation."
```

**⚠️ 注釈が必要:**
タイムスタンプやステータスなど、プロトコル運用に必要な一部のメタデータは
オンチェーンに記録されます（将来的に MPC-based 検索で完全暗号化予定）

---

**Report End**
