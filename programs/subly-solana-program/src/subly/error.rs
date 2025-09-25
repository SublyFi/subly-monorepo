use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero")]
    AmountTooSmall,
    #[msg("Invalid lock option supplied")]
    InvalidLockOption,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid token owner for provided account")]
    InvalidTokenOwner,
    #[msg("Invalid token mint for provided account")]
    InvalidMint,
    #[msg("Invalid position owner")]
    InvalidPositionOwner,
    #[msg("Program is paused")]
    ProgramPaused,
    #[msg("Insufficient rewards available in the pool")]
    InsufficientRewardPool,
    #[msg("Stake position is still locked")]
    StakeLocked,
    #[msg("Stake position still has unclaimed yield")]
    OutstandingYield,
    #[msg("Nothing available to unstake")]
    NothingToUnstake,
    #[msg("Requested tranche could not be found")]
    InvalidTranche,
    #[msg("Nothing available to claim")]
    NothingToClaim,
    #[msg("Only the configured authority may perform this action")]
    UnauthorizedAuthority,
    #[msg("Provided string exceeds the allowed length")]
    StringTooLong,
    #[msg("Requested subscription record could not be found")]
    SubscriptionNotFound,
    #[msg("Requested service could not be found")]
    SubscriptionServiceNotFound,
    #[msg("Subscription is not currently active")]
    SubscriptionNotActive,
    #[msg("Subscription already exists for the selected service")]
    SubscriptionAlreadyExists,
    #[msg("Subscription commitments would exceed the available budget")]
    SubscriptionBudgetExceeded,
    #[msg("Invalid subscription account for the provided user")]
    InvalidSubscriptionAccount,
}
