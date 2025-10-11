use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::BILLING_PERIOD_SECONDS;
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, UserSubscriptionsAccount};
use crate::{
    RecordSubscriptionPayment, RecordSubscriptionPaymentSublyCallback,
    RecordSubscriptionPaymentSublyOutput, RecordSubscriptionPaymentSublyOutputStruct0,
};

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
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub status: String,
    pub paid_ts: i64,
    pub next_billing_ts: i64,
    pub initial_payment_recorded: bool,
}

pub fn handler(
    ctx: Context<RecordSubscriptionPayment>,
    computation_offset: u64,
    args: RecordSubscriptionPaymentArgs,
) -> Result<()> {
    let operator = &ctx.accounts.payer;
    require_keys_eq!(
        ctx.accounts.config.authority,
        operator.key(),
        ErrorCode::UnauthorizedAuthority
    );

    require!(
        ctx.accounts.config.pending_initialize_offset.is_none(),
        ErrorCode::PendingComputationMismatch
    );
    require!(
        ctx.accounts.config.pending_config_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    let paid_ts_i64 = args.payment_ts.unwrap_or(Clock::get()?.unix_timestamp);
    require!(paid_ts_i64 >= 0, ErrorCode::ClockOverflow);
    let paid_ts_u64: u64 = paid_ts_i64
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let billing_period_u64: u64 = BILLING_PERIOD_SECONDS
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

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
        Argument::PlaintextU64(args.subscription_id),
        Argument::PlaintextU64(paid_ts_u64),
        Argument::PlaintextU64(billing_period_u64),
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
        vec![RecordSubscriptionPaymentSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<RecordSubscriptionPaymentSublyCallback>,
    output: ComputationOutputs<RecordSubscriptionPaymentSublyOutput>,
) -> Result<()> {
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;
    if user_subscriptions
        .pending_computation_offset
        .take()
        .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let RecordSubscriptionPaymentSublyOutput {
        field_0:
            RecordSubscriptionPaymentSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: success_flag,
                field_2: subscription_id,
                field_3: service_id,
                field_4: monthly_price,
                field_5: status_code,
                field_6: next_billing_ts,
                field_7: initial_flag,
                field_8: paid_ts,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);

    user_subscriptions.encrypted_state = EncryptedState::from(encrypted_state);

    let status = status_label(status_code)?.to_string();
    let paid_ts_i64: i64 = paid_ts.try_into().map_err(|_| ErrorCode::ClockOverflow)?;
    let next_billing_i64: i64 = next_billing_ts
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let initial_payment_recorded = initial_flag == 1;

    emit!(SubscriptionPaymentRecorded {
        operator: ctx.accounts.operator.key(),
        user: user_subscriptions.owner,
        subscription_id,
        service_id,
        monthly_price_usdc: monthly_price,
        status,
        paid_ts: paid_ts_i64,
        next_billing_ts: next_billing_i64,
        initial_payment_recorded,
    });

    Ok(())
}

fn status_label(code: u8) -> Result<&'static str> {
    match code {
        1 => Ok("ACTIVE"),
        2 => Ok("PENDING_CANCELLATION"),
        3 => Ok("CANCELLED"),
        _ => Err(ErrorCode::ComputationValidationFailed.into()),
    }
}
