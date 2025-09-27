use anchor_lang::prelude::*;

use crate::subly::constants::{SUBSCRIPTION_REGISTRY_SEED, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SubscriptionRegistry, SubscriptionStatus, UserSubscriptions};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UserSubscriptionInfo {
    pub subscription_id: u64,
    pub service_id: u64,
    pub service_name: String,
    pub service_details: String,
    pub service_logo_url: String,
    pub service_provider: String,
    pub monthly_price_usdc: u64,
    pub status: String,
    pub started_at: i64,
    pub last_payment_ts: i64,
    pub next_billing_ts: i64,
    pub pending_until_ts: i64,
}

#[event]
pub struct UserSubscriptionsFetched {
    pub user: Pubkey,
    pub subscriptions: Vec<UserSubscriptionInfo>,
}

#[derive(Accounts)]
pub struct GetUserSubscriptions<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
    #[account(
        seeds = [SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, SubscriptionRegistry>,
}

pub fn handler(ctx: Context<GetUserSubscriptions>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let user_key = ctx.accounts.user.key();

    let (expected_pda, subscriptions_bump) = Pubkey::find_program_address(
        &[USER_SUBSCRIPTIONS_SEED.as_bytes(), user_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_pda,
        ctx.accounts.user_subscriptions.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, subscriptions_bump);
    ctx.accounts.user_subscriptions.refresh(now)?;

    let services = &ctx.accounts.subscription_registry.services;

    let mut subscription_infos: Vec<UserSubscriptionInfo> = Vec::new();
    for subscription in ctx.accounts.user_subscriptions.subscriptions.iter() {
        let include = matches!(
            subscription.status,
            SubscriptionStatus::Active | SubscriptionStatus::PendingCancellation
        );
        if !include {
            continue;
        }

        let service = services
            .iter()
            .find(|service| service.id == subscription.service_id)
            .ok_or(ErrorCode::SubscriptionServiceNotFound)?;

        let status = match subscription.status {
            SubscriptionStatus::Active => "ACTIVE",
            SubscriptionStatus::PendingCancellation => "PENDING_CANCELLATION",
            SubscriptionStatus::Cancelled => "CANCELLED",
        };

        subscription_infos.push(UserSubscriptionInfo {
            subscription_id: subscription.id,
            service_id: subscription.service_id,
            service_name: service.name.clone(),
            service_details: service.details.clone(),
            service_logo_url: service.logo_url.clone(),
            service_provider: service.provider.clone(),
            monthly_price_usdc: subscription.monthly_price_usdc,
            status: status.to_string(),
            started_at: subscription.started_at,
            last_payment_ts: subscription.last_payment_ts,
            next_billing_ts: subscription.next_billing_ts,
            pending_until_ts: subscription.pending_until_ts,
        });
    }

    emit!(UserSubscriptionsFetched {
        user: user_key,
        subscriptions: subscription_infos,
    });

    Ok(())
}
