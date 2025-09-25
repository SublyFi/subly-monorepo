use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};

use crate::subly::constants::SUBSCRIPTION_REGISTRY_SEED;
use crate::subly::state::{SubscriptionRegistry, SubscriptionService};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterSubscriptionServiceArgs {
    pub name: String,
    pub monthly_price_usdc: u64,
    pub details: String,
    pub logo_url: String,
    pub provider: String,
}

#[event]
pub struct SubscriptionServiceRegistered {
    pub id: u64,
    pub creator: Pubkey,
    pub name: String,
    pub monthly_price_usdc: u64,
    pub details: String,
    pub logo_url: String,
    pub provider: String,
}

#[derive(Accounts)]
pub struct RegisterSubscriptionService<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, SubscriptionRegistry>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterSubscriptionService>,
    args: RegisterSubscriptionServiceArgs,
) -> Result<()> {
    let clock = Clock::get()?;

    let RegisterSubscriptionServiceArgs {
        name,
        monthly_price_usdc,
        details,
        logo_url,
        provider,
    } = args;

    let name_len = name.len();
    let details_len = details.len();
    let logo_len = logo_url.len();
    let provider_len = provider.len();

    SubscriptionRegistry::validate_lengths(name_len, details_len, logo_len, provider_len)?;

    let required_space = {
        let registry_ref = &ctx.accounts.subscription_registry;
        registry_ref.required_size_for_addition(name_len, details_len, logo_len, provider_len)
    };

    if ctx
        .accounts
        .subscription_registry
        .to_account_info()
        .data_len()
        < required_space
    {
        let rent = Rent::get()?;
        let registry_info = ctx.accounts.subscription_registry.to_account_info();
        let required_lamports = rent.minimum_balance(required_space);
        let current_lamports = registry_info.lamports();

        if required_lamports > current_lamports {
            let difference = required_lamports - current_lamports;
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.payer.to_account_info(),
                to: registry_info.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            system_program::transfer(CpiContext::new(cpi_program, transfer_accounts), difference)?;
        }

        let registry_info = ctx.accounts.subscription_registry.to_account_info();
        registry_info.resize(required_space)?;
    }

    let creator = ctx.accounts.payer.key();
    let service_id = ctx.accounts.subscription_registry.next_service_id;
    let created_at = clock.unix_timestamp;

    let event = SubscriptionServiceRegistered {
        id: service_id,
        creator,
        name: name.clone(),
        monthly_price_usdc,
        details: details.clone(),
        logo_url: logo_url.clone(),
        provider: provider.clone(),
    };

    let service = SubscriptionService {
        id: service_id,
        creator,
        name,
        monthly_price_usdc,
        details,
        logo_url,
        provider,
        created_at,
    };

    let registry = &mut ctx.accounts.subscription_registry;
    registry.append_service(service)?;

    emit!(event);

    Ok(())
}
