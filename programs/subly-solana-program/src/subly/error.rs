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
}
