use anchor_lang::prelude::*;

use crate::subly::constants::{BILLING_PERIOD_SECONDS, CONFIG_SEED, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{SublyConfig, SubscriptionStatus, UserSubscriptions};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordSubscriptionPaymentArgs {
    pub subscription_id: u64,
    pub payment_ts: Option<i64>,
}

#[event]
pub struct SubscriptionPaymentRecorded {
    pub operator: Pubkey,
    pub user: Pubkey,
    pub subscription_id: u64,
    pub status: String,
    pub paid_ts: i64,
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

    let status = ctx.accounts.user_subscriptions.record_payment(
        args.subscription_id,
        paid_ts,
        BILLING_PERIOD_SECONDS,
    )?;

    let status_str = match status {
        SubscriptionStatus::Active => "ACTIVE",
        SubscriptionStatus::PendingCancellation => "PENDING_CANCELLATION",
        SubscriptionStatus::Cancelled => "CANCELLED",
    }
    .to_string();

    emit!(SubscriptionPaymentRecorded {
        operator: ctx.accounts.operator.key(),
        user: ctx.accounts.user.key(),
        subscription_id: args.subscription_id,
        status: status_str,
        paid_ts,
    });

    Ok(())
}
