use anchor_lang::prelude::*;

use crate::subly::constants::{CONFIG_SEED, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, UserSubscriptions};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordSubscriptionPaymentArgs {
    pub subscription_id: u64,
    pub payment_ts: Option<i64>,
}

#[event]
pub struct SubscriptionPaymentRecorded {
    pub operator: Pubkey,
    pub user: Pubkey,
    pub paid_ts: i64,
    // subscription_id and status are not exposed for privacy
}

#[derive(Accounts)]
pub struct RecordSubscriptionPayment<'info> {
    #[account(
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    pub operator: Signer<'info>,
    /// CHECK: used only for PDA seed validation
    pub user: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

pub fn handler(
    ctx: Context<RecordSubscriptionPayment>,
    args: RecordSubscriptionPaymentArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let paid_ts = args.payment_ts.unwrap_or(clock.unix_timestamp);

    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.operator.key(),
        ErrorCode::UnauthorizedAuthority
    );

    let user_key = ctx.accounts.user.key();
    let user_bump = ctx.accounts.user_subscriptions.bump;
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, user_bump);

    // Find subscription to ensure it exists
    let _subscription = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .iter()
        .find(|s| s.id == args.subscription_id)
        .ok_or(ErrorCode::SubscriptionNotFound)?;

    // TODO: Queue update_subscription_metadata MPC instruction to update:
    // - last_payment_ts
    // - next_billing_ts
    // - status (if needed)
    msg!("NOTICE: Payment recording now requires MPC call to update_subscription_metadata");
    msg!("This will update encrypted timestamps in encrypted_metadata field");

    emit!(SubscriptionPaymentRecorded {
        operator: ctx.accounts.operator.key(),
        user: ctx.accounts.user.key(),
        paid_ts,
    });

    Ok(())
}
