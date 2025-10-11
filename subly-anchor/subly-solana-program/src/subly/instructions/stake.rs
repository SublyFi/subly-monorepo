use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::subly::constants::{
    lock_duration_for_index, CONFIG_SEED, USER_POSITION_SEED, VAULT_SEED,
};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, UserStake};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = UserStake::INITIAL_SIZE,
        seeds = [USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump
    )]
    pub user_position: Account<'info, UserStake>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Stake>, amount: u64, lock_option: u8) -> Result<()> {
    require!(amount > 0, ErrorCode::AmountTooSmall);

    let lock_duration = lock_duration_for_index(lock_option).ok_or(ErrorCode::InvalidLockOption)?;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.ensure_active()?;
    config.accrue_to(now)?;

    let user_position_info = ctx.accounts.user_position.to_account_info();
    let user_position = &mut ctx.accounts.user_position;
    let (expected_user_position, bump) = Pubkey::find_program_address(
        &[
            USER_POSITION_SEED.as_bytes(),
            ctx.accounts.user.key().as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_position,
        user_position.key(),
        ErrorCode::InvalidPositionOwner
    );
    user_position.ensure_owner(ctx.accounts.user.key(), bump);
    require_keys_eq!(
        user_position.owner,
        ctx.accounts.user.key(),
        ErrorCode::InvalidPositionOwner
    );
    user_position.sync_against_index(config.acc_index, now)?;

    let transfer_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    token::transfer(cpi_ctx, amount)?;

    config.total_principal = config
        .total_principal
        .checked_add(amount)
        .ok_or(ErrorCode::MathOverflow)?;

    user_position.record_stake(
        &user_position_info,
        amount,
        now,
        lock_duration,
        config.acc_index,
    )?;

    Ok(())
}
