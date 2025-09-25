use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::subly::constants::{CONFIG_SEED, DEFAULT_APY_BPS, INDEX_SCALE, VAULT_SEED};
use crate::subly::state::SublyConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub authority: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        space = SublyConfig::LEN,
        seeds = [CONFIG_SEED.as_bytes()],
        bump
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(
        init,
        payer = payer,
        seeds = [VAULT_SEED.as_bytes()],
        bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let clock = Clock::get()?;
    let config = &mut ctx.accounts.config;

    config.authority = args.authority;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.vault = ctx.accounts.vault.key();
    config.total_principal = 0;
    config.reward_pool = 0;
    config.acc_index = INDEX_SCALE;
    config.apy_bps = DEFAULT_APY_BPS;
    config.last_update_ts = clock.unix_timestamp;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.vault_bump = ctx.bumps.vault;

    Ok(())
}
