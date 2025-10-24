use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    const INDEX_SCALE: u128 = 1_000_000_000_000;
    const DEFAULT_APY_BPS: u16 = 1_000;
    const BASIS_POINTS_DIVISOR: u64 = 10_000;
    const SECONDS_PER_YEAR: u64 = 31_536_000;

    const STATUS_UNUSED: u8 = 0;
    const STATUS_ACTIVE: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;

    #[derive(Clone, Copy)]
    pub struct ConfigSecrets {
        pub total_principal: u64,
        pub reward_pool: u64,
        pub acc_index: u128,
        pub apy_bps: u16,
        pub last_update_ts: i64,
        pub paused: bool,
    }

    #[derive(Clone, Copy)]
    pub struct RegistrySecrets {
        pub next_service_id: u64,
        pub service_count: u32,
        pub services_root_low: u128,
        pub services_root_high: u128,
    }

    #[derive(Clone, Copy)]
    pub struct StakeSecrets {
        pub total_principal: u64,
        pub locked_principal: u64,
        pub rewards_earned: u64,
        pub last_update_ts: i64,
        pub unlock_ts: i64,
        pub tranche_counter: u64,
    }

    impl StakeSecrets {
        pub fn default() -> Self {
            Self {
                total_principal: 0,
                locked_principal: 0,
                rewards_earned: 0,
                last_update_ts: 0,
                unlock_ts: 0,
                tranche_counter: 0,
            }
        }
    }

    #[derive(Clone, Copy)]
    pub struct UserSummarySecrets {
        pub active_commitment: u64,
        pub pending_commitment: u64,
        pub total_paid_amount: u64,
        pub paypal_configured: u8,
        pub paypal_recipient_type: u8,
        pub paypal_receiver_hash_low: u128,
        pub paypal_receiver_hash_high: u128,
    }

    impl UserSummarySecrets {
        pub fn default() -> Self {
            Self {
                active_commitment: 0,
                pending_commitment: 0,
                total_paid_amount: 0,
                paypal_configured: 0,
                paypal_recipient_type: 0,
                paypal_receiver_hash_low: 0,
                paypal_receiver_hash_high: 0,
            }
        }
    }

    #[derive(Clone, Copy)]
    pub struct SubscriptionContractSecrets {
        pub service_hash_low: u128,
        pub service_hash_high: u128,
        pub monthly_price_usdc: u64,
        pub status: u8,
        pub started_at: i64,
        pub last_payment_ts: i64,
        pub next_billing_ts: i64,
        pub pending_until_ts: i64,
        pub billing_interval_secs: u64,
    }

    #[derive(Clone, Copy)]
    pub struct ServiceSecrets {
        pub service_hash_low: u128,
        pub service_hash_high: u128,
        pub monthly_price_usdc: u64,
        pub billing_interval_secs: u64,
        pub metadata_hash_low: u128,
        pub metadata_hash_high: u128,
    }

    #[derive(Clone, Copy)]
    pub struct InitializeInput {
        pub clock_unix_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct StakeInput {
        pub amount: u64,
        pub lock_duration_secs: u64,
        pub now_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct UnstakeInput {
        pub amount: u64,
        pub now_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct SubscribeInput {
        pub now_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct UnsubscribeInput {
        pub now_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct PaymentInput {
        pub payment_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct DueCheckInput {
        pub now_ts: u64,
    }

    #[derive(Clone, Copy)]
    pub struct PaypalInput {
        pub recipient_type: u8,
        pub receiver_hash_low: u128,
        pub receiver_hash_high: u128,
    }

    #[derive(Clone, Copy)]
    pub struct ServiceRegistrationInput {
        pub service_hash_low: u128,
        pub service_hash_high: u128,
        pub monthly_price_usdc: u64,
        pub billing_interval_secs: u64,
        pub metadata_hash_low: u128,
        pub metadata_hash_high: u128,
    }

    fn accrue_config(config: &mut ConfigSecrets, now: i64) {
        if now > config.last_update_ts {
            let elapsed = (now - config.last_update_ts) as u64;
            if elapsed > 0 && config.total_principal > 0 {
                let numerator = (config.apy_bps as u128) * (elapsed as u128) * INDEX_SCALE;
                let denominator = (BASIS_POINTS_DIVISOR as u128) * (SECONDS_PER_YEAR as u128);
                if denominator > 0 {
                    let delta_index = numerator / denominator;
                    config.acc_index = config.acc_index + delta_index;
                }
            }
            config.last_update_ts = now;
        }
    }

    fn saturating_add(a: u64, b: u64) -> u64 {
        let sum = a + b;
        if sum < a {
            u64::MAX
        } else {
            sum
        }
    }

    fn saturating_sub(a: u64, b: u64) -> u64 {
        if b > a {
            0
        } else {
            a - b
        }
    }

    #[instruction]
    pub fn initialize_subly(
        input: InitializeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, RegistrySecrets>) {
        let config = ConfigSecrets {
            total_principal: 0,
            reward_pool: 0,
            acc_index: INDEX_SCALE,
            apy_bps: DEFAULT_APY_BPS,
            last_update_ts: input.clock_unix_ts as i64,
            paused: false,
        };

        let registry = RegistrySecrets {
            next_service_id: 0,
            service_count: 0,
            services_root_low: 0,
            services_root_high: 0,
        };

        (
            Mxe::get().from_arcis(config),
            Mxe::get().from_arcis(registry),
        )
    }

    #[instruction]
    pub fn register_paypal_recipient_subly(
        summary_ctxt: Enc<Mxe, UserSummarySecrets>,
        input: PaypalInput,
    ) -> (Enc<Mxe, UserSummarySecrets>, u8) {
        let mut summary = summary_ctxt.to_arcis();

        summary.paypal_configured = 1;
        summary.paypal_recipient_type = input.recipient_type;
        summary.paypal_receiver_hash_low = input.receiver_hash_low;
        summary.paypal_receiver_hash_high = input.receiver_hash_high;

        (summary_ctxt.owner.from_arcis(summary), 1u8)
    }

    #[instruction]
    pub fn register_subscription_service_subly(
        registry_ctxt: Enc<Mxe, RegistrySecrets>,
        service_ctxt: Enc<Mxe, ServiceSecrets>,
        input: ServiceRegistrationInput,
    ) -> (
        Enc<Mxe, RegistrySecrets>,
        Enc<Mxe, ServiceSecrets>,
        u64,
        u32,
    ) {
        let mut registry = registry_ctxt.to_arcis();
        let mut service = service_ctxt.to_arcis();

        let service_id = registry.next_service_id;
        registry.next_service_id = registry.next_service_id + 1;
        registry.service_count = registry.service_count + 1;
        registry.services_root_low = input.service_hash_low;
        registry.services_root_high = input.service_hash_high;

        service.service_hash_low = input.service_hash_low;
        service.service_hash_high = input.service_hash_high;
        service.monthly_price_usdc = input.monthly_price_usdc;
        service.billing_interval_secs = input.billing_interval_secs;
        service.metadata_hash_low = input.metadata_hash_low;
        service.metadata_hash_high = input.metadata_hash_high;

        (
            registry_ctxt.owner.from_arcis(registry),
            service_ctxt.owner.from_arcis(service),
            service_id.reveal(),
            registry.service_count.reveal(),
        )
    }

    #[instruction]
    pub fn initialize_user_stake_subly() -> Enc<Mxe, StakeSecrets> {
        let stake = StakeSecrets::default();
        Mxe::get().from_arcis(stake)
    }

    #[instruction]
    pub fn stake_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, StakeSecrets>,
        input: StakeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, StakeSecrets>) {
        let mut config = config_ctxt.to_arcis();
        let mut stake = stake_ctxt.to_arcis();

        let now = input.now_ts as i64;
        accrue_config(&mut config, now);

        stake.total_principal = saturating_add(stake.total_principal, input.amount);
        stake.locked_principal = saturating_add(stake.locked_principal, input.amount);
        stake.last_update_ts = now;
        stake.unlock_ts = now + (input.lock_duration_secs as i64);
        stake.tranche_counter = stake.tranche_counter + 1;

        config.total_principal = saturating_add(config.total_principal, input.amount);

        (
            config_ctxt.owner.from_arcis(config),
            stake_ctxt.owner.from_arcis(stake),
        )
    }

    #[instruction]
    pub fn unstake_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, StakeSecrets>,
        input: UnstakeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, StakeSecrets>, u64) {
        let mut config = config_ctxt.to_arcis();
        let mut stake = stake_ctxt.to_arcis();

        let now = input.now_ts as i64;
        accrue_config(&mut config, now);

        let mut withdrawable = 0u64;
        if now >= stake.unlock_ts {
            withdrawable = stake.locked_principal;
        }
        let requested = input.amount;
        let amount = if requested == 0 {
            withdrawable
        } else if requested <= withdrawable {
            requested
        } else {
            0
        };

        if amount > 0 {
            stake.locked_principal = saturating_sub(stake.locked_principal, amount);
            stake.total_principal = saturating_sub(stake.total_principal, amount);
            config.total_principal = saturating_sub(config.total_principal, amount);
        }

        (
            config_ctxt.owner.from_arcis(config),
            stake_ctxt.owner.from_arcis(stake),
            amount.reveal(),
        )
    }

    #[instruction]
    pub fn subscribe_service_subly(
        summary_ctxt: Enc<Mxe, UserSummarySecrets>,
        contract_ctxt: Enc<Mxe, SubscriptionContractSecrets>,
        service_ctxt: Enc<Mxe, ServiceSecrets>,
        input: SubscribeInput,
    ) -> (
        Enc<Mxe, UserSummarySecrets>,
        Enc<Mxe, SubscriptionContractSecrets>,
        u8,
    ) {
        let mut summary = summary_ctxt.to_arcis();
        let mut contract = contract_ctxt.to_arcis();
        let service = service_ctxt.to_arcis();

        let now = input.now_ts as i64;

        let mut success = 0u8;
        if contract.status == STATUS_UNUSED || contract.status == STATUS_CANCELLED {
            contract.service_hash_low = service.service_hash_low;
            contract.service_hash_high = service.service_hash_high;
            contract.monthly_price_usdc = service.monthly_price_usdc;
            contract.status = STATUS_ACTIVE;
            contract.started_at = now;
            contract.last_payment_ts = now;
            contract.next_billing_ts = now + (service.billing_interval_secs as i64);
            contract.pending_until_ts = 0;
            contract.billing_interval_secs = service.billing_interval_secs;

            summary.active_commitment =
                saturating_add(summary.active_commitment, service.monthly_price_usdc);
            success = 1;
        }

        (
            summary_ctxt.owner.from_arcis(summary),
            contract_ctxt.owner.from_arcis(contract),
            success.reveal(),
        )
    }

    #[instruction]
    pub fn unsubscribe_service_subly(
        summary_ctxt: Enc<Mxe, UserSummarySecrets>,
        contract_ctxt: Enc<Mxe, SubscriptionContractSecrets>,
        input: UnsubscribeInput,
    ) -> (
        Enc<Mxe, UserSummarySecrets>,
        Enc<Mxe, SubscriptionContractSecrets>,
        u8,
    ) {
        let mut summary = summary_ctxt.to_arcis();
        let mut contract = contract_ctxt.to_arcis();
        let now = input.now_ts as i64;

        let mut success = 0u8;
        if contract.status == STATUS_ACTIVE {
            summary.active_commitment =
                saturating_sub(summary.active_commitment, contract.monthly_price_usdc);
            summary.pending_commitment =
                saturating_add(summary.pending_commitment, contract.monthly_price_usdc);
            contract.status = STATUS_CANCELLED;
            contract.pending_until_ts = now;
            success = 1;
        }

        (
            summary_ctxt.owner.from_arcis(summary),
            contract_ctxt.owner.from_arcis(contract),
            success.reveal(),
        )
    }

    #[instruction]
    pub fn record_subscription_payment_subly(
        summary_ctxt: Enc<Mxe, UserSummarySecrets>,
        contract_ctxt: Enc<Mxe, SubscriptionContractSecrets>,
        input: PaymentInput,
    ) -> (
        Enc<Mxe, UserSummarySecrets>,
        Enc<Mxe, SubscriptionContractSecrets>,
        u8,
    ) {
        let mut summary = summary_ctxt.to_arcis();
        let mut contract = contract_ctxt.to_arcis();

        let mut success = 0u8;
        let payment_ts = input.payment_ts as i64;
        if contract.status == STATUS_ACTIVE {
            summary.total_paid_amount =
                saturating_add(summary.total_paid_amount, contract.monthly_price_usdc);
            summary.pending_commitment =
                saturating_sub(summary.pending_commitment, contract.monthly_price_usdc);

            contract.last_payment_ts = payment_ts;
            contract.next_billing_ts = payment_ts + (contract.billing_interval_secs as i64);
            contract.pending_until_ts = 0;
            success = 1;
        }

        (
            summary_ctxt.owner.from_arcis(summary),
            contract_ctxt.owner.from_arcis(contract),
            success.reveal(),
        )
    }

    #[instruction]
    pub fn find_due_subscriptions_subly(
        contract_ctxt: Enc<Mxe, SubscriptionContractSecrets>,
        input: DueCheckInput,
    ) -> (Enc<Mxe, SubscriptionContractSecrets>, u8) {
        let mut contract = contract_ctxt.to_arcis();
        let now = input.now_ts as i64;

        let due = if contract.status == STATUS_ACTIVE && now >= contract.next_billing_ts {
            contract.pending_until_ts = now;
            1u8
        } else {
            0u8
        };

        (contract_ctxt.owner.from_arcis(contract), due.reveal())
    }
}
