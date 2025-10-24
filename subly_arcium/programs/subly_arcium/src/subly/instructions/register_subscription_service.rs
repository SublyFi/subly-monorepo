use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SubscriptionRegistry, SubscriptionServiceAccount};
use crate::{
    RegisterSubscriptionService, RegisterSubscriptionServiceSublyCallback,
    RegisterSubscriptionServiceSublyOutput, RegisterSubscriptionServiceSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterSubscriptionServiceArgs {
    pub service_hash_low: u128,
    pub service_hash_high: u128,
    pub metadata_hash_low: u128,
    pub metadata_hash_high: u128,
    pub monthly_price_usdc: u64,
    pub billing_interval_secs: u64,
}

pub fn handler(
    ctx: Context<RegisterSubscriptionService>,
    computation_offset: u64,
    args: RegisterSubscriptionServiceArgs,
) -> Result<()> {
    let RegisterSubscriptionServiceArgs {
        service_hash_low,
        service_hash_high,
        metadata_hash_low,
        metadata_hash_high,
        monthly_price_usdc,
        billing_interval_secs,
    } = args;

    require!(
        ctx.accounts
            .subscription_registry
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    {
        let service = &mut ctx.accounts.subscription_service;
        if service.creator == Pubkey::default() {
            service.creator = ctx.accounts.creator.key();
            service.encrypted_state = SubscriptionServiceAccount::blank_state();
            service.bump = ctx.bumps.subscription_service;
        } else {
            require_keys_eq!(
                service.creator,
                ctx.accounts.creator.key(),
                ErrorCode::UnauthorizedAuthority
            );
        }
    }

    let registry_nonce = ctx.accounts.subscription_registry.encrypted_registry.nonce;
    let registry_key = ctx.accounts.subscription_registry.key();
    let service_nonce = ctx.accounts.subscription_service.encrypted_state.nonce;
    let service_key = ctx.accounts.subscription_service.key();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(registry_nonce),
        Argument::Account(
            registry_key,
            (SubscriptionRegistry::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN)
                as u32,
            (SubscriptionRegistry::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32,
        ),
        Argument::PlaintextU128(service_nonce),
        Argument::Account(
            service_key,
            (SubscriptionServiceAccount::ENCRYPTED_STATE_OFFSET
                + crate::subly::state::MXE_NONCE_LEN) as u32,
            (SubscriptionServiceAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN)
                as u32,
        ),
        Argument::PlaintextU128(service_hash_low),
        Argument::PlaintextU128(service_hash_high),
        Argument::PlaintextU64(monthly_price_usdc),
        Argument::PlaintextU64(billing_interval_secs),
        Argument::PlaintextU128(metadata_hash_low),
        Argument::PlaintextU128(metadata_hash_high),
    ];

    let callback_accounts = [
        CallbackAccount {
            pubkey: registry_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: service_key,
            is_writable: true,
        },
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![RegisterSubscriptionServiceSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts
        .subscription_registry
        .pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<RegisterSubscriptionServiceSublyCallback>,
    output: ComputationOutputs<RegisterSubscriptionServiceSublyOutput>,
) -> Result<()> {
    let registry = &mut ctx.accounts.subscription_registry;
    if registry.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let RegisterSubscriptionServiceSublyOutput {
        field_0:
            RegisterSubscriptionServiceSublyOutputStruct0 {
                field_0: registry_cipher,
                field_1: service_cipher,
                field_2: service_id,
                field_3: service_count,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    registry.encrypted_registry = EncryptedState::from(registry_cipher);
    registry.next_service_id = service_id.checked_add(1).ok_or(ErrorCode::MathOverflow)?;
    registry.service_count = service_count;

    let service = &mut ctx.accounts.subscription_service;
    service.id = service_id;
    service.encrypted_state = EncryptedState::from(service_cipher);

    Ok(())
}
