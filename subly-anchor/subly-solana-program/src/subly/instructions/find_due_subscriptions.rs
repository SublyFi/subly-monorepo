use anchor_lang::{prelude::*, AccountDeserialize};

use crate::subly::constants::{CONFIG_SEED, SUBSCRIPTION_REGISTRY_SEED, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{
    SublyConfig, SubscriptionRegistry, SubscriptionStatus, UserSubscriptions,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FindDueSubscriptionsArgs {
    pub look_ahead_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DueSubscriptionInfo {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub service_id: u64,
    pub service_name: String,
    pub monthly_price_usdc: u64,
    pub recipient_type: String,
    pub receiver: String,
    pub due_ts: i64,
    pub initial_payment_recorded: bool,
}

#[event]
pub struct SubscriptionsDue {
    pub entries: Vec<DueSubscriptionInfo>,
}

#[derive(Accounts)]
pub struct FindDueSubscriptions<'info> {
    #[account(
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(
        seeds = [SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, SubscriptionRegistry>,
}

pub fn handler(ctx: Context<FindDueSubscriptions>, args: FindDueSubscriptionsArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let upper_bound = now
        .checked_add(args.look_ahead_seconds)
        .ok_or(ErrorCode::MathOverflow)?;

    ctx.accounts.config.ensure_active()?;

    let mut due_entries: Vec<DueSubscriptionInfo> = Vec::new();

    for account_info in ctx.remaining_accounts.iter() {
        let account_info = account_info.clone();
        let account_key = *account_info.key;
        let data_ref = account_info.try_borrow_data()?;
        let mut data_slice: &[u8] = &data_ref;
        let user_subscriptions_account = UserSubscriptions::try_deserialize(&mut data_slice)?;
        drop(data_ref);
        let user_key = user_subscriptions_account.owner;

        let (expected_pda, _) = Pubkey::find_program_address(
            &[USER_SUBSCRIPTIONS_SEED.as_bytes(), user_key.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(
            expected_pda,
            account_key,
            ErrorCode::InvalidSubscriptionAccount
        );

        if !user_subscriptions_account.paypal_configured {
            continue;
        }

        let recipient_type = user_subscriptions_account
            .paypal_recipient_type
            .as_str()
            .to_string();
        let receiver = user_subscriptions_account.paypal_receiver.clone();

        for subscription in user_subscriptions_account.subscriptions.iter() {
            if subscription.status != SubscriptionStatus::Active {
                continue;
            }
            let initial_payment_pending = !subscription.initial_payment_recorded;
            if !initial_payment_pending && subscription.next_billing_ts > upper_bound {
                continue;
            }

            let service = ctx
                .accounts
                .subscription_registry
                .services
                .iter()
                .find(|service| service.id == subscription.service_id)
                .ok_or(ErrorCode::SubscriptionServiceNotFound)?;

            due_entries.push(DueSubscriptionInfo {
                user: user_key,
                subscription_id: subscription.id,
                service_id: subscription.service_id,
                service_name: service.name.clone(),
                monthly_price_usdc: subscription.monthly_price_usdc,
                recipient_type: recipient_type.clone(),
                receiver: receiver.clone(),
                due_ts: subscription.next_billing_ts,
                initial_payment_recorded: subscription.initial_payment_recorded,
            });
        }
    }

    if !due_entries.is_empty() {
        emit!(SubscriptionsDue {
            entries: due_entries
        });
    }

    Ok(())
}
