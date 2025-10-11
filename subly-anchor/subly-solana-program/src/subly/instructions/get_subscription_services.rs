use anchor_lang::prelude::*;

use crate::subly::constants::SUBSCRIPTION_REGISTRY_SEED;
use crate::subly::state::SubscriptionRegistry;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscriptionServiceInfo {
    pub id: u64,
    pub creator: Pubkey,
    pub name: String,
    pub monthly_price_usdc: u64,
    pub details: String,
    pub logo_url: String,
    pub provider: String,
    pub created_at: i64,
}

#[event]
pub struct SubscriptionServicesFetched {
    pub services: Vec<SubscriptionServiceInfo>,
}

#[derive(Accounts)]
pub struct GetSubscriptionServices<'info> {
    #[account(
        seeds = [SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, SubscriptionRegistry>,
}

pub fn handler(ctx: Context<GetSubscriptionServices>) -> Result<()> {
    let registry = &ctx.accounts.subscription_registry;
    let services: Vec<SubscriptionServiceInfo> = registry
        .services
        .iter()
        .map(|service| SubscriptionServiceInfo {
            id: service.id,
            creator: service.creator,
            name: service.name.clone(),
            monthly_price_usdc: service.monthly_price_usdc,
            details: service.details.clone(),
            logo_url: service.logo_url.clone(),
            provider: service.provider.clone(),
            created_at: service.created_at,
        })
        .collect();

    emit!(SubscriptionServicesFetched { services });

    Ok(())
}
