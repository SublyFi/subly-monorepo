# Subly Privacy Layer - Privacy Audit Report

**Date**: 2025 年 10 月 26 日  
**Version**: Phase 3 実装後

---

## Executive Summary

✅ **暗号化済み**: サービス ID、価格情報  
⚠️ **平文で保存**: タイムスタンプ、ステータス情報  
🔴 **リスク**: アカウントデータの直接読み取りによる情報漏洩

---

## 1. 暗号化状況の詳細分析

### 1.1 完全に保護されている情報 ✅

| データ               | 暗号化方式   | 復号可能者 | 保存場所                              |
| -------------------- | ------------ | ---------- | ------------------------------------- |
| `service_id`         | MXE (Arcium) | MXE のみ   | `UserSubscription.encrypted_data`     |
| `monthly_price`      | MXE (Arcium) | MXE のみ   | `UserSubscription.encrypted_data`     |
| `metadata (Phase 3)` | MXE (Arcium) | MXE のみ   | `UserSubscription.encrypted_metadata` |

**セキュリティ評価**: 🟢 **EXCELLENT**

- 第三者はサービス内容や価格を知ることができない
- MXE ネットワークの秘密鍵でのみ復号可能
- イベントでも暗号化データのみ公開

---

### 1.2 平文で保存されている情報 ⚠️

#### オンチェーンアカウントに平文保存されているフィールド

```rust
pub struct UserSubscription {
    pub id: u64,                           // ⚠️ 平文（連番ID）
    pub started_at: i64,                   // 🔴 平文（開始日時）
    pub last_payment_ts: i64,              // 🔴 平文（最終支払日時）
    pub next_billing_ts: i64,              // 🔴 平文（次回請求日）
    pub pending_until_ts: i64,             // 🔴 平文（キャンセル予定日）
    pub status: SubscriptionStatus,        // 🔴 平文（Active/Cancelled）
    pub initial_payment_recorded: bool,    // ⚠️ 平文（支払済みフラグ）
    // ...
}
```

**セキュリティ評価**: 🔴 **HIGH RISK**

#### 読み取り可能な情報の例

```typescript
// 誰でも実行可能なコード
const connection = new Connection("https://api.mainnet-beta.solana.com");
const userPda = PublicKey.findProgramAddressSync(
  [Buffer.from("user_subscriptions"), userWallet.toBuffer()],
  programId
)[0];

const accountInfo = await connection.getAccountInfo(userPda);
const userSubscriptions = deserialize(accountInfo.data);

// 🔴 以下の情報が第三者に漏洩
console.log(
  "Subscription started:",
  new Date(userSubscriptions.subscriptions[0].started_at * 1000)
);
console.log(
  "Last payment:",
  new Date(userSubscriptions.subscriptions[0].last_payment_ts * 1000)
);
console.log(
  "Next billing:",
  new Date(userSubscriptions.subscriptions[0].next_billing_ts * 1000)
);
console.log("Status:", userSubscriptions.subscriptions[0].status); // "Active" or "Cancelled"
```

---

## 2. 機能別プライバシー分析

### 2.1 Subscribe Service（サブスクリプション開始）

**暗号化フロー**:

```
Client encrypts (service_id, monthly_price)
    ↓
MPC processes encrypted inputs
    ↓
Callback stores encrypted_data (ConfidentialBundle)
    ↓
Event emits only encrypted data
```

**平文で保存される情報**:

- `started_at`: サブスク開始日時 🔴
- `next_billing_ts`: 初回請求日 🔴
- `status`: "Active" 🔴

**リスク**: 第三者が「いつサブスクを開始したか」を知ることができる

---

### 2.2 Find Due Subscriptions（期限切れ検索）

**コード分析**:

```rust
// find_due_subscriptions.rs (L69-73)
if subscription.status != SubscriptionStatus::Active {
    continue;  // 🔴 平文のstatusを使用
}
if !initial_payment_pending && subscription.next_billing_ts > upper_bound {
    continue;  // 🔴 平文のnext_billing_tsを使用
}
```

**問題点**:

- オペレーターがサブスクを検索するために**平文のタイムスタンプとステータスが必要**
- これらのフィールドを削除すると機能が動作しない

**イベントのプライバシー**:
✅ イベントには暗号化データのみ含まれる（コメントで明記）

```rust
// subscription_id, recipient_type, receiver, due_ts, and initial_payment_recorded
// are not exposed for privacy. Backend processes encrypted_subscription to extract needed info.
```

---

### 2.3 Record Payment（支払い記録）

**コード分析**:

```rust
// state/mod.rs (L639-654)
subscription.last_payment_ts = now;  // 🔴 平文で更新
if subscription.status == SubscriptionStatus::Active {
    subscription.next_billing_ts = next_due;  // 🔴 平文で更新
} else {
    subscription.status = SubscriptionStatus::Cancelled;  // 🔴 平文で更新
}
```

**リスク**:

- 支払いごとに`last_payment_ts`が更新され、支払いパターンが可視化される
- アクティブなサブスクの場合、次回請求日も更新される

---

### 2.4 Create Subscription Metadata (Phase 3)

**実装状況**: ✅ **完了**

```rust
// encrypted_metadata に以下が暗号化保存される：
// - started_at (MXE暗号化)
// - last_payment_ts (MXE暗号化)
// - next_billing_ts (MXE暗号化)
// - status (MXE暗号化)
```

**問題**:

- ✅ `encrypted_metadata`は完全に暗号化されている
- 🔴 **しかし、レガシーフィールド（平文）も並行して保存・更新されている**
- レガシーフィールドを削除すると`find_due_subscriptions`が動作しなくなる

---

## 3. プライバシーリスクの定量評価

### 3.1 情報漏洩のリスクレベル

| 情報        | 漏洩経路     | リスクレベル  | 影響                       |
| ----------- | ------------ | ------------- | -------------------------- |
| サービス ID | ❌ なし      | 🟢 **LOW**    | 暗号化済み                 |
| 月額料金    | ❌ なし      | 🟢 **LOW**    | 暗号化済み                 |
| 開始日時    | RPC 読み取り | 🔴 **HIGH**   | 行動パターン推測可能       |
| 支払日時    | RPC 読み取り | 🔴 **HIGH**   | 定期的な支払いパターン把握 |
| 次回請求日  | RPC 読み取り | 🟡 **MEDIUM** | 将来の行動予測可能         |
| ステータス  | RPC 読み取り | 🔴 **HIGH**   | サブスク継続/中止が判明    |

### 3.2 攻撃シナリオ例

#### シナリオ 1: 支払いパターン分析

```python
# 攻撃者のスクリプト例
for subscription in user_subscriptions:
    payment_interval = subscription.next_billing_ts - subscription.last_payment_ts
    print(f"User pays every {payment_interval / 86400} days")
    # 🔴 生活リズムや経済状況が推測可能
```

#### シナリオ 2: キャンセル監視

```python
# サブスクキャンセルを検知
if subscription.status == "PendingCancellation":
    cancellation_date = subscription.pending_until_ts
    print(f"User will cancel subscription on {cancellation_date}")
    # 🔴 ユーザーの意思決定が漏洩
```

#### シナリオ 3: タイムライン構築

```python
# ユーザーの行動履歴を構築
timeline = []
for sub in all_subscriptions:
    timeline.append({
        "started": sub.started_at,
        "payments": sub.last_payment_ts,
        "status": sub.status
    })
# 🔴 詳細な行動プロファイリングが可能
```

---

## 4. アーキテクチャ上の矛盾点

### 4.1 レガシーフィールドの必要性

**現状**: Phase 3 で`encrypted_metadata`を実装したが、以下の理由でレガシーフィールドを削除できない：

1. **`find_due_subscriptions`の依存**

   ```rust
   // 平文のnext_billing_tsとstatusが必要
   if subscription.next_billing_ts > upper_bound { ... }
   if subscription.status != SubscriptionStatus::Active { ... }
   ```

2. **`record_payment`の依存**

   ```rust
   // 平文フィールドを直接更新
   subscription.last_payment_ts = now;
   subscription.next_billing_ts = next_due;
   ```

3. **`begin_cancellation`の依存**
   ```rust
   // 平文のstatusとpending_until_tsを使用
   subscription.status = SubscriptionStatus::PendingCancellation;
   subscription.pending_until_ts = pending_until;
   ```

### 4.2 設計上の課題

**矛盾**:

- `encrypted_metadata`は MXE のみが復号可能
- しかしオペレーターは期限切れサブスクを検索する必要がある
- オペレーターは MXE 秘密鍵にアクセスできない

**現在の妥協案**:

- データを二重保存（暗号化 + 平文）
- 平文フィールドは「後方互換性のため」という名目で残す
- **結果**: プライバシーは実質的に保護されていない

---

## 5. 推奨される改善策

### 5.1 短期的対策（即時実施可能）

#### 対策 1: アカウント読み取り制限の明示

```rust
/// WARNING: This account contains privacy-sensitive plaintext fields.
/// External applications MUST NOT read or display:
/// - started_at, last_payment_ts, next_billing_ts, pending_until_ts, status
/// These fields are for protocol internal use only.
#[account]
pub struct UserSubscriptions { ... }
```

#### 対策 2: クライアント SDK での警告

```typescript
// SDK usage example
const subscriptions = await program.account.userSubscriptions.fetch(pda);
// ⚠️ WARNING: Do not expose plaintext timestamp/status fields publicly
```

**効果**: 🟡 **LIMITED** - 技術的制約はなく、悪意ある第三者は無視可能

---

### 5.2 中期的対策（要設計変更）

#### 対策 3: Homomorphic Encryption for Comparisons

**アプローチ**: 暗号化されたまま比較可能な暗号方式を使用

```rust
// 概念コード
pub encrypted_next_billing_ts: HomomorphicTimestamp;

// 暗号化されたまま比較
if encrypted_next_billing_ts.is_due(encrypted_current_time) {
    // 期限切れサブスクとして処理
}
```

**課題**:

- Solana での準同型暗号の実装コスト
- 計算量の増加
- Arcium/MXE での対応状況不明

---

#### 対策 4: Zero-Knowledge Proofs for Status

**アプローチ**: ステータスを公開せず、ZKP で証明

```rust
// ユーザーが「このサブスクはアクティブである」ことを証明
pub active_status_proof: ZKProof;

// オペレーターは証明を検証するだけ
require!(verify_proof(active_status_proof), "Invalid status");
```

**課題**:

- ZKP ライブラリの統合
- 証明生成のオーバーヘッド
- Solana compute units の制約

---

### 5.3 長期的対策（要アーキテクチャ刷新）

#### 対策 5: MPC-based Due Subscription Detection

**アプローチ**: MXE が期限切れ検索を実行

```rust
// MPC computation definition
fn find_due_subscriptions_mpc(
    encrypted_subscriptions: Vec<EncryptedSubscription>,
    encrypted_current_time: EncryptedTimestamp,
    encrypted_lookahead: EncryptedDuration
) -> Vec<EncryptedSubscriptionId> {
    // MXE内で復号・比較・再暗号化
    // 結果のみを返す
}
```

**利点**:

- ✅ 平文フィールド不要
- ✅ 完全なプライバシー保護
- ✅ オペレーターは結果のみ受け取る

**課題**:

- MPC computation の設計・実装コスト
- Arcium の計算能力・レイテンシ
- 複雑なロジックの MPC 化

---

#### 対策 6: Trusted Execution Environment (TEE)

**アプローチ**: SGX などの TEE で処理

```rust
// TEE enclave内で実行
enclave.execute(|| {
    let subscriptions = decrypt_all(encrypted_subscriptions);
    let due = subscriptions.filter(|s| s.next_billing_ts <= now);
    encrypt_and_return(due)
});
```

**利点**:

- ✅ 複雑なロジックも実行可能
- ✅ パフォーマンスが高い

**課題**:

- Solana との統合方法
- TEE のセキュリティ仮定（Side-channel attacks）
- インフラ運用コスト

---

## 6. 結論

### 6.1 現状の評価

**Phase 3 実装後の状態**:

- ✅ サービス ID・価格は完全に暗号化されている
- ✅ `encrypted_metadata`フィールドが追加され、メタデータも暗号化保存可能
- 🔴 **しかし、平文のレガシーフィールドが依然として存在し、誰でも読み取り可能**
- 🔴 オペレーター機能（期限切れ検索、支払い記録）が平文フィールドに依存

### 6.2 プライバシー保護レベル

| 観点                 | 評価           | 理由                             |
| -------------------- | -------------- | -------------------------------- |
| **イベントログ**     | 🟢 **GOOD**    | 暗号化データのみ公開             |
| **アカウントデータ** | 🔴 **POOR**    | タイムスタンプ・ステータスが平文 |
| **総合評価**         | 🟡 **PARTIAL** | 部分的なプライバシー保護のみ     |

### 6.3 質問への回答

> **「これでユーザーのサブスクリプション情報は全て第三者からみても Privacy が保たれていると言えますか？」**

**回答**: ❌ **いいえ、完全なプライバシー保護は達成されていません。**

**理由**:

1. **サービス内容と価格**: ✅ 完全に保護されている（MXE 暗号化）
2. **タイムスタンプ情報**: 🔴 **平文で漏洩している**
   - 開始日時、支払い日時、次回請求日が誰でも読み取り可能
3. **ステータス情報**: 🔴 **平文で漏洩している**
   - Active/Cancelled/PendingCancellation が誰でも読み取り可能

**具体的なリスク**:

- 第三者が RPC 経由で`UserSubscriptions`アカウントを読み取ると：
  - ✅ どのサービスを契約しているかは**わからない**
  - ✅ 月額いくら払っているかは**わからない**
  - 🔴 いつサブスクを開始したかは**わかる**
  - 🔴 最後にいつ支払ったかは**わかる**
  - 🔴 次回請求日はいつかは**わかる**
  - 🔴 現在アクティブかキャンセル済みかは**わかる**

---

## 7. 推奨アクション

### 優先度 1: 即時対応

- [ ] ドキュメントに平文フィールドのリスクを明記
- [ ] クライアント SDK にプライバシー警告を追加
- [ ] 外部向け API ではタイムスタンプ・ステータスを除外

### 優先度 2: 次回スプリント

- [ ] MPC-based due subscription detection の設計
- [ ] Arcium チームと協議（準同型演算のサポート確認）
- [ ] 代替アーキテクチャの Proof of Concept

### 優先度 3: 長期ロードマップ

- [ ] 完全プライバシー保護版の設計・実装
- [ ] レガシーフィールドの段階的廃止計画
- [ ] TEE/ZKP 統合の検討

---

## 8. 参考資料

- [Arcium Documentation](https://docs.arcium.com/)
- [Solana Account Model](https://docs.solana.com/developing/programming-model/accounts)
- [Homomorphic Encryption on Blockchain](https://eprint.iacr.org/2019/723.pdf)
- [Zero-Knowledge Proofs for Privacy](https://zkproof.org/)

---

**Report End**
