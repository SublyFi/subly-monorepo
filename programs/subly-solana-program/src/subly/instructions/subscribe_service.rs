use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};

use crate::subly::constants::{
    BASIS_POINTS_DIVISOR, BILLING_PERIOD_SECONDS, CONFIG_SEED, SUBSCRIPTION_REGISTRY_SEED,
    USER_POSITION_SEED, USER_SUBSCRIPTIONS_SEED,
};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, SubscriptionRegistry, UserStake, UserSubscriptions};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscribeServiceArgs {
    pub service_id: u64,
}

#[event]
pub struct SubscriptionActivated {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub recipient_type: String,
    pub receiver: String,
}

#[derive(Accounts)]
pub struct SubscribeService<'info> {
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

pub fn handler(ctx: Context<SubscribeService>, args: SubscribeServiceArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let config = &ctx.accounts.config;
    config.ensure_active()?;

    let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_config,
        config.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    let (expected_registry, _) =
        Pubkey::find_program_address(&[SUBSCRIPTION_REGISTRY_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_registry,
        ctx.accounts.subscription_registry.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    let user_key = ctx.accounts.user.key();

    // Ensure user position PDA matches expectations.
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

    // Ensure user subscriptions PDA is initialised for this wallet.
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
    require!(
        ctx.accounts.user_subscriptions.paypal_configured,
        ErrorCode::PayPalInfoMissing
    );

    let service = ctx
        .accounts
        .subscription_registry
        .services
        .iter()
        .find(|service| service.id == args.service_id)
        .ok_or(ErrorCode::SubscriptionServiceNotFound)?;

    require!(
        !ctx.accounts
            .user_subscriptions
            .has_active_or_pending_for_service(service.id),
        ErrorCode::SubscriptionAlreadyExists
    );

    let monthly_budget =
        compute_monthly_budget(ctx.accounts.user_position.total_principal, config.apy_bps)?;
    require!(monthly_budget > 0, ErrorCode::SubscriptionBudgetExceeded);

    let committed = ctx.accounts.user_subscriptions.total_committed()?;
    let required_commitment = committed
        .checked_add(service.monthly_price_usdc)
        .ok_or(ErrorCode::MathOverflow)?;
    require!(
        required_commitment <= monthly_budget,
        ErrorCode::SubscriptionBudgetExceeded
    );

    // Ensure account has enough space and rent to append the new subscription.
    let desired_len = ctx.accounts.user_subscriptions.subscriptions.len() + 1;
    let required_space = UserSubscriptions::required_size(
        desired_len,
        ctx.accounts.user_subscriptions.receiver_len(),
    );
    let user_subscriptions_info = ctx.accounts.user_subscriptions.to_account_info();
    if user_subscriptions_info.data_len() < required_space {
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(required_space);
        let current_lamports = user_subscriptions_info.lamports();
        if required_lamports > current_lamports {
            let difference = required_lamports - current_lamports;
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.user.to_account_info(),
                to: user_subscriptions_info.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            system_program::transfer(CpiContext::new(cpi_program, transfer_accounts), difference)?;
        }
        user_subscriptions_info.resize(required_space)?;
    }

    let subscription_id = ctx.accounts.user_subscriptions.record_subscription(
        service.id,
        service.monthly_price_usdc,
        now,
        BILLING_PERIOD_SECONDS,
    )?;

    let recipient_type = ctx
        .accounts
        .user_subscriptions
        .paypal_recipient_type
        .as_str()
        .to_string();
    let receiver = ctx.accounts.user_subscriptions.paypal_receiver.clone();

    emit!(SubscriptionActivated {
        user: user_key,
        subscription_id,
        service_id: service.id,
        monthly_price_usdc: service.monthly_price_usdc,
        recipient_type,
        receiver,
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
