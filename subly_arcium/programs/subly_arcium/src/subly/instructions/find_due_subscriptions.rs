use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, PayPalRecipientType, UserSubscriptionsAccount};
use crate::{
    FindDueSubscriptions, FindDueSubscriptionsSublyCallback, FindDueSubscriptionsSublyOutput,
    FindDueSubscriptionsSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FindDueSubscriptionsArgs {
    pub look_ahead_seconds: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DueSubscriptionInfo {
    pub subscription_id: u64,
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub due_ts: u64,
    pub initial_payment_recorded: bool,
}

#[event]
pub struct SubscriptionsDueForUser {
    pub user: Pubkey,
    pub recipient_type: String,
    pub receiver_hash_low: u128,
    pub receiver_hash_high: u128,
    pub entries: Vec<DueSubscriptionInfo>,
}

pub fn handler(
    ctx: Context<FindDueSubscriptions>,
    computation_offset: u64,
    args: FindDueSubscriptionsArgs,
) -> Result<()> {
    require!(args.look_ahead_seconds >= 0, ErrorCode::ClockOverflow);
    let look_ahead_u64: u64 = args
        .look_ahead_seconds
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    require!(
        ctx.accounts.config.pending_initialize_offset.is_none(),
        ErrorCode::PendingComputationMismatch
    );
    require!(
        ctx.accounts.config.pending_config_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );
    require!(!ctx.accounts.config.paused, ErrorCode::ProgramPaused);

    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    let user_key = ctx.accounts.user.key();
    let subscriptions = &mut ctx.accounts.user_subscriptions;
    let subscriptions_bump = subscriptions.bump;
    subscriptions.ensure_owner(user_key, subscriptions_bump);
    require_keys_eq!(
        subscriptions.owner,
        user_key,
        ErrorCode::InvalidSubscriptionAccount
    );
    require!(
        subscriptions.pending_computation_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let subscriptions_key = subscriptions.key();
    let subscriptions_nonce = subscriptions.encrypted_state.nonce;

    let arguments = vec![
        Argument::PlaintextU128(subscriptions_nonce),
        Argument::Account(
            subscriptions_key,
            UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU64(now_u64),
        Argument::PlaintextU64(look_ahead_u64),
    ];

    let callback_accounts = [CallbackAccount {
        pubkey: subscriptions_key,
        is_writable: true,
    }];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![FindDueSubscriptionsSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<FindDueSubscriptionsSublyCallback>,
    output: ComputationOutputs<FindDueSubscriptionsSublyOutput>,
) -> Result<()> {
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;
    if user_subscriptions
        .pending_computation_offset
        .take()
        .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let FindDueSubscriptionsSublyOutput {
        field_0:
            FindDueSubscriptionsSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: success_flag,
                field_2: due_count,
                field_3: sub_id_0,
                field_4: service_id_0,
                field_5: price_0,
                field_6: due_ts_0,
                field_7: initial_0,
                field_8: sub_id_1,
                field_9: service_id_1,
                field_10: price_1,
                field_11: due_ts_1,
                field_12: initial_1,
                field_13: sub_id_2,
                field_14: service_id_2,
                field_15: price_2,
                field_16: due_ts_2,
                field_17: initial_2,
                field_18: sub_id_3,
                field_19: service_id_3,
                field_20: price_3,
                field_21: due_ts_3,
                field_22: initial_3,
                field_23: recipient_type_index,
                field_24: receiver_hash_low,
                field_25: receiver_hash_high,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);

    user_subscriptions.encrypted_state = EncryptedState::from(encrypted_state);

    let recipient_type = PayPalRecipientType::from_index(recipient_type_index)
        .ok_or(ErrorCode::InvalidPayPalRecipientType)?;

    let candidates = [
        (sub_id_0, service_id_0, price_0, due_ts_0, initial_0),
        (sub_id_1, service_id_1, price_1, due_ts_1, initial_1),
        (sub_id_2, service_id_2, price_2, due_ts_2, initial_2),
        (sub_id_3, service_id_3, price_3, due_ts_3, initial_3),
    ];

    let capped_count = due_count.min(candidates.len() as u8);
    let mut entries = Vec::new();
    for idx in 0..capped_count as usize {
        let (subscription_id, service_id, price, due_ts, initial_flag) = candidates[idx];
        if subscription_id == 0 {
            continue;
        }
        entries.push(DueSubscriptionInfo {
            subscription_id,
            service_id,
            monthly_price_usdc: price,
            due_ts,
            initial_payment_recorded: initial_flag == 1,
        });
    }

    if !entries.is_empty() {
        emit!(SubscriptionsDueForUser {
            user: user_subscriptions.owner,
            recipient_type: recipient_type.as_str().to_string(),
            receiver_hash_low,
            receiver_hash_high,
            entries,
        });
    }

    Ok(())
}
