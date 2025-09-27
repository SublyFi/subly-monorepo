use anchor_lang::prelude::*;

use crate::subly::constants::USER_SUBSCRIPTIONS_SEED;
use crate::subly::error::ErrorCode;
use crate::subly::state::UserSubscriptions;

#[event]
pub struct PayPalRecipientFetched {
    pub user: Pubkey,
    pub configured: bool,
    pub recipient_type: String,
    pub receiver: String,
}

#[derive(Accounts)]
pub struct GetPayPalRecipient<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

pub fn handler(ctx: Context<GetPayPalRecipient>) -> Result<()> {
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

    let account = &ctx.accounts.user_subscriptions;

    emit!(PayPalRecipientFetched {
        user: user_key,
        configured: account.paypal_configured,
        recipient_type: account.paypal_recipient_type.as_str().to_string(),
        receiver: account.paypal_receiver.clone(),
    });

    Ok(())
}
