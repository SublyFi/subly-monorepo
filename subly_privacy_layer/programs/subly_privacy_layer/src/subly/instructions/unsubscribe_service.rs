use anchor_lang::prelude::*;

use crate::subly::constants::{BILLING_PERIOD_SECONDS, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::instructions::subscribe_service::EncryptedPayloadEvent;
use crate::subly::state::UserSubscriptions;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UnsubscribeServiceArgs {
    pub subscription_id: u64,
}

#[event]
pub struct SubscriptionCancellationRequested {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub encrypted_subscription: EncryptedPayloadEvent,
    pub pending_until_ts: i64,
}

#[derive(Accounts)]
pub struct UnsubscribeService<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

pub fn handler(ctx: Context<UnsubscribeService>, args: UnsubscribeServiceArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let user_key = ctx.accounts.user.key();

    let stored_bump = ctx.accounts.user_subscriptions.bump;
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, stored_bump);

    ctx.accounts.user_subscriptions.refresh(now)?;

    let subscription = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .iter()
        .find(|subscription| subscription.id == args.subscription_id)
        .cloned()
        .ok_or(ErrorCode::SubscriptionNotFound)?;

    let pending_until_ts = ctx.accounts.user_subscriptions.begin_cancellation(
        args.subscription_id,
        now,
        BILLING_PERIOD_SECONDS,
    )?;

    emit!(SubscriptionCancellationRequested {
        user: user_key,
        subscription_id: args.subscription_id,
        encrypted_subscription: EncryptedPayloadEvent {
            ciphertexts: subscription.encrypted_data.as_vec(),
            nonce: subscription.encrypted_data.nonce,
            encryption_key: subscription.encrypted_data.encryption_key,
        },
        pending_until_ts,
    });

    Ok(())
}
