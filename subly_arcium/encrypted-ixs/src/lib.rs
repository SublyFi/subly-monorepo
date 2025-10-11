use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    const INDEX_SCALE: u128 = 1_000_000_000_000;
    const DEFAULT_APY_BPS: u16 = 1_000;
    const BASIS_POINTS_DIVISOR: u64 = 10_000;
    const SECONDS_PER_YEAR: u64 = 31_536_000;
    const MAX_STAKE_ENTRIES: usize = 16;
    const LOCK_OPTIONS: [i64; 4] = [30 * 86_400, 90 * 86_400, 180 * 86_400, 365 * 86_400];

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
    pub struct StakeEntrySecrets {
        pub tranche_id: u64,
        pub principal: u64,
        pub deposited_at: i64,
        pub lock_end_ts: i64,
        pub lock_duration: i64,
        pub start_acc_index: u128,
        pub last_acc_index: u128,
        pub claimed_operator: u64,
        pub claimed_user: u64,
        pub unrealized_yield: u64,
    }

    impl StakeEntrySecrets {
        fn reset(&mut self) {
            self.tranche_id = 0;
            self.principal = 0;
            self.deposited_at = 0;
            self.lock_end_ts = 0;
            self.lock_duration = 0;
            self.start_acc_index = 0;
            self.last_acc_index = 0;
            self.claimed_operator = 0;
            self.claimed_user = 0;
            self.unrealized_yield = 0;
        }
    }

    #[derive(Clone, Copy)]
    pub struct UserStakeSecrets {
        pub total_principal: u64,
        pub last_updated_ts: i64,
        pub next_tranche_id: u64,
        pub entry_count: u8,
        pub entries: [StakeEntrySecrets; MAX_STAKE_ENTRIES],
    }

    pub const MAX_USER_SUBSCRIPTIONS: usize = 4;
    const SUB_STATUS_UNUSED: u8 = 0;
    const SUB_STATUS_ACTIVE: u8 = 1;
    const SUB_STATUS_PENDING: u8 = 2;
    const SUB_STATUS_CANCELLED: u8 = 3;

    #[derive(Clone, Copy)]
    pub struct SubscriptionSecrets {
        pub id: u64,
        pub service_id: u64,
        pub monthly_price_usdc: u64,
        pub started_at: i64,
        pub last_payment_ts: i64,
        pub next_billing_ts: i64,
        pub pending_until_ts: i64,
        pub status: u8,
        pub initial_payment_recorded: bool,
    }

    impl SubscriptionSecrets {
        fn reset(&mut self) {
            self.id = 0;
            self.service_id = 0;
            self.monthly_price_usdc = 0;
            self.started_at = 0;
            self.last_payment_ts = 0;
            self.next_billing_ts = 0;
            self.pending_until_ts = 0;
            self.status = SUB_STATUS_UNUSED;
            self.initial_payment_recorded = false;
        }

        fn is_available(&self) -> bool {
            self.status == SUB_STATUS_UNUSED || self.status == SUB_STATUS_CANCELLED
        }

        fn is_active_or_pending(&self) -> bool {
            self.status == SUB_STATUS_ACTIVE || self.status == SUB_STATUS_PENDING
        }
    }

    #[derive(Clone, Copy)]
    pub struct UserSubscriptionsSecrets {
        pub next_subscription_id: u64,
        pub total_active_commitment: u64,
        pub total_pending_commitment: u64,
        pub paypal_configured: bool,
        pub paypal_recipient_type: u8,
        pub paypal_receiver_hash_low: u128,
        pub paypal_receiver_hash_high: u128,
        pub subscriptions: [SubscriptionSecrets; MAX_USER_SUBSCRIPTIONS],
    }

    impl UserSubscriptionsSecrets {
        fn refresh(&mut self, now: i64) -> bool {
            let mut released: u64 = 0;
            for idx in 0..MAX_USER_SUBSCRIPTIONS {
                let slot_ref = &mut self.subscriptions[idx];
                let is_pending = slot_ref.status == SUB_STATUS_PENDING;
                let pending_until = slot_ref.pending_until_ts;
                let can_finalize = is_pending && pending_until > 0 && now >= pending_until;
                if can_finalize {
                    released = released + slot_ref.monthly_price_usdc;
                    slot_ref.status = SUB_STATUS_CANCELLED;
                    slot_ref.pending_until_ts = 0;
                    slot_ref.last_payment_ts = 0;
                    slot_ref.next_billing_ts = 0;
                }
            }

            let mut ok = true;
            if released > 0 {
                if released > self.total_pending_commitment {
                    ok = false;
                } else {
                    self.total_pending_commitment = self.total_pending_commitment - released;
                }
            }

            ok
        }

        fn has_active_or_pending(&self, service_id: u64) -> bool {
            let mut found = false;
            for idx in 0..MAX_USER_SUBSCRIPTIONS {
                let slot = self.subscriptions[idx];
                let matches_service = slot.service_id == service_id;
                let active_or_pending = slot.is_active_or_pending();
                if matches_service && active_or_pending {
                    found = true;
                }
            }
            found
        }

        fn allocate_slot_index(&mut self) -> usize {
            let mut found: usize = MAX_USER_SUBSCRIPTIONS;
            for idx in 0..MAX_USER_SUBSCRIPTIONS {
                let slot = self.subscriptions[idx];
                if slot.is_available() && found == MAX_USER_SUBSCRIPTIONS {
                    found = idx;
                }
            }
            if found < MAX_USER_SUBSCRIPTIONS {
                self.subscriptions[found].reset();
            }
            found
        }

        fn find_subscription_index(&self, subscription_id: u64) -> usize {
            let mut found: usize = MAX_USER_SUBSCRIPTIONS;
            for idx in 0..MAX_USER_SUBSCRIPTIONS {
                let slot = self.subscriptions[idx];
                let matches_id = slot.id == subscription_id;
                if matches_id && slot.is_active_or_pending() && found == MAX_USER_SUBSCRIPTIONS {
                    found = idx;
                }
            }
            found
        }
    }

    #[derive(Clone, Copy)]
    pub struct ServiceSecrets {
        pub id: u64,
        pub monthly_price_usdc: u64,
        pub created_at: i64,
        pub creator_low: u128,
        pub creator_high: u128,
        pub name_hash_low: u128,
        pub name_hash_high: u128,
        pub details_hash_low: u128,
        pub details_hash_high: u128,
        pub logo_hash_low: u128,
        pub logo_hash_high: u128,
        pub provider_hash_low: u128,
        pub provider_hash_high: u128,
    }

    pub struct InitializeInput {
        pub clock_unix_ts: u64,
    }

    pub struct StakeInput {
        pub amount: u64,
        pub lock_option: u8,
        pub now_ts: u64,
    }

    pub struct UnstakeInput {
        pub tranche_id: u64,
        pub now_ts: u64,
    }

    #[instruction]
    pub fn initialize_subly(
        input: InitializeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, RegistrySecrets>) {
        let config_secrets = ConfigSecrets {
            total_principal: 0,
            reward_pool: 0,
            acc_index: INDEX_SCALE,
            apy_bps: DEFAULT_APY_BPS,
            last_update_ts: input.clock_unix_ts as i64,
            paused: false,
        };

        let registry_secrets = RegistrySecrets {
            next_service_id: 0,
            service_count: 0,
            services_root_low: 0,
            services_root_high: 0,
        };

        let config_cipher = Mxe::get();
        let registry_cipher = Mxe::get();

        (
            config_cipher.from_arcis(config_secrets),
            registry_cipher.from_arcis(registry_secrets),
        )
    }

    #[instruction]
    pub fn stake_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, UserStakeSecrets>,
        input: StakeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, UserStakeSecrets>, u8, u64) {
        let mut config = config_ctxt.to_arcis();
        let mut stake_state = stake_ctxt.to_arcis();

        let now = input.now_ts as i64;
        accrue_config(&mut config, now);
        sync_entries(&mut stake_state, config.acc_index, now);

        let mut updated_config = config;
        let mut updated_stake = stake_state;
        let mut placed = false;

        let lock_option_index = input.lock_option as usize;
        if input.amount > 0 && lock_option_index < LOCK_OPTIONS.len() {
            let lock_duration = LOCK_OPTIONS[lock_option_index];
            if lock_duration > 0 {
                let current_count = updated_stake.entry_count as usize;
                if current_count < MAX_STAKE_ENTRIES {
                    let tranche_id = updated_stake.next_tranche_id;
                    let next_id = tranche_id + 1;
                    populate_entry(
                        &mut updated_stake.entries[current_count],
                        tranche_id,
                        input.amount,
                        now,
                        lock_duration,
                        config.acc_index,
                    );
                    updated_stake.total_principal = updated_stake.total_principal + input.amount;
                    updated_stake.last_updated_ts = now;
                    updated_stake.entry_count = (current_count as u8) + 1;
                    updated_stake.next_tranche_id = next_id;
                    updated_config.total_principal = updated_config.total_principal + input.amount;
                    placed = true;
                }
            }
        }

        let final_stake = if placed { updated_stake } else { stake_state };
        let final_config = if placed { updated_config } else { config };
        let final_entry_count = final_stake.entry_count;
        let final_next_tranche_id = final_stake.next_tranche_id;

        let public_entry_count = final_entry_count.reveal();
        let public_next_tranche_id = final_next_tranche_id.reveal();

        (
            config_ctxt.owner.from_arcis(final_config),
            stake_ctxt.owner.from_arcis(final_stake),
            public_entry_count,
            public_next_tranche_id,
        )
    }

    #[instruction]
    pub fn unstake_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, UserStakeSecrets>,
        input: UnstakeInput,
    ) -> (Enc<Mxe, ConfigSecrets>, Enc<Mxe, UserStakeSecrets>, u64, u8) {
        let mut config = config_ctxt.to_arcis();
        let mut stake_state = stake_ctxt.to_arcis();

        let now = input.now_ts as i64;
        accrue_config(&mut config, now);
        sync_entries(&mut stake_state, config.acc_index, now);

        let mut updated_config = config;
        let mut updated_stake = stake_state;
        let mut withdrawn_principal: u64 = 0;
        let mut removed_index: usize = MAX_STAKE_ENTRIES;

        let active_count = updated_stake.entry_count as usize;
        for idx in 0..MAX_STAKE_ENTRIES {
            let within_active = idx < active_count;
            let not_found_yet = removed_index == MAX_STAKE_ENTRIES;
            if within_active && not_found_yet {
                let entry = updated_stake.entries[idx];
                let matches_tranche = entry.tranche_id == input.tranche_id;
                let has_principal = entry.principal > 0;
                let lock_finished = now >= entry.lock_end_ts;
                let yield_cleared = entry.unrealized_yield == 0;
                if matches_tranche && has_principal && lock_finished && yield_cleared {
                    withdrawn_principal = entry.principal;
                    removed_index = idx;
                }
            }
        }

        if removed_index < active_count {
            let last_index = active_count - 1;
            let replacement = updated_stake.entries[last_index];

            if removed_index != last_index {
                updated_stake.entries[removed_index] = replacement;
            }
            updated_stake.entries[last_index].reset();
            updated_stake.entry_count = last_index as u8;
            updated_stake.total_principal = updated_stake.total_principal - withdrawn_principal;
            updated_stake.last_updated_ts = now;
            updated_config.total_principal = updated_config.total_principal - withdrawn_principal;
        } else {
            withdrawn_principal = 0;
        }

        let final_stake = if withdrawn_principal > 0 {
            updated_stake
        } else {
            stake_state
        };

        let final_config = if withdrawn_principal > 0 {
            updated_config
        } else {
            config
        };

        let public_principal = withdrawn_principal.reveal();
        let public_entry_count = final_stake.entry_count.reveal();

        (
            config_ctxt.owner.from_arcis(final_config),
            stake_ctxt.owner.from_arcis(final_stake),
            public_principal,
            public_entry_count,
        )
    }

    #[instruction]
    pub fn register_paypal_recipient_subly(
        subscriptions_ctxt: Enc<Mxe, UserSubscriptionsSecrets>,
        recipient_type: u8,
        receiver_hash_low: u128,
        receiver_hash_high: u128,
    ) -> (Enc<Mxe, UserSubscriptionsSecrets>, u8, u128, u128) {
        let mut secrets = subscriptions_ctxt.to_arcis();
        secrets.paypal_configured = true;
        secrets.paypal_recipient_type = recipient_type;
        secrets.paypal_receiver_hash_low = receiver_hash_low;
        secrets.paypal_receiver_hash_high = receiver_hash_high;
        let updated = subscriptions_ctxt.owner.from_arcis(secrets);
        (
            updated,
            recipient_type,
            receiver_hash_low,
            receiver_hash_high,
        )
    }

    #[instruction]
    #[allow(clippy::too_many_arguments)]
    pub fn subscribe_service_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, UserStakeSecrets>,
        subscriptions_ctxt: Enc<Mxe, UserSubscriptionsSecrets>,
        service_ctxt: Enc<Mxe, ServiceSecrets>,
        expected_service_id: u64,
        now_ts: u64,
        billing_period_seconds: u64,
    ) -> (
        Enc<Mxe, ConfigSecrets>,
        Enc<Mxe, UserStakeSecrets>,
        Enc<Mxe, UserSubscriptionsSecrets>,
        u8,
        u64,
        u64,
        u8,
        u128,
        u128,
    ) {
        let config = config_ctxt.to_arcis();
        let stake = stake_ctxt.to_arcis();
        let mut subscriptions = subscriptions_ctxt.to_arcis();
        let service = service_ctxt.to_arcis();

        let (converted_now, now_ok) = to_i64_checked(now_ts);
        let mut now_i64 = converted_now;
        let (converted_period, period_ok) = to_i64_checked(billing_period_seconds);
        let mut billing_period = converted_period;

        let mut success = now_ok;
        if !period_ok || billing_period <= 0 {
            success = false;
            billing_period = 0;
        }

        if success {
            if !subscriptions.refresh(now_i64) {
                success = false;
            }
        } else {
            let _ = subscriptions.refresh(now_i64);
        }
        let refreshed_state = subscriptions;

        if success {
            if service.id != expected_service_id {
                success = false;
            }
            if service.monthly_price_usdc == 0 {
                success = false;
            }
            if !subscriptions.paypal_configured {
                success = false;
            }
            if subscriptions.has_active_or_pending(service.id) {
                success = false;
            }
        }

        let mut committed = 0u64;
        let mut required_commitment = 0u64;
        if success {
            committed = subscriptions.total_active_commitment;
            let pending = subscriptions.total_pending_commitment;
            if committed > u64::MAX - pending {
                success = false;
            } else {
                committed = committed + pending;
                if committed > u64::MAX - service.monthly_price_usdc {
                    success = false;
                } else {
                    required_commitment = committed + service.monthly_price_usdc;
                }
            }
        }

        if success {
            let monthly_budget = compute_monthly_budget(stake.total_principal, config.apy_bps);
            if monthly_budget == 0 || required_commitment > monthly_budget {
                success = false;
            }
        }

        let mut final_subscriptions = subscriptions;
        let mut subscription_id_out = 0u64;
        let mut service_id_out = 0u64;

        if success {
            let slot_index = final_subscriptions.allocate_slot_index();
            if slot_index == MAX_USER_SUBSCRIPTIONS {
                success = false;
            } else {
                let next_id = final_subscriptions.next_subscription_id;
                let mut incremented_id = next_id;
                let mut next_billing_ts = now_i64;
                let mut new_active = final_subscriptions.total_active_commitment;

                if next_id == u64::MAX {
                    success = false;
                } else if billing_period > 0 && now_i64 > i64::MAX - billing_period {
                    success = false;
                } else if new_active > u64::MAX - service.monthly_price_usdc {
                    success = false;
                } else {
                    incremented_id = next_id + 1;
                    next_billing_ts = now_i64 + billing_period;
                    new_active = new_active + service.monthly_price_usdc;
                }

                if !success || next_billing_ts < 0 {
                    success = false;
                } else {
                    let slot_ref = &mut final_subscriptions.subscriptions[slot_index];
                    slot_ref.id = next_id;
                    slot_ref.service_id = service.id;
                    slot_ref.monthly_price_usdc = service.monthly_price_usdc;
                    slot_ref.started_at = now_i64;
                    slot_ref.last_payment_ts = now_i64;
                    slot_ref.next_billing_ts = next_billing_ts;
                    slot_ref.pending_until_ts = 0;
                    slot_ref.status = SUB_STATUS_ACTIVE;
                    slot_ref.initial_payment_recorded = false;

                    final_subscriptions.next_subscription_id = incremented_id;
                    final_subscriptions.total_active_commitment = new_active;

                    subscription_id_out = next_id;
                    service_id_out = service.id;
                }
            }
        }

        if !success {
            final_subscriptions = refreshed_state;
            subscription_id_out = 0;
            service_id_out = 0;
        }

        let success_flag: u8 = if success { 1 } else { 0 };
        let recipient_type_out = final_subscriptions.paypal_recipient_type;
        let receiver_hash_low_out = final_subscriptions.paypal_receiver_hash_low;
        let receiver_hash_high_out = final_subscriptions.paypal_receiver_hash_high;

        let public_success_flag = success_flag.reveal();
        let public_subscription_id = subscription_id_out.reveal();
        let public_service_id = service_id_out.reveal();
        let public_recipient_type = recipient_type_out.reveal();
        let public_receiver_hash_low = receiver_hash_low_out.reveal();
        let public_receiver_hash_high = receiver_hash_high_out.reveal();

        (
            config_ctxt.owner.from_arcis(config),
            stake_ctxt.owner.from_arcis(stake),
            subscriptions_ctxt.owner.from_arcis(final_subscriptions),
            public_success_flag,
            public_subscription_id,
            public_service_id,
            public_recipient_type,
            public_receiver_hash_low,
            public_receiver_hash_high,
        )
    }

    #[instruction]
    pub fn unsubscribe_service_subly(
        subscriptions_ctxt: Enc<Mxe, UserSubscriptionsSecrets>,
        subscription_id: u64,
        now_ts: u64,
        billing_period_seconds: u64,
    ) -> (Enc<Mxe, UserSubscriptionsSecrets>, u8, u64, u64, u64, u64) {
        let mut subscriptions = subscriptions_ctxt.to_arcis();
        let (converted_now, now_ok) = to_i64_checked(now_ts);
        let mut now_i64 = converted_now;
        let (converted_period, period_ok) = to_i64_checked(billing_period_seconds);
        let mut billing_period = converted_period;

        let mut success = now_ok;
        if !period_ok || billing_period <= 0 {
            success = false;
            billing_period = 0;
        }

        if success {
            if !subscriptions.refresh(now_i64) {
                success = false;
            }
        } else {
            let _ = subscriptions.refresh(now_i64);
        }
        let refreshed_state = subscriptions;

        let mut service_id_out = 0u64;
        let mut monthly_price_out = 0u64;
        let mut pending_until_out = 0u64;

        if success {
            let subscription_index = subscriptions.find_subscription_index(subscription_id);
            if subscription_index == MAX_USER_SUBSCRIPTIONS {
                success = false;
            } else {
                let snapshot = subscriptions.subscriptions[subscription_index];
                if snapshot.status != SUB_STATUS_ACTIVE {
                    success = false;
                } else {
                    service_id_out = snapshot.service_id;
                    monthly_price_out = snapshot.monthly_price_usdc;

                    let mut new_active = subscriptions.total_active_commitment;
                    let mut new_pending = subscriptions.total_pending_commitment;
                    if new_active < snapshot.monthly_price_usdc {
                        success = false;
                    } else if new_pending > u64::MAX - snapshot.monthly_price_usdc {
                        success = false;
                    } else {
                        new_active = new_active - snapshot.monthly_price_usdc;
                        new_pending = new_pending + snapshot.monthly_price_usdc;
                    }

                    let mut pending_until_ts = snapshot.next_billing_ts;
                    if pending_until_ts <= now_i64 {
                        if billing_period > 0 && now_i64 > i64::MAX - billing_period {
                            success = false;
                        } else {
                            pending_until_ts = now_i64 + billing_period;
                        }
                    }

                    if success {
                        if pending_until_ts < 0 {
                            success = false;
                        } else {
                            let slot_ref = &mut subscriptions.subscriptions[subscription_index];
                            slot_ref.status = SUB_STATUS_PENDING;
                            slot_ref.pending_until_ts = pending_until_ts;

                            subscriptions.total_active_commitment = new_active;
                            subscriptions.total_pending_commitment = new_pending;
                            pending_until_out = pending_until_ts as u64;
                        }
                    }
                }
            }
        }

        if !success {
            subscriptions = refreshed_state;
            service_id_out = 0;
            monthly_price_out = 0;
            pending_until_out = 0;
        }

        let success_flag: u8 = if success { 1 } else { 0 };
        let public_success = success_flag.reveal();
        let public_service_id = service_id_out.reveal();
        let public_monthly_price = monthly_price_out.reveal();
        let public_pending_until = pending_until_out.reveal();

        (
            subscriptions_ctxt.owner.from_arcis(subscriptions),
            public_success,
            subscription_id,
            public_service_id,
            public_monthly_price,
            public_pending_until,
        )
    }

    #[instruction]
    #[allow(clippy::too_many_arguments)]
    pub fn register_subscription_service_subly(
        registry_ctxt: Enc<Mxe, RegistrySecrets>,
        service_ctxt: Enc<Mxe, ServiceSecrets>,
        creator_low: u128,
        creator_high: u128,
        name_hash_low: u128,
        name_hash_high: u128,
        details_hash_low: u128,
        details_hash_high: u128,
        logo_hash_low: u128,
        logo_hash_high: u128,
        provider_hash_low: u128,
        provider_hash_high: u128,
        monthly_price: u64,
        created_at: u64,
    ) -> (
        Enc<Mxe, RegistrySecrets>,
        Enc<Mxe, ServiceSecrets>,
        u64,
        u32,
        u64,
        u64,
        u128,
        u128,
        u128,
        u128,
        u128,
        u128,
        u128,
        u128,
    ) {
        let mut registry = registry_ctxt.to_arcis();
        let mut service = service_ctxt.to_arcis();

        let assigned_id = registry.next_service_id;
        let created_at_i64 = created_at as i64;

        let (digest_low, digest_high) = compute_service_digest(
            assigned_id,
            monthly_price,
            creator_low,
            creator_high,
            name_hash_low,
            name_hash_high,
            details_hash_low,
            details_hash_high,
            logo_hash_low,
            logo_hash_high,
            provider_hash_low,
            provider_hash_high,
            created_at_i64,
        );

        let (root_low, root_high) = mix_service_root(
            registry.services_root_low,
            registry.services_root_high,
            digest_low,
            digest_high,
            assigned_id,
        );

        registry.next_service_id = assigned_id + 1;
        registry.service_count = registry.service_count + 1;
        registry.services_root_low = root_low;
        registry.services_root_high = root_high;

        service.id = assigned_id;
        service.monthly_price_usdc = monthly_price;
        service.created_at = created_at_i64;
        service.creator_low = creator_low;
        service.creator_high = creator_high;
        service.name_hash_low = name_hash_low;
        service.name_hash_high = name_hash_high;
        service.details_hash_low = details_hash_low;
        service.details_hash_high = details_hash_high;
        service.logo_hash_low = logo_hash_low;
        service.logo_hash_high = logo_hash_high;
        service.provider_hash_low = provider_hash_low;
        service.provider_hash_high = provider_hash_high;

        let updated_registry = registry_ctxt.owner.from_arcis(registry);
        let updated_service = service_ctxt.owner.from_arcis(service);
        let public_service_id = assigned_id.reveal();
        let public_service_count = registry.service_count.reveal();

        (
            updated_registry,
            updated_service,
            public_service_id,
            public_service_count,
            monthly_price,
            created_at,
            name_hash_low,
            name_hash_high,
            details_hash_low,
            details_hash_high,
            logo_hash_low,
            logo_hash_high,
            provider_hash_low,
            provider_hash_high,
        )
    }

    #[instruction]
    pub fn sync_yield_subly(
        config_ctxt: Enc<Mxe, ConfigSecrets>,
        stake_ctxt: Enc<Mxe, UserStakeSecrets>,
        now_ts: u64,
    ) -> (
        Enc<Mxe, ConfigSecrets>,
        Enc<Mxe, UserStakeSecrets>,
        u64,
        u64,
        u64,
        u64,
        u64,
        u32,
        u64,
    ) {
        let mut config = config_ctxt.to_arcis();
        let mut stake = stake_ctxt.to_arcis();

        let now = now_ts as i64;
        accrue_config(&mut config, now);
        sync_entries(&mut stake, config.acc_index, now);

        let active_count = stake.entry_count as usize;
        let mut total_unrealized: u64 = 0;
        let mut total_generated: u64 = 0;
        let mut operator_claimed: u64 = 0;
        let mut user_claimed: u64 = 0;

        for idx in 0..MAX_STAKE_ENTRIES {
            let within_active = idx < active_count;
            if within_active {
                let entry = stake.entries[idx];
                total_unrealized = total_unrealized + entry.unrealized_yield;
                operator_claimed = operator_claimed + entry.claimed_operator;
                user_claimed = user_claimed + entry.claimed_user;
                let entry_generated =
                    entry.unrealized_yield + entry.claimed_operator + entry.claimed_user;
                total_generated = total_generated + entry_generated;
            }
        }

        let final_config = config_ctxt.owner.from_arcis(config);
        let final_stake = stake_ctxt.owner.from_arcis(stake);
        let public_total_principal = stake.total_principal.reveal();
        let public_total_unrealized = total_unrealized.reveal();
        let public_total_generated = total_generated.reveal();
        let public_operator_claimed = operator_claimed.reveal();
        let public_user_claimed = user_claimed.reveal();
        let tranche_count_u32 = stake.entry_count as u32;
        let public_tranche_count = tranche_count_u32.reveal();
        let last_updated_u64 = if stake.last_updated_ts >= 0 {
            stake.last_updated_ts as u64
        } else {
            0
        };
        let public_last_updated = last_updated_u64.reveal();

        (
            final_config,
            final_stake,
            public_total_principal,
            public_total_unrealized,
            public_total_generated,
            public_operator_claimed,
            public_user_claimed,
            public_tranche_count,
            public_last_updated,
        )
    }

    fn to_i64_checked(value: u64) -> (i64, bool) {
        if value <= i64::MAX as u64 {
            (value as i64, true)
        } else {
            (0, false)
        }
    }

    fn compute_monthly_budget(total_principal: u64, apy_bps: u16) -> u64 {
        if total_principal == 0 || apy_bps == 0 {
            0
        } else {
            let annual =
                (total_principal as u128) * (apy_bps as u128) / (BASIS_POINTS_DIVISOR as u128);
            let monthly = annual / 12;
            monthly as u64
        }
    }

    fn populate_entry(
        entry: &mut StakeEntrySecrets,
        tranche_id: u64,
        amount: u64,
        now: i64,
        lock_duration: i64,
        acc_index: u128,
    ) {
        entry.tranche_id = tranche_id;
        entry.principal = amount;
        entry.deposited_at = now;
        entry.lock_duration = lock_duration;
        entry.lock_end_ts = now + lock_duration;
        entry.start_acc_index = acc_index;
        entry.last_acc_index = acc_index;
        entry.claimed_operator = 0;
        entry.claimed_user = 0;
        entry.unrealized_yield = 0;
    }

    fn accrue_config(config: &mut ConfigSecrets, now: i64) {
        if now > config.last_update_ts {
            let elapsed = now - config.last_update_ts;
            if elapsed > 0 && config.total_principal > 0 {
                let elapsed_u64 = elapsed as u64;
                if elapsed_u64 > 0 {
                    let numerator = (config.apy_bps as u128) * (elapsed_u64 as u128) * INDEX_SCALE;
                    let denominator = (BASIS_POINTS_DIVISOR as u128) * (SECONDS_PER_YEAR as u128);
                    if denominator > 0 {
                        let delta_index = numerator / denominator;
                        config.acc_index = config.acc_index + delta_index;
                    }
                }
            }
            config.last_update_ts = now;
        }
    }

    fn sync_entries(stake_data: &mut UserStakeSecrets, acc_index: u128, now: i64) {
        for idx in 0..MAX_STAKE_ENTRIES {
            let entry = &mut stake_data.entries[idx];
            let mut should_update = true;
            if entry.principal == 0 {
                should_update = false;
            }
            if acc_index <= entry.last_acc_index {
                should_update = false;
            }
            if should_update {
                let delta_index = acc_index - entry.last_acc_index;
                let accrual = (entry.principal as u128) * delta_index / INDEX_SCALE;
                let accrual_u64 = accrual as u64;
                entry.unrealized_yield = entry.unrealized_yield + accrual_u64;
                entry.last_acc_index = acc_index;
            }
        }
        stake_data.last_updated_ts = now;
    }

    fn compute_service_digest(
        id: u64,
        monthly_price: u64,
        creator_low: u128,
        creator_high: u128,
        name_hash_low: u128,
        name_hash_high: u128,
        details_hash_low: u128,
        details_hash_high: u128,
        logo_hash_low: u128,
        logo_hash_high: u128,
        provider_hash_low: u128,
        provider_hash_high: u128,
        created_at: i64,
    ) -> (u128, u128) {
        let created_at_u128 = if created_at >= 0 {
            created_at as u128
        } else {
            0
        };
        let mut digest_low =
            creator_low + name_hash_low + details_hash_low + logo_hash_low + provider_hash_low;
        digest_low = digest_low + (id as u128) + (monthly_price as u128) + created_at_u128;

        let mut digest_high =
            creator_high + name_hash_high + details_hash_high + logo_hash_high + provider_hash_high;
        digest_high = digest_high
            + ((id >> 32) as u128)
            + ((monthly_price >> 32) as u128)
            + (created_at_u128 >> 1);

        (digest_low, digest_high)
    }

    fn mix_service_root(
        current_low: u128,
        current_high: u128,
        digest_low: u128,
        digest_high: u128,
        index: u64,
    ) -> (u128, u128) {
        let digest_with_index = digest_low + (index as u128);
        let new_low = current_low + digest_with_index;
        let carry = if new_low < current_low { 1u128 } else { 0u128 };
        let new_high = current_high + digest_high + carry;
        (new_low, new_high)
    }
}
