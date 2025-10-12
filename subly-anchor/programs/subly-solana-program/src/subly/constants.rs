use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &str = "config";

#[constant]
pub const USER_POSITION_SEED: &str = "user_position";

#[constant]
pub const VAULT_SEED: &str = "vault";

#[constant]
pub const SUBSCRIPTION_REGISTRY_SEED: &str = "subscription_registry";

#[constant]
pub const USER_SUBSCRIPTIONS_SEED: &str = "user_subscriptions";

#[constant]
pub const INDEX_SCALE: u128 = 1_000_000_000_000u128;

#[constant]
pub const BASIS_POINTS_DIVISOR: u64 = 10_000;

#[constant]
pub const SECONDS_PER_YEAR: u64 = 31_536_000;

#[constant]
pub const DEFAULT_APY_BPS: u16 = 1_000;

#[constant]
pub const SECONDS_PER_DAY: i64 = 86_400;

#[constant]
pub const LOCK_OPTIONS: [i64; 4] = [
    30 * SECONDS_PER_DAY,
    90 * SECONDS_PER_DAY,
    180 * SECONDS_PER_DAY,
    365 * SECONDS_PER_DAY,
];

#[constant]
pub const DEFAULT_LOCK_INDEX: u8 = 3;

pub fn lock_duration_for_index(index: u8) -> Option<i64> {
    LOCK_OPTIONS.get(index as usize).copied()
}

pub const MAX_SERVICE_NAME_LEN: usize = 64;

pub const MAX_SERVICE_DETAILS_LEN: usize = 512;

pub const MAX_SERVICE_LOGO_URL_LEN: usize = 256;

pub const MAX_SERVICE_PROVIDER_LEN: usize = 128;

#[constant]
pub const BILLING_PERIOD_SECONDS: i64 = 30 * SECONDS_PER_DAY;

pub const MAX_PAYPAL_RECEIVER_LEN: usize = 256;
