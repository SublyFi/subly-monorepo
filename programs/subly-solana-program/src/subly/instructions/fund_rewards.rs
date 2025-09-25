use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::subly::constants::{CONFIG_SEED, VAULT_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::SublyConfig;

#[derive(Accounts)]
pub struct FundRewards<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(
        mut,
        constraint = funder_token_account.owner == funder.key() @ ErrorCode::InvalidTokenOwner,
        constraint = funder_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub funder_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::AmountTooSmall);

    let transfer_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.funder.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_accounts,
    );
    token::transfer(cpi_ctx, amount)?;

    ctx.accounts.config.increase_reward_pool(amount)?;

    Ok(())
}
