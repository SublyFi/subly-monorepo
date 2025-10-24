use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED, VAULT_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, UserStake};

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.owner == user.key() @ ErrorCode::InvalidPositionOwner,
    )]
    pub user_position: Account<'info, UserStake>,
    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Unstake>, tranche_id: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.ensure_active()?;
    config.accrue_to(now)?;

    let user_position = &mut ctx.accounts.user_position;
    user_position.sync_against_index(config.acc_index, now)?;

    let principal = user_position.unstake_tranche(tranche_id, now)?;
    require!(principal > 0, ErrorCode::NothingToUnstake);

    config.total_principal = config
        .total_principal
        .checked_sub(principal)
        .ok_or(ErrorCode::MathOverflow)?;

    let config_seed = CONFIG_SEED.as_bytes();
    let bump = [config.bump];
    let signer_seeds: &[&[u8]] = &[config_seed, &bump];
    let signer_seeds = &[signer_seeds];

    let transfer_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: ctx.accounts.config.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, principal)?;

    Ok(())
}
