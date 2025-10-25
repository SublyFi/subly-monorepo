use anchor_lang::prelude::*;

use crate::subly::constants::{MAX_PAYPAL_RECEIVER_LEN, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{PayPalRecipientType, UserSubscriptions};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterPayPalRecipientArgs {
    pub recipient_type: String,
    pub receiver: String,
}

#[event]
pub struct PayPalRecipientRegistered {
    pub user: Pubkey,
    pub recipient_type: String,
    pub receiver: String,
}

#[derive(Accounts)]
pub struct RegisterPayPalRecipient<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump,
        payer = user,
        space = 8 + UserSubscriptions::BASE_SIZE + 200, // Base + some buffer for receiver string
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterPayPalRecipient>,
    args: RegisterPayPalRecipientArgs,
) -> Result<()> {
    let recipient_type = PayPalRecipientType::from_str(&args.recipient_type)?;
    let receiver = args.receiver.trim().to_string();
    require!(!receiver.is_empty(), ErrorCode::InvalidPayPalRecipientType);
    require!(
        receiver.len() <= MAX_PAYPAL_RECEIVER_LEN,
        ErrorCode::InvalidPayPalRecipientType
    );

    // Initialize new account (init_if_needed ensures proper allocation)
    let user_key = ctx.accounts.user.key();

    // Check if this is a new account that needs initialization
    if ctx.accounts.user_subscriptions.owner == Pubkey::default() {
        msg!(
            "RegisterPayPalRecipient: initializing new account for user={}",
            user_key
        );

        // Initialize all fields for new account
        ctx.accounts.user_subscriptions.owner = user_key;
        ctx.accounts.user_subscriptions.bump = ctx.bumps.user_subscriptions;
        ctx.accounts.user_subscriptions.next_subscription_id = 1; // Start from 1, not 0

        // Initialize ConfidentialBundles with Default trait
        ctx.accounts.user_subscriptions.encrypted_active_commitment = Default::default();
        ctx.accounts.user_subscriptions.encrypted_pending_commitment = Default::default();

        // Initialize empty Vec - this is safe with init_if_needed as Anchor properly allocates space
        ctx.accounts.user_subscriptions.subscriptions = Vec::new();

        msg!("RegisterPayPalRecipient: account initialized successfully");
    } else {
        msg!("RegisterPayPalRecipient: updating existing account");
    }

    // Set PayPal configuration (for both new and existing accounts)
    ctx.accounts.user_subscriptions.paypal_configured = true;
    ctx.accounts.user_subscriptions.paypal_recipient_type = recipient_type;
    ctx.accounts.user_subscriptions.paypal_receiver = receiver.clone();

    msg!("RegisterPayPalRecipient: PayPal info configured");

    emit!(PayPalRecipientRegistered {
        user: user_key,
        recipient_type: recipient_type.as_str().to_string(),
        receiver,
    });

    Ok(())
}
