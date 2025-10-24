use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SubscriptionContractAccount, UserSubscriptionsAccount};
use crate::{
    UnsubscribeService, UnsubscribeServiceSublyCallback, UnsubscribeServiceSublyOutput,
    UnsubscribeServiceSublyOutputStruct0,
};

const USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET: u32 =
    (UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_LEN: u32 =
    (UserSubscriptionsAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const CONTRACT_CIPHERTEXT_OFFSET: u32 = (SubscriptionContractAccount::ENCRYPTED_STATE_OFFSET
    + crate::subly::state::MXE_NONCE_LEN) as u32;
const CONTRACT_CIPHERTEXT_LEN: u32 =
    (SubscriptionContractAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UnsubscribeServiceArgs {
    pub contract_seed: [u8; 32],
}

pub fn handler(
    ctx: Context<UnsubscribeService>,
    computation_offset: u64,
    args: UnsubscribeServiceArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    let user_subscriptions_bump = ctx.accounts.user_subscriptions.bump;
    ctx.accounts
        .user_subscriptions
        .ensure_owner(ctx.accounts.user.key(), user_subscriptions_bump);
    require!(
        ctx.accounts
            .user_subscriptions
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    let contract_bump = ctx.accounts.subscription_contract.bump;
    ctx.accounts.subscription_contract.ensure_owner(
        ctx.accounts.user.key(),
        args.contract_seed,
        contract_bump,
    )?;
    require!(
        ctx.accounts
            .subscription_contract
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(ctx.accounts.user_subscriptions.encrypted_state.nonce),
        Argument::Account(
            ctx.accounts.user_subscriptions.key(),
            USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET,
            USER_SUBSCRIPTIONS_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU128(ctx.accounts.subscription_contract.encrypted_state.nonce),
        Argument::Account(
            ctx.accounts.subscription_contract.key(),
            CONTRACT_CIPHERTEXT_OFFSET,
            CONTRACT_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU64(now_u64),
    ];

    let callback_accounts = [
        CallbackAccount {
            pubkey: ctx.accounts.user_subscriptions.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.subscription_contract.key(),
            is_writable: true,
        },
    ];

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
    ctx.accounts
        .subscription_contract
        .pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<UnsubscribeServiceSublyCallback>,
    output: ComputationOutputs<UnsubscribeServiceSublyOutput>,
) -> Result<()> {
    let summary = &mut ctx.accounts.user_subscriptions;
    let contract = &mut ctx.accounts.subscription_contract;

    if summary.pending_computation_offset.take().is_none()
        || contract.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let UnsubscribeServiceSublyOutput {
        field_0:
            UnsubscribeServiceSublyOutputStruct0 {
                field_0: summary_cipher,
                field_1: contract_cipher,
                field_2: success_flag,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag > 0, ErrorCode::ComputationValidationFailed);

    summary.encrypted_state = EncryptedState::from(summary_cipher);
    contract.encrypted_state = EncryptedState::from(contract_cipher);

    Ok(())
}
