pub const CONFIG_SEED: &str = "config";

pub const USER_POSITION_SEED: &str = "user_position";

pub const VAULT_SEED: &str = "vault";

pub const SUBSCRIPTION_REGISTRY_SEED: &str = "subscription_registry";

pub const USER_SUBSCRIPTIONS_SEED: &str = "user_subscriptions";

pub const INDEX_SCALE: u128 = 1_000_000_000_000u128;

pub const BASIS_POINTS_DIVISOR: u64 = 10_000;

pub const SECONDS_PER_YEAR: u64 = 31_536_000;

pub const DEFAULT_APY_BPS: u16 = 1_000;

pub const SECONDS_PER_DAY: i64 = 86_400;

pub const MAX_STAKE_ENTRIES: usize = 16;

pub const LOCK_OPTIONS: [i64; 4] = [
    30 * SECONDS_PER_DAY,
    90 * SECONDS_PER_DAY,
    180 * SECONDS_PER_DAY,
    365 * SECONDS_PER_DAY,
];

pub const DEFAULT_LOCK_INDEX: u8 = 3;

pub fn lock_duration_for_index(index: u8) -> Option<i64> {
    LOCK_OPTIONS.get(index as usize).copied()
}

pub const MAX_SERVICE_NAME_LEN: usize = 64;

pub const MAX_SERVICE_DETAILS_LEN: usize = 512;

pub const MAX_SERVICE_LOGO_URL_LEN: usize = 256;

pub const MAX_SERVICE_PROVIDER_LEN: usize = 128;

pub const BILLING_PERIOD_SECONDS: i64 = 30 * SECONDS_PER_DAY;

pub const MAX_PAYPAL_RECEIVER_LEN: usize = 256;
