use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::BILLING_PERIOD_SECONDS;
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, UserSubscriptionsAccount};
use crate::{
    UnsubscribeService, UnsubscribeServiceSublyCallback, UnsubscribeServiceSublyOutput,
    UnsubscribeServiceSublyOutputStruct0,
};

const USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET: u32 =
    UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_LEN: u32 = UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UnsubscribeServiceArgs {
    pub subscription_id: u64,
}

#[event]
pub struct SubscriptionCancellationRequested {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub service_id: u64,
    pub monthly_price_usdc: u64,
    pub pending_until_ts: i64,
}

pub fn handler(
    ctx: Context<UnsubscribeService>,
    computation_offset: u64,
    args: UnsubscribeServiceArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;
    let billing_period_u64: u64 = BILLING_PERIOD_SECONDS
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let user = &ctx.accounts.user;
    let user_key = user.key();

    let subscriptions_nonce;
    let subscriptions_key;
    {
        let user_subscriptions = &mut ctx.accounts.user_subscriptions;
        let subscriptions_bump = ctx.bumps.user_subscriptions;
        user_subscriptions.ensure_owner(user_key, subscriptions_bump);
        require_keys_eq!(
            user_subscriptions.owner,
            user_key,
            ErrorCode::InvalidSubscriptionAccount
        );
        require!(
            user_subscriptions.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );

        subscriptions_nonce = user_subscriptions.encrypted_state.nonce;
        subscriptions_key = user_subscriptions.key();
    }

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(subscriptions_nonce),
        Argument::Account(
            subscriptions_key,
            USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET,
            USER_SUBSCRIPTIONS_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU64(args.subscription_id),
        Argument::PlaintextU64(now_u64),
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
        vec![UnsubscribeServiceSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<UnsubscribeServiceSublyCallback>,
    output: ComputationOutputs<UnsubscribeServiceSublyOutput>,
) -> Result<()> {
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;
    if user_subscriptions
        .pending_computation_offset
        .take()
        .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let UnsubscribeServiceSublyOutput {
        field_0:
            UnsubscribeServiceSublyOutputStruct0 {
                field_0: subscriptions_cipher,
                field_1: success_flag,
                field_2: subscription_id,
                field_3: service_id,
                field_4: monthly_price_usdc,
                field_5: pending_until_ts,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);

    user_subscriptions.encrypted_state = EncryptedState::from(subscriptions_cipher);

    let pending_until_i64: i64 = pending_until_ts
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    emit!(SubscriptionCancellationRequested {
        user: user_subscriptions.owner,
        subscription_id,
        service_id,
        monthly_price_usdc,
        pending_until_ts: pending_until_i64,
    });

    Ok(())
}
