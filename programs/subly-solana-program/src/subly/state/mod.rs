use anchor_lang::prelude::*;

use crate::subly::constants::{
    BASIS_POINTS_DIVISOR, INDEX_SCALE, MAX_SERVICE_DETAILS_LEN, MAX_SERVICE_LOGO_URL_LEN,
    MAX_SERVICE_NAME_LEN, MAX_SERVICE_PROVIDER_LEN, SECONDS_PER_YEAR,
};
use crate::subly::error::ErrorCode;

#[account]
pub struct SublyConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub total_principal: u64,
    pub reward_pool: u64,
    pub acc_index: u128,
    pub apy_bps: u16,
    pub last_update_ts: i64,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

impl SublyConfig {
    pub const LEN: usize = 8 // discriminator
        + 32 // authority
        + 32 // usdc_mint
        + 32 // vault
        + 8  // total_principal
        + 8  // reward_pool
        + 16 // acc_index
        + 2  // apy_bps
        + 8  // last_update_ts
        + 1  // paused
        + 1  // bump
        + 1; // vault_bump

    pub fn ensure_active(&self) -> Result<()> {
        require!(!self.paused, ErrorCode::ProgramPaused);
        Ok(())
    }

    pub fn accrue_to(&mut self, now: i64) -> Result<()> {
        if now <= self.last_update_ts {
            return Ok(());
        }

        let elapsed: u64 = now
            .checked_sub(self.last_update_ts)
            .ok_or(ErrorCode::MathOverflow)?
            .try_into()
            .map_err(|_| ErrorCode::MathOverflow)?;

        if elapsed == 0 || self.total_principal == 0 {
            self.last_update_ts = now;
            return Ok(());
        }

        let numerator = (self.apy_bps as u128)
            .checked_mul(elapsed as u128)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_mul(INDEX_SCALE)
            .ok_or(ErrorCode::MathOverflow)?;
        let denominator = (BASIS_POINTS_DIVISOR as u128)
            .checked_mul(SECONDS_PER_YEAR as u128)
            .ok_or(ErrorCode::MathOverflow)?;
        let delta_index = numerator
            .checked_div(denominator)
            .ok_or(ErrorCode::MathOverflow)?;

        self.acc_index = self
            .acc_index
            .checked_add(delta_index)
            .ok_or(ErrorCode::MathOverflow)?;
        self.last_update_ts = now;
        Ok(())
    }

    pub fn ensure_reward_pool(&self, amount: u64) -> Result<()> {
        require!(
            self.reward_pool >= amount,
            ErrorCode::InsufficientRewardPool
        );
        Ok(())
    }

    pub fn increase_reward_pool(&mut self, amount: u64) -> Result<()> {
        self.reward_pool = self
            .reward_pool
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(())
    }

    pub fn decrease_reward_pool(&mut self, amount: u64) -> Result<()> {
        self.ensure_reward_pool(amount)?;
        self.reward_pool -= amount;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct StakeEntry {
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

impl StakeEntry {
    pub const SIZE: usize = 8  // tranche_id
        + 8  // principal
        + 8  // deposited_at
        + 8  // lock_end_ts
        + 8  // lock_duration
        + 16 // start_acc_index
        + 16 // last_acc_index
        + 8  // claimed_operator
        + 8  // claimed_user
        + 8; // unrealized_yield

    pub fn new(
        tranche_id: u64,
        principal: u64,
        deposited_at: i64,
        lock_duration: i64,
        start_acc_index: u128,
    ) -> Result<Self> {
        let lock_end_ts = deposited_at
            .checked_add(lock_duration)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(Self {
            tranche_id,
            principal,
            deposited_at,
            lock_end_ts,
            lock_duration,
            start_acc_index,
            last_acc_index: start_acc_index,
            claimed_operator: 0,
            claimed_user: 0,
            unrealized_yield: 0,
        })
    }

    pub fn sync_to_index(&mut self, acc_index: u128) -> Result<u64> {
        if acc_index <= self.last_acc_index || self.principal == 0 {
            return Ok(0);
        }

        let delta_index = acc_index
            .checked_sub(self.last_acc_index)
            .ok_or(ErrorCode::MathOverflow)?;
        let accrual = (self.principal as u128)
            .checked_mul(delta_index)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(INDEX_SCALE)
            .ok_or(ErrorCode::MathOverflow)?;
        let accrual_u64: u64 = accrual.try_into().map_err(|_| ErrorCode::MathOverflow)?;

        self.unrealized_yield = self
            .unrealized_yield
            .checked_add(accrual_u64)
            .ok_or(ErrorCode::MathOverflow)?;
        self.last_acc_index = acc_index;

        Ok(accrual_u64)
    }

    pub fn available_for_operator(&self) -> u64 {
        self.unrealized_yield
    }

    pub fn available_for_user(&self, now: i64) -> u64 {
        if now >= self.lock_end_ts {
            self.unrealized_yield
        } else {
            0
        }
    }

    pub fn claim_operator(&mut self, mut amount: u64) -> Result<u64> {
        if amount == 0 {
            amount = self.unrealized_yield;
        }
        let take = amount.min(self.unrealized_yield);
        if take == 0 {
            return Ok(0);
        }
        self.unrealized_yield -= take;
        self.claimed_operator = self
            .claimed_operator
            .checked_add(take)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(take)
    }

    pub fn claim_user(&mut self, now: i64, mut amount: u64) -> Result<u64> {
        require!(now >= self.lock_end_ts, ErrorCode::StakeLocked);
        if amount == 0 {
            amount = self.unrealized_yield;
        }
        let take = amount.min(self.unrealized_yield);
        if take == 0 {
            return Ok(0);
        }
        self.unrealized_yield -= take;
        self.claimed_user = self
            .claimed_user
            .checked_add(take)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(take)
    }

    pub fn ensure_no_unclaimed_yield(&self) -> Result<()> {
        require!(self.unrealized_yield == 0, ErrorCode::OutstandingYield);
        Ok(())
    }

    pub fn withdraw_principal(&mut self, now: i64) -> Result<u64> {
        require!(now >= self.lock_end_ts, ErrorCode::StakeLocked);
        require!(self.principal > 0, ErrorCode::NothingToUnstake);
        self.ensure_no_unclaimed_yield()?;
        let principal = self.principal;
        self.principal = 0;
        Ok(principal)
    }

    pub fn total_yield_generated(&self) -> Result<u64> {
        self.claimed_operator
            .checked_add(self.claimed_user)
            .and_then(|v| v.checked_add(self.unrealized_yield))
            .ok_or_else(|| ErrorCode::MathOverflow.into())
    }
}

#[account]
pub struct UserStake {
    pub owner: Pubkey,
    pub total_principal: u64,
    pub last_updated_ts: i64,
    pub next_tranche_id: u64,
    pub entries: Vec<StakeEntry>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscriptionService {
    pub id: u64,
    pub creator: Pubkey,
    pub name: String,
    pub monthly_price_usdc: u64,
    pub details: String,
    pub logo_url: String,
    pub provider: String,
    pub created_at: i64,
}

impl SubscriptionService {
    pub const FIXED_SIZE: usize = 8  // id
        + 32 // creator
        + 8  // monthly_price_usdc
        + 8; // created_at

    pub fn space_from_lengths(
        name_len: usize,
        details_len: usize,
        logo_url_len: usize,
        provider_len: usize,
    ) -> usize {
        Self::FIXED_SIZE + 4 + name_len + 4 + details_len + 4 + logo_url_len + 4 + provider_len
    }

    pub fn space(&self) -> usize {
        Self::space_from_lengths(
            self.name.len(),
            self.details.len(),
            self.logo_url.len(),
            self.provider.len(),
        )
    }
}

#[account]
pub struct SubscriptionRegistry {
    pub next_service_id: u64,
    pub services: Vec<SubscriptionService>,
    pub bump: u8,
}

impl SubscriptionRegistry {
    pub const BASE_SIZE: usize = 8 // discriminator
        + 8 // next_service_id
        + 4 // services length prefix
        + 1; // bump

    pub const INITIAL_SIZE: usize = Self::BASE_SIZE;

    pub fn current_size(&self) -> usize {
        Self::BASE_SIZE
            + self
                .services
                .iter()
                .map(SubscriptionService::space)
                .sum::<usize>()
    }

    pub fn required_size_for_addition(
        &self,
        name_len: usize,
        details_len: usize,
        logo_len: usize,
        provider_len: usize,
    ) -> usize {
        self.current_size()
            + SubscriptionService::space_from_lengths(name_len, details_len, logo_len, provider_len)
    }

    pub fn append_service(&mut self, service: SubscriptionService) -> Result<()> {
        self.services.push(service);
        self.next_service_id = self
            .next_service_id
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(())
    }

    pub fn validate_lengths(
        name_len: usize,
        details_len: usize,
        logo_len: usize,
        provider_len: usize,
    ) -> Result<()> {
        require!(name_len <= MAX_SERVICE_NAME_LEN, ErrorCode::StringTooLong);
        require!(
            details_len <= MAX_SERVICE_DETAILS_LEN,
            ErrorCode::StringTooLong
        );
        require!(
            logo_len <= MAX_SERVICE_LOGO_URL_LEN,
            ErrorCode::StringTooLong
        );
        require!(
            provider_len <= MAX_SERVICE_PROVIDER_LEN,
            ErrorCode::StringTooLong
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubscriptionStatus {
    Active,
    PendingCancellation,
    Cancelled,
}

impl Default for SubscriptionStatus {
    fn default() -> Self {
        SubscriptionStatus::Active
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UserSubscription {
    pub id: u64,
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub started_at: i64,
    pub last_payment_ts: i64,
    pub next_billing_ts: i64,
    pub pending_until_ts: i64,
    pub status: SubscriptionStatus,
}

impl UserSubscription {
    pub const SIZE: usize = 8  // id
        + 8  // service_id
        + 8  // monthly_price_usdc
        + 8  // started_at
        + 8  // last_payment_ts
        + 8  // next_billing_ts
        + 8  // pending_until_ts
        + 1; // status
}

#[account]
pub struct UserSubscriptions {
    pub owner: Pubkey,
    pub next_subscription_id: u64,
    pub total_active_commitment: u64,
    pub total_pending_commitment: u64,
    pub bump: u8,
    pub subscriptions: Vec<UserSubscription>,
}

impl UserSubscriptions {
    pub const INITIAL_SUBSCRIPTION_CAPACITY: usize = 8;
    pub const BASE_SIZE: usize = 8  // discriminator
        + 32 // owner
        + 8  // next_subscription_id
        + 8  // total_active_commitment
        + 8  // total_pending_commitment
        + 1  // bump
        + 4; // subscriptions length prefix

    pub const INITIAL_SIZE: usize =
        Self::BASE_SIZE + Self::INITIAL_SUBSCRIPTION_CAPACITY * UserSubscription::SIZE;

    pub fn ensure_owner(&mut self, owner: Pubkey, bump: u8) {
        if self.owner == Pubkey::default() {
            self.owner = owner;
            self.bump = bump;
            self.next_subscription_id = 0;
            self.total_active_commitment = 0;
            self.total_pending_commitment = 0;
            self.subscriptions = Vec::with_capacity(Self::INITIAL_SUBSCRIPTION_CAPACITY);
        }
    }

    pub fn required_size(subscription_count: usize) -> usize {
        Self::BASE_SIZE + subscription_count * UserSubscription::SIZE
    }

    pub fn refresh(&mut self, now: i64) -> Result<()> {
        let mut released: u64 = 0;
        for subscription in self.subscriptions.iter_mut() {
            if subscription.status == SubscriptionStatus::PendingCancellation
                && subscription.pending_until_ts > 0
                && now >= subscription.pending_until_ts
            {
                subscription.status = SubscriptionStatus::Cancelled;
                subscription.pending_until_ts = 0;
                released = released
                    .checked_add(subscription.monthly_price_usdc)
                    .ok_or(ErrorCode::MathOverflow)?;
            }
        }

        if released > 0 {
            self.total_pending_commitment = self
                .total_pending_commitment
                .checked_sub(released)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        Ok(())
    }

    pub fn total_committed(&self) -> Result<u64> {
        self.total_active_commitment
            .checked_add(self.total_pending_commitment)
            .ok_or(ErrorCode::MathOverflow.into())
    }

    pub fn has_active_or_pending_for_service(&self, service_id: u64) -> bool {
        self.subscriptions.iter().any(|subscription| {
            subscription.service_id == service_id
                && (subscription.status == SubscriptionStatus::Active
                    || subscription.status == SubscriptionStatus::PendingCancellation)
        })
    }

    pub fn record_subscription(
        &mut self,
        service_id: u64,
        monthly_price: u64,
        now: i64,
        billing_period: i64,
    ) -> Result<u64> {
        let next_billing_ts = now
            .checked_add(billing_period)
            .ok_or(ErrorCode::MathOverflow)?;

        let subscription = UserSubscription {
            id: self.next_subscription_id,
            service_id,
            monthly_price_usdc: monthly_price,
            started_at: now,
            last_payment_ts: now,
            next_billing_ts,
            pending_until_ts: 0,
            status: SubscriptionStatus::Active,
        };

        self.subscriptions.push(subscription);

        self.total_active_commitment = self
            .total_active_commitment
            .checked_add(monthly_price)
            .ok_or(ErrorCode::MathOverflow)?;

        let new_id = self.next_subscription_id;
        self.next_subscription_id = self
            .next_subscription_id
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(new_id)
    }

    pub fn begin_cancellation(
        &mut self,
        subscription_id: u64,
        now: i64,
        billing_period: i64,
    ) -> Result<(u64, u64, i64)> {
        let subscription = self
            .subscriptions
            .iter_mut()
            .find(|subscription| subscription.id == subscription_id)
            .ok_or(ErrorCode::SubscriptionNotFound)?;

        require!(
            subscription.status == SubscriptionStatus::Active,
            ErrorCode::SubscriptionNotActive
        );

        self.total_active_commitment = self
            .total_active_commitment
            .checked_sub(subscription.monthly_price_usdc)
            .ok_or(ErrorCode::MathOverflow)?;

        let pending_until = if subscription.next_billing_ts > now {
            subscription.next_billing_ts
        } else {
            now.checked_add(billing_period)
                .ok_or(ErrorCode::MathOverflow)?
        };

        subscription.status = SubscriptionStatus::PendingCancellation;
        subscription.pending_until_ts = pending_until;

        self.total_pending_commitment = self
            .total_pending_commitment
            .checked_add(subscription.monthly_price_usdc)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok((
            subscription.service_id,
            subscription.monthly_price_usdc,
            pending_until,
        ))
    }
}

impl UserStake {
    pub const INITIAL_ENTRY_CAPACITY: usize = 4;
    pub const BASE_SIZE: usize = 8  // discriminator
        + 32  // owner
        + 8   // total_principal
        + 8   // last_updated_ts
        + 8   // next_tranche_id
        + 4   // entries length prefix
        + 1; // bump

    pub const INITIAL_SIZE: usize =
        Self::BASE_SIZE + Self::INITIAL_ENTRY_CAPACITY * StakeEntry::SIZE;

    pub fn required_size(entry_count: usize) -> usize {
        Self::BASE_SIZE + entry_count * StakeEntry::SIZE
    }

    pub fn is_initialized(&self) -> bool {
        self.owner != Pubkey::default()
    }

    pub fn ensure_owner(&mut self, owner: Pubkey, bump: u8) {
        if !self.is_initialized() {
            self.owner = owner;
            self.bump = bump;
            self.total_principal = 0;
            self.last_updated_ts = 0;
            self.next_tranche_id = 0;
            self.entries = Vec::with_capacity(Self::INITIAL_ENTRY_CAPACITY);
        }
    }

    pub fn ensure_capacity(
        &mut self,
        account_info: &AccountInfo,
        desired_len: usize,
    ) -> Result<()> {
        let required_space = Self::required_size(desired_len);
        if account_info.data_len() < required_space {
            account_info.resize(required_space)?;
        }
        Ok(())
    }

    pub fn sync_against_index(&mut self, acc_index: u128, now: i64) -> Result<u64> {
        let mut accrued: u64 = 0;
        for entry in self.entries.iter_mut() {
            accrued = accrued
                .checked_add(entry.sync_to_index(acc_index)?)
                .ok_or(ErrorCode::MathOverflow)?;
        }
        self.last_updated_ts = now;
        Ok(accrued)
    }

    pub fn record_stake(
        &mut self,
        account_info: &AccountInfo,
        amount: u64,
        now: i64,
        lock_duration: i64,
        start_index: u128,
    ) -> Result<u64> {
        let tranche_id = self.next_tranche_id;
        self.ensure_capacity(account_info, self.entries.len() + 1)?;

        let entry = StakeEntry::new(tranche_id, amount, now, lock_duration, start_index)?;
        self.entries.push(entry);

        self.total_principal = self
            .total_principal
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        self.last_updated_ts = now;
        self.next_tranche_id = self
            .next_tranche_id
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        Ok(tranche_id)
    }

    pub fn total_unrealized_yield(&self) -> Result<u64> {
        self.entries.iter().try_fold(0u64, |acc, entry| {
            acc.checked_add(entry.unrealized_yield)
                .ok_or_else(|| ErrorCode::MathOverflow.into())
        })
    }

    pub fn total_yield_generated(&self) -> Result<u64> {
        self.entries.iter().try_fold(0u64, |acc, entry| {
            let entry_total = entry.total_yield_generated()?;
            acc.checked_add(entry_total)
                .ok_or_else(|| ErrorCode::MathOverflow.into())
        })
    }

    pub fn available_yield_for_operator(&self) -> Result<u64> {
        self.entries.iter().try_fold(0u64, |acc, entry| {
            acc.checked_add(entry.available_for_operator())
                .ok_or_else(|| ErrorCode::MathOverflow.into())
        })
    }

    pub fn available_yield_for_user(&self, now: i64) -> Result<u64> {
        self.entries.iter().try_fold(0u64, |acc, entry| {
            acc.checked_add(entry.available_for_user(now))
                .ok_or_else(|| ErrorCode::MathOverflow.into())
        })
    }

    pub fn claim_for_operator(&mut self, mut amount: u64) -> Result<u64> {
        if amount == 0 {
            amount = self.available_yield_for_operator()?;
        }
        let mut remaining = amount;
        let mut claimed = 0u64;
        for entry in self.entries.iter_mut() {
            if remaining == 0 {
                break;
            }
            let taken = entry.claim_operator(remaining)?;
            remaining = remaining
                .checked_sub(taken)
                .ok_or(ErrorCode::MathOverflow)?;
            claimed = claimed.checked_add(taken).ok_or(ErrorCode::MathOverflow)?;
        }
        Ok(claimed)
    }

    pub fn claim_for_user(&mut self, now: i64, mut amount: u64) -> Result<u64> {
        if amount == 0 {
            amount = self.available_yield_for_user(now)?;
        }
        let mut remaining = amount;
        let mut claimed = 0u64;
        for entry in self.entries.iter_mut() {
            if remaining == 0 {
                break;
            }
            let taken = entry.claim_user(now, remaining)?;
            remaining = remaining
                .checked_sub(taken)
                .ok_or(ErrorCode::MathOverflow)?;
            claimed = claimed.checked_add(taken).ok_or(ErrorCode::MathOverflow)?;
        }
        Ok(claimed)
    }

    pub fn find_entry_mut(&mut self, tranche_id: u64) -> Option<&mut StakeEntry> {
        self.entries
            .iter_mut()
            .find(|entry| entry.tranche_id == tranche_id)
    }

    pub fn unstake_tranche(&mut self, tranche_id: u64, now: i64) -> Result<u64> {
        let entry = self
            .find_entry_mut(tranche_id)
            .ok_or(ErrorCode::InvalidTranche)?;
        let principal = entry.withdraw_principal(now)?;
        self.total_principal = self
            .total_principal
            .checked_sub(principal)
            .ok_or(ErrorCode::MathOverflow)?;
        Ok(principal)
    }
}
