use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};

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
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump,
        init_if_needed,
        payer = user,
        space = UserSubscriptions::INITIAL_SIZE,
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

    let (expected_user_subscriptions, subscriptions_bump) = Pubkey::find_program_address(
        &[
            USER_SUBSCRIPTIONS_SEED.as_bytes(),
            ctx.accounts.user.key().as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_subscriptions,
        ctx.accounts.user_subscriptions.key(),
        ErrorCode::InvalidSubscriptionAccount
    );

    ctx.accounts
        .user_subscriptions
        .ensure_owner(ctx.accounts.user.key(), subscriptions_bump);

    let desired_len = ctx.accounts.user_subscriptions.subscriptions.len();
    let required_space = UserSubscriptions::required_size(desired_len, receiver.len());
    let account_info = ctx.accounts.user_subscriptions.to_account_info();
    if account_info.data_len() < required_space {
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(required_space);
        let current_lamports = account_info.lamports();
        if required_lamports > current_lamports {
            let difference = required_lamports - current_lamports;
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.user.to_account_info(),
                to: account_info.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            system_program::transfer(CpiContext::new(cpi_program, transfer_accounts), difference)?;
        }
        account_info.resize(required_space)?;
    }

    ctx.accounts
        .user_subscriptions
        .set_paypal_recipient(recipient_type, receiver.clone());

    emit!(PayPalRecipientRegistered {
        user: ctx.accounts.user.key(),
        recipient_type: recipient_type.as_str().to_string(),
        receiver,
    });

    Ok(())
}
