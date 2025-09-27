use anchor_lang::prelude::*;

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{StakeEntry, SublyConfig, UserStake};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StakeEntrySnapshot {
    pub tranche_id: u64,
    pub principal: u64,
    pub deposited_at: i64,
    pub lock_end_ts: i64,
    pub lock_duration: i64,
    pub claimed_operator: u64,
    pub claimed_user: u64,
    pub unrealized_yield: u64,
}

impl From<&StakeEntry> for StakeEntrySnapshot {
    fn from(entry: &StakeEntry) -> Self {
        Self {
            tranche_id: entry.tranche_id,
            principal: entry.principal,
            deposited_at: entry.deposited_at,
            lock_end_ts: entry.lock_end_ts,
            lock_duration: entry.lock_duration,
            claimed_operator: entry.claimed_operator,
            claimed_user: entry.claimed_user,
            unrealized_yield: entry.unrealized_yield,
        }
    }
}

#[event]
pub struct UserStakeFetched {
    pub user: Pubkey,
    pub total_principal: u64,
    pub stake_entries: Vec<StakeEntrySnapshot>,
}

#[derive(Accounts)]
pub struct GetUserStake<'info> {
    #[account(seeds = [CONFIG_SEED.as_bytes()], bump = config.bump)]
    pub config: Account<'info, SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump = user_position.bump,
    )]
    pub user_position: Account<'info, UserStake>,
}

pub fn handler(ctx: Context<GetUserStake>) -> Result<()> {
    let user_key = ctx.accounts.user.key();

    let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_config,
        ctx.accounts.config.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    let (expected_user_position, position_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED.as_bytes(), user_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_position,
        ctx.accounts.user_position.key(),
        ErrorCode::InvalidPositionOwner
    );

    ctx.accounts
        .user_position
        .ensure_owner(user_key, position_bump);

    let snapshots: Vec<StakeEntrySnapshot> = ctx
        .accounts
        .user_position
        .entries
        .iter()
        .map(StakeEntrySnapshot::from)
        .collect();

    emit!(UserStakeFetched {
        user: user_key,
        total_principal: ctx.accounts.user_position.total_principal,
        stake_entries: snapshots,
    });

    Ok(())
}
