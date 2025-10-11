use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED, VAULT_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, UserStake};

#[derive(Accounts)]
pub struct ClaimOperator<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED.as_bytes(), user_position.owner.as_ref()],
        bump = user_position.bump,
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
        constraint = authority_token_account.owner == authority.key() @ ErrorCode::InvalidTokenOwner,
        constraint = authority_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimOperator>, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let config = &mut ctx.accounts.config;
    config.ensure_active()?;
    require_keys_eq!(
        ctx.accounts.authority.key(),
        config.authority,
        ErrorCode::UnauthorizedAuthority
    );

    config.accrue_to(now)?;

    let user_position = &mut ctx.accounts.user_position;
    user_position.sync_against_index(config.acc_index, now)?;

    let available = user_position.available_yield_for_operator()?;
    let desired = if amount == 0 {
        available
    } else {
        amount.min(available)
    };
    require!(desired > 0, ErrorCode::NothingToClaim);

    let claimed = user_position.claim_for_operator(desired)?;
    require!(claimed > 0, ErrorCode::NothingToClaim);

    config.decrease_reward_pool(claimed)?;

    let config_seed = CONFIG_SEED.as_bytes();
    let bump = [config.bump];
    let signer_seeds: &[&[u8]] = &[config_seed, &bump];
    let signer_seeds = &[signer_seeds];

    let transfer_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.authority_token_account.to_account_info(),
        authority: ctx.accounts.config.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
        signer_seeds,
    );
    token::transfer(cpi_ctx, claimed)?;

    Ok(())
}
