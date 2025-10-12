use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};
use std::convert::TryFrom;

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, UserSubscriptionsAccount};
use crate::{
    GetUserSubscriptions, GetUserSubscriptionsSublyCallback, GetUserSubscriptionsSublyOutput,
    GetUserSubscriptionsSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UserSubscriptionInfo {
    pub subscription_id: u64,
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub status: String,
    pub started_at: i64,
    pub last_payment_ts: i64,
    pub next_billing_ts: i64,
    pub pending_until_ts: i64,
    pub initial_payment_recorded: bool,
}

#[event]
pub struct UserSubscriptionsFetched {
    pub user: Pubkey,
    pub total_active_commitment: u64,
    pub total_pending_commitment: u64,
    pub subscriptions: Vec<UserSubscriptionInfo>,
}

pub fn handler(ctx: Context<GetUserSubscriptions>, computation_offset: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    let user_key = ctx.accounts.payer.key();
    let (nonce, account_key) = {
        let subscriptions = &mut ctx.accounts.user_subscriptions;
        subscriptions.ensure_owner(user_key, ctx.bumps.user_subscriptions);
        require_keys_eq!(
            subscriptions.owner,
            user_key,
            ErrorCode::InvalidSubscriptionAccount
        );
        require!(
            subscriptions.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
        (subscriptions.encrypted_state.nonce, subscriptions.key())
    };

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(nonce),
        Argument::Account(
            account_key,
            UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU64(now_u64),
    ];

    let callback_accounts = [CallbackAccount {
        pubkey: account_key,
        is_writable: true,
    }];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![GetUserSubscriptionsSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<GetUserSubscriptionsSublyCallback>,
    output: ComputationOutputs<GetUserSubscriptionsSublyOutput>,
) -> Result<()> {
    let subscriptions = &mut ctx.accounts.user_subscriptions;
    if subscriptions.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let GetUserSubscriptionsSublyOutput {
        field_0:
            GetUserSubscriptionsSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: success_flag,
                field_2: total_active_commitment,
                field_3: total_pending_commitment,
                field_4: subscription_ids,
                field_5: service_ids,
                field_6: prices,
                field_7: started_at,
                field_8: last_payment,
                field_9: next_billing,
                field_10: pending_until,
                field_11: status_codes,
                field_12: initial_flags,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag != 0, ErrorCode::ComputationValidationFailed);

    subscriptions.encrypted_state = EncryptedState::from(encrypted_state);

    let mut entries = Vec::new();
    for idx in 0..subscription_ids.len() {
        let subscription_id = subscription_ids[idx];
        if subscription_id == 0 {
            continue;
        }
        let status_code = status_codes[idx];
        let status = match status_code {
            1 => Some("ACTIVE"),
            2 => Some("PENDING_CANCELLATION"),
            _ => None,
        };
        if let Some(status_str) = status {
            let initial_flag = initial_flags[idx] != 0;
            let started_at_i64 =
                i64::try_from(started_at[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
            let last_payment_i64 =
                i64::try_from(last_payment[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
            let next_billing_i64 =
                i64::try_from(next_billing[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
            let pending_until_i64 =
                i64::try_from(pending_until[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
            entries.push(UserSubscriptionInfo {
                subscription_id,
                service_id: service_ids[idx],
                monthly_price_usdc: prices[idx],
                status: status_str.to_string(),
                started_at: started_at_i64,
                last_payment_ts: last_payment_i64,
                next_billing_ts: next_billing_i64,
                pending_until_ts: pending_until_i64,
                initial_payment_recorded: initial_flag,
            });
        }
    }

    emit!(UserSubscriptionsFetched {
        user: subscriptions.owner,
        total_active_commitment,
        total_pending_commitment,
        subscriptions: entries,
    });

    Ok(())
}
