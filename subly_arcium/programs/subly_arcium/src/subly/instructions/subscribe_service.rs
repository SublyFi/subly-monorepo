use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{
    EncryptedState, SubscriptionContractAccount, SubscriptionRegistry, SubscriptionServiceAccount,
    UserSubscriptionsAccount,
};
use crate::{
    SubscribeService, SubscribeServiceSublyCallback, SubscribeServiceSublyOutput,
    SubscribeServiceSublyOutputStruct0,
};

const REGISTRY_CIPHERTEXT_OFFSET: u32 =
    (SubscriptionRegistry::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const REGISTRY_CIPHERTEXT_LEN: u32 =
    (SubscriptionRegistry::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET: u32 =
    (UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_LEN: u32 =
    (UserSubscriptionsAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const SERVICE_CIPHERTEXT_OFFSET: u32 = (SubscriptionServiceAccount::ENCRYPTED_STATE_OFFSET
    + crate::subly::state::MXE_NONCE_LEN) as u32;
const SERVICE_CIPHERTEXT_LEN: u32 =
    (SubscriptionServiceAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const CONTRACT_CIPHERTEXT_OFFSET: u32 = (SubscriptionContractAccount::ENCRYPTED_STATE_OFFSET
    + crate::subly::state::MXE_NONCE_LEN) as u32;
const CONTRACT_CIPHERTEXT_LEN: u32 =
    (SubscriptionContractAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscribeServiceArgs {
    pub service_id: u64,
    pub contract_seed: [u8; 32],
}

pub fn handler(
    ctx: Context<SubscribeService>,
    computation_offset: u64,
    args: SubscribeServiceArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    // Registry must not be mid-computation.
    require!(
        ctx.accounts
            .subscription_registry
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );
    let _ = ctx.accounts.subscription_registry.service_count;

    // Service metadata must match requested id.
    require_eq!(
        ctx.accounts.subscription_service.id,
        args.service_id,
        ErrorCode::SubscriptionServiceNotFound
    );

    // Ensure the summary account belongs to the user.
    ctx.accounts
        .user_subscriptions
        .ensure_owner(ctx.accounts.user.key(), ctx.bumps.user_subscriptions);
    require!(
        ctx.accounts
            .user_subscriptions
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    // Ensure the per-contract account is owned by the user.
    ctx.accounts.subscription_contract.ensure_owner(
        ctx.accounts.user.key(),
        args.contract_seed,
        ctx.bumps.subscription_contract,
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
        Argument::PlaintextU128(ctx.accounts.subscription_registry.encrypted_registry.nonce),
        Argument::Account(
            ctx.accounts.subscription_registry.key(),
            REGISTRY_CIPHERTEXT_OFFSET,
            REGISTRY_CIPHERTEXT_LEN,
        ),
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
        Argument::PlaintextU128(ctx.accounts.subscription_service.encrypted_state.nonce),
        Argument::Account(
            ctx.accounts.subscription_service.key(),
            SERVICE_CIPHERTEXT_OFFSET,
            SERVICE_CIPHERTEXT_LEN,
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
        vec![SubscribeServiceSublyCallback::callback_ix(
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
    ctx: Context<SubscribeServiceSublyCallback>,
    output: ComputationOutputs<SubscribeServiceSublyOutput>,
) -> Result<()> {
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;
    let subscription_contract = &mut ctx.accounts.subscription_contract;

    if user_subscriptions
        .pending_computation_offset
        .take()
        .is_none()
        || subscription_contract
            .pending_computation_offset
            .take()
            .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let SubscribeServiceSublyOutput {
        field_0:
            SubscribeServiceSublyOutputStruct0 {
                field_0: summary_cipher,
                field_1: contract_cipher,
                field_2: success_flag,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag > 0, ErrorCode::ComputationValidationFailed);

    user_subscriptions.encrypted_state = EncryptedState::from(summary_cipher);
    subscription_contract.encrypted_state = EncryptedState::from(contract_cipher);

    Ok(())
}
