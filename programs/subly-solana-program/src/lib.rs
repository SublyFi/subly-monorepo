pub mod subly;

use anchor_lang::prelude::*;

pub use subly::constants as subly_constants;
pub use subly::instructions::claim_operator::ClaimOperator;
pub use subly::instructions::claim_user::ClaimUser;
pub use subly::instructions::fund_rewards::FundRewards;
pub use subly::instructions::initialize::{Initialize, InitializeArgs};
pub use subly::instructions::stake::Stake;
pub use subly::instructions::sync_yield::{SyncYield, YieldSnapshot};
pub use subly::instructions::unstake::Unstake;
pub use subly::state::{StakeEntry, SublyConfig, UserStake};

pub mod __client_accounts_initialize {
    pub use crate::subly::instructions::initialize::__client_accounts_initialize::*;
}

pub mod __client_accounts_stake {
    pub use crate::subly::instructions::stake::__client_accounts_stake::*;
}

pub mod __client_accounts_claim_operator {
    pub use crate::subly::instructions::claim_operator::__client_accounts_claim_operator::*;
}

pub mod __client_accounts_claim_user {
    pub use crate::subly::instructions::claim_user::__client_accounts_claim_user::*;
}

pub mod __client_accounts_fund_rewards {
    pub use crate::subly::instructions::fund_rewards::__client_accounts_fund_rewards::*;
}

pub mod __client_accounts_unstake {
    pub use crate::subly::instructions::unstake::__client_accounts_unstake::*;
}

pub mod __client_accounts_sync_yield {
    pub use crate::subly::instructions::sync_yield::__client_accounts_sync_yield::*;
}

declare_id!("GJvB3qPb5UmRoWADHWxgwfepEbTbCMwryzWKaBq3Ys22");

#[program]
pub mod subly_solana_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        subly::instructions::initialize::handler(ctx, args)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, lock_option: u8) -> Result<()> {
        subly::instructions::stake::handler(ctx, amount, lock_option)
    }

    pub fn claim_operator(ctx: Context<ClaimOperator>, amount: u64) -> Result<()> {
        subly::instructions::claim_operator::handler(ctx, amount)
    }

    pub fn claim_user(ctx: Context<ClaimUser>, amount: u64) -> Result<()> {
        subly::instructions::claim_user::handler(ctx, amount)
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        subly::instructions::fund_rewards::handler(ctx, amount)
    }

    pub fn unstake(ctx: Context<Unstake>, tranche_id: u64) -> Result<()> {
        subly::instructions::unstake::handler(ctx, tranche_id)
    }

    pub fn sync_yield(ctx: Context<SyncYield>) -> Result<()> {
        subly::instructions::sync_yield::handler(ctx)
    }
}
