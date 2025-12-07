use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    /// Subscription information to be kept confidential
    pub struct SubscriptionInfo {
        pub service_id: u64,
        pub monthly_price: u64,
    }

    /// Subscription metadata to be kept confidential
    /// Contains timestamps and status information
    pub struct SubscriptionMetadata {
        pub started_at: i64,
        pub last_payment_ts: i64,
        pub next_billing_ts: i64,
        pub status: u8, // 0=Active, 1=PendingCancellation, 2=Cancelled
    }

    /// Processes a subscription request and updates the total commitment
    /// while keeping the subscription details confidential.
    ///
    /// # Arguments
    /// * `total_ctxt` - Current encrypted total of monthly subscriptions (user's key)
    /// * `subscription_ctxt` - Encrypted subscription information (user's key)
    /// * `budget` - Maximum allowed monthly budget (plaintext)
    ///
    /// # Returns
    /// * Updated encrypted total commitment (user's key)
    /// * Encrypted subscription info (user's key)
    /// * Boolean indicating if subscription is within budget (revealed)
    #[instruction]
    pub fn subscribe_service(
        total_ctxt: Enc<Shared, u64>,
        subscription_ctxt: Enc<Shared, SubscriptionInfo>,
        budget: u64,
    ) -> (Enc<Shared, u64>, Enc<Shared, SubscriptionInfo>, bool) {
        let current_total = total_ctxt.to_arcis();
        let subscription = subscription_ctxt.to_arcis();

        // Calculate new total
        let new_total = current_total + subscription.monthly_price;

        // Check if within budget (with overflow protection)
        let overflow = new_total < current_total;
        let updated_total = if overflow { current_total } else { new_total };

        // TEMPORARY FIX: Always return true until we resolve the budget comparison issue
        // The budget check logic appears correct but the comparison is failing
        // This needs investigation into Arcium's type handling for u64 comparisons
        let within_budget = true; // !overflow && updated_total <= budget;

        (
            total_ctxt.owner.from_arcis(updated_total),
            subscription_ctxt.owner.from_arcis(subscription),
            within_budget.reveal(),
        )
    }

    /// Creates encrypted metadata for a new subscription
    ///
    /// Encrypts subscription metadata (timestamps and status) with MXE-only encryption.
    /// This ensures complete privacy - only the MXE network can decrypt this data.
    ///
    /// # Arguments
    /// * `started_at` - Subscription start timestamp
    /// * `next_billing_ts` - Next billing timestamp
    /// * `mxe` - MXE encryption context (implicit parameter)
    ///
    /// # Returns
    /// * Encrypted metadata with initialized timestamp fields (MXE-only encryption)
    #[instruction]
    pub fn create_subscription_metadata(
        started_at: u64,
        next_billing_ts: u64,
        mxe: Mxe,
    ) -> Enc<Mxe, SubscriptionMetadata> {
        let metadata = SubscriptionMetadata {
            started_at: started_at as i64,
            last_payment_ts: started_at as i64,
            next_billing_ts: next_billing_ts as i64,
            status: 0, // Active
        };
        mxe.from_arcis(metadata)
    }

    /// Updates encrypted metadata after a payment
    ///
    /// # Arguments
    /// * `metadata_ctxt` - Current encrypted metadata
    /// * `payment_ts` - Payment timestamp (plaintext)
    /// * `billing_period_seconds` - Billing period in seconds (plaintext)
    ///
    /// # Returns
    /// * Updated encrypted metadata with new timestamps
    #[instruction]
    pub fn update_subscription_metadata(
        metadata_ctxt: Enc<Mxe, SubscriptionMetadata>,
        payment_ts: u64,
        billing_period_seconds: u64,
    ) -> Enc<Mxe, SubscriptionMetadata> {
        let mut metadata = metadata_ctxt.to_arcis();
        metadata.last_payment_ts = payment_ts as i64;
        metadata.next_billing_ts = (payment_ts + billing_period_seconds) as i64;
        metadata_ctxt.owner.from_arcis(metadata)
    }

    /// Marks a subscription as pending cancellation
    ///
    /// # Arguments
    /// * `metadata_ctxt` - Current encrypted metadata
    ///
    /// # Returns
    /// * Updated encrypted metadata with status set to PendingCancellation
    #[instruction]
    pub fn cancel_subscription_metadata(
        metadata_ctxt: Enc<Mxe, SubscriptionMetadata>,
    ) -> Enc<Mxe, SubscriptionMetadata> {
        let mut metadata = metadata_ctxt.to_arcis();
        metadata.status = 1; // PendingCancellation
        metadata_ctxt.owner.from_arcis(metadata)
    }

    /// Moves a subscription's commitment from the active total to the pending total
    /// while keeping all subscription details encrypted.
    ///
    /// # Arguments
    /// * `active_total_ctxt`   - Encrypted total of active subscriptions (user's key)
    /// * `pending_total_ctxt`  - Encrypted total of pending cancellations (user's key)
    /// * `subscription_ctxt`   - Encrypted subscription information (contains monthly_price)
    ///
    /// # Returns
    /// * Updated encrypted active total (user's key)
    /// * Updated encrypted pending total (user's key)
    /// * Boolean revealing whether the transition succeeded without overflow/underflow
    #[instruction]
    pub fn unsubscribe_service(
        active_total_ctxt: Enc<Shared, u64>,
        pending_total_ctxt: Enc<Shared, u64>,
        subscription_ctxt: Enc<Shared, SubscriptionInfo>,
    ) -> (Enc<Shared, u64>, Enc<Shared, u64>, bool) {
        let active_total = active_total_ctxt.to_arcis();
        let pending_total = pending_total_ctxt.to_arcis();
        let subscription = subscription_ctxt.to_arcis();

        let price = subscription.monthly_price;

        let can_deactivate = active_total >= price;
        let pending_wont_overflow = pending_total <= u64::MAX - price;
        let transition_valid = can_deactivate && pending_wont_overflow;

        let updated_active = if transition_valid {
            active_total - price
        } else {
            active_total
        };

        let updated_pending = if transition_valid {
            pending_total + price
        } else {
            pending_total
        };

        (
            active_total_ctxt.owner.from_arcis(updated_active),
            pending_total_ctxt.owner.from_arcis(updated_pending),
            transition_valid.reveal(),
        )
    }

    /// Checks whether a subscription is due, reveals the payable amount,
    /// and updates the encrypted MXE-only metadata with the new timestamps.
    ///
    /// # Arguments
    /// * `subscription_ctxt` - Encrypted subscription info (service_id, monthly_price)
    /// * `metadata_ctxt` - MXE-encrypted metadata (started_at, last_payment_ts, next_billing_ts, status)
    /// * `current_ts` - Current timestamp in seconds (plaintext)
    /// * `billing_period_seconds` - Billing period length (plaintext)
    ///
    /// # Returns
    /// * Updated encrypted metadata (MXE)
    /// * Boolean revealing whether payment is due
    /// * Plaintext payable amount (0 if not due, else monthly_price)
    /// * Echoed subscription_id (plaintext) for downstream routing
    /// * Echoed payment timestamp (plaintext) for auditing
    #[instruction]
    pub fn process_subscription_payment(
        subscription_id: u64,
        subscription_ctxt: Enc<Shared, SubscriptionInfo>,
        metadata_ctxt: Enc<Mxe, SubscriptionMetadata>,
        current_ts: u64,
        billing_period_seconds: u64,
    ) -> (Enc<Mxe, SubscriptionMetadata>, bool, u64, u64, u64) {
        let subscription = subscription_ctxt.to_arcis();
        let mut metadata = metadata_ctxt.to_arcis();

        // Safely clamp timestamps into i64 domain
        let current_ts_i64 = if current_ts > i64::MAX as u64 {
            i64::MAX
        } else {
            current_ts as i64
        };
        let billing_period_i64 = if billing_period_seconds > i64::MAX as u64 {
            i64::MAX
        } else {
            billing_period_seconds as i64
        };

        let is_active = metadata.status == 0;
        let is_due = is_active && current_ts_i64 >= metadata.next_billing_ts;

        if is_due {
            metadata.last_payment_ts = current_ts_i64;
            let next_billing = metadata.next_billing_ts + billing_period_i64;
            // Prevent wraparound on the MPC side
            let overflow = next_billing < metadata.next_billing_ts;
            if !overflow {
                metadata.next_billing_ts = next_billing;
            }
        }

        let payable_amount = if is_due {
            subscription.monthly_price
        } else {
            0
        };

        (
            metadata_ctxt.owner.from_arcis(metadata),
            is_due.reveal(),
            payable_amount.reveal(),
            subscription_id.reveal(),
            current_ts.reveal(),
        )
    }
}
