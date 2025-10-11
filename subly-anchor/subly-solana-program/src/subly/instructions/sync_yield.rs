use anchor_lang::prelude::*;

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, UserStake};

#[event]
pub struct YieldSnapshot {
    pub owner: Pubkey,
    pub total_principal: u64,
    pub total_unrealized_yield: u64,
    pub total_generated_yield: u64,
    pub operator_claimed: u64,
    pub user_claimed: u64,
    pub tranche_count: u32,
    pub last_updated_ts: i64,
}

#[derive(Accounts)]
pub struct SyncYield<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ ErrorCode::InvalidPositionOwner,
    )]
    pub user_position: Account<'info, UserStake>,
}

pub fn handler(ctx: Context<SyncYield>) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.ensure_active()?;
    config.accrue_to(now)?;

    let user_position = &mut ctx.accounts.user_position;
    user_position.sync_against_index(config.acc_index, now)?;

    let total_unrealized = user_position.total_unrealized_yield()?;
    let total_generated = user_position.total_yield_generated()?;
    let operator_claimed: u64 = user_position
        .entries
        .iter()
        .map(|entry| entry.claimed_operator)
        .try_fold(0u64, |acc, v| {
            acc.checked_add(v).ok_or(ErrorCode::MathOverflow)
        })?;
    let user_claimed: u64 = user_position
        .entries
        .iter()
        .map(|entry| entry.claimed_user)
        .try_fold(0u64, |acc, v| {
            acc.checked_add(v).ok_or(ErrorCode::MathOverflow)
        })?;

    emit!(YieldSnapshot {
        owner: user_position.owner,
        total_principal: user_position.total_principal,
        total_unrealized_yield: total_unrealized,
        total_generated_yield: total_generated,
        operator_claimed,
        user_claimed,
        tranche_count: user_position.entries.len() as u32,
        last_updated_ts: user_position.last_updated_ts,
    });

    Ok(())
}
