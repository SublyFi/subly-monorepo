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
}
