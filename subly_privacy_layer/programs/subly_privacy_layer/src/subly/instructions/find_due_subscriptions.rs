use anchor_lang::prelude::*;

use crate::subly::constants::CONFIG_SEED;
use crate::subly::instructions::subscribe_service::EncryptedPayloadEvent;
use crate::subly::state::SublyConfig;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FindDueSubscriptionsArgs {
    pub look_ahead_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DueSubscriptionInfo {
    pub user: Pubkey,
    pub encrypted_subscription: EncryptedPayloadEvent,
    // subscription_id, recipient_type, receiver, due_ts, and initial_payment_recorded
    // are not exposed for privacy. Backend processes encrypted_subscription to extract needed info.
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
}

pub fn handler(ctx: Context<FindDueSubscriptions>, _args: FindDueSubscriptionsArgs) -> Result<()> {
    ctx.accounts.config.ensure_active()?;

    // TODO: Implement MPC-based due subscription detection
    // This will require a new MPC instruction that:
    // 1. Takes encrypted_metadata from all subscriptions
    // 2. Decrypts next_billing_ts and status in MPC
    // 3. Compares with current time + lookahead
    // 4. Returns list of due subscription indices (boolean array)

    msg!("NOTICE: find_due_subscriptions now requires MPC implementation");
    msg!("Due subscriptions cannot be determined without decrypting metadata");
    msg!("A new MPC instruction 'find_due_subscriptions_mpc' is needed");
    msg!("For now, this function returns empty list");

    // Return empty for now - MPC implementation needed
    let due_entries: Vec<DueSubscriptionInfo> = Vec::new();

    if !due_entries.is_empty() {
        emit!(SubscriptionsDue {
            entries: due_entries
        });
    }

    Ok(())
}
