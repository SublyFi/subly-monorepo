use anchor_lang::prelude::*;

use crate::subly::constants::{
    BASIS_POINTS_DIVISOR, CONFIG_SEED, SUBSCRIPTION_REGISTRY_SEED, USER_POSITION_SEED,
    USER_SUBSCRIPTIONS_SEED,
};
use crate::subly::error::ErrorCode;
use crate::subly::instructions::get_subscription_services::SubscriptionServiceInfo;
use crate::subly::state::{SublyConfig, SubscriptionRegistry, UserStake, UserSubscriptions};

#[event]
pub struct UserAvailableServicesFetched {
    pub user: Pubkey,
    pub available_budget_usdc: u64,
    pub services: Vec<SubscriptionServiceInfo>,
}

#[derive(Accounts)]
pub struct GetUserAvailableServices<'info> {
    #[account(
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
    )]
    pub user_position: Account<'info, UserStake>,
    #[account(
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump,
        init_if_needed,
        payer = user,
        space = UserSubscriptions::INITIAL_SIZE,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
    #[account(
        seeds = [SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, SubscriptionRegistry>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<GetUserAvailableServices>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let user_key = ctx.accounts.user.key();

    let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_config,
        ctx.accounts.config.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    let (expected_registry, _) =
        Pubkey::find_program_address(&[SUBSCRIPTION_REGISTRY_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_registry,
        ctx.accounts.subscription_registry.key(),
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

    let (expected_user_subscriptions, subscriptions_bump) = Pubkey::find_program_address(
        &[USER_SUBSCRIPTIONS_SEED.as_bytes(), user_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_subscriptions,
        ctx.accounts.user_subscriptions.key(),
        ErrorCode::InvalidSubscriptionAccount
    );
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, subscriptions_bump);

    ctx.accounts.user_subscriptions.refresh(now)?;

    let monthly_budget = compute_monthly_budget(
        ctx.accounts.user_position.total_principal,
        ctx.accounts.config.apy_bps,
    )?;
    let committed = ctx.accounts.user_subscriptions.total_committed()?;
    let available_budget = monthly_budget.saturating_sub(committed);

    let services: Vec<SubscriptionServiceInfo> = ctx
        .accounts
        .subscription_registry
        .services
        .iter()
        .filter(|service| {
            service.monthly_price_usdc <= available_budget
                && !ctx
                    .accounts
                    .user_subscriptions
                    .has_active_or_pending_for_service(service.id)
        })
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

    emit!(UserAvailableServicesFetched {
        user: user_key,
        available_budget_usdc: available_budget,
        services,
    });

    Ok(())
}

fn compute_monthly_budget(total_principal: u64, apy_bps: u16) -> Result<u64> {
    if total_principal == 0 || apy_bps == 0 {
        return Ok(0);
    }

    let annual_yield = (total_principal as u128)
        .checked_mul(apy_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BASIS_POINTS_DIVISOR as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let monthly_yield = annual_yield
        .checked_div(12)
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(monthly_yield).map_err(|_| ErrorCode::MathOverflow.into())
}
