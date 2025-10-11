use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::{
    MAX_SERVICE_DETAILS_LEN, MAX_SERVICE_LOGO_URL_LEN, MAX_SERVICE_NAME_LEN,
    MAX_SERVICE_PROVIDER_LEN,
};
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SubscriptionRegistry, SubscriptionServiceAccount};
use crate::{
    RegisterSubscriptionService, RegisterSubscriptionServiceSublyCallback,
    RegisterSubscriptionServiceSublyOutput, RegisterSubscriptionServiceSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterSubscriptionServiceArgs {
    pub name: String,
    pub monthly_price_usdc: u64,
    pub details: String,
    pub logo_url: String,
    pub provider: String,
}

#[event]
pub struct SubscriptionServiceRegistered {
    pub id: u64,
    pub creator: Pubkey,
    pub monthly_price_usdc: u64,
    pub name_hash_low: u128,
    pub name_hash_high: u128,
    pub details_hash_low: u128,
    pub details_hash_high: u128,
    pub logo_hash_low: u128,
    pub logo_hash_high: u128,
    pub provider_hash_low: u128,
    pub provider_hash_high: u128,
    pub created_at: u64,
}

pub fn handler(
    ctx: Context<RegisterSubscriptionService>,
    computation_offset: u64,
    args: RegisterSubscriptionServiceArgs,
) -> Result<()> {
    let RegisterSubscriptionServiceArgs {
        name,
        monthly_price_usdc,
        details,
        logo_url,
        provider,
    } = args;

    let name = name.trim();
    let details = details.trim();
    let logo_url = logo_url.trim();
    let provider = provider.trim();

    require!(
        !name.is_empty() && name.len() <= MAX_SERVICE_NAME_LEN,
        ErrorCode::StringTooLong
    );
    require!(
        details.len() <= MAX_SERVICE_DETAILS_LEN,
        ErrorCode::StringTooLong
    );
    require!(
        logo_url.len() <= MAX_SERVICE_LOGO_URL_LEN,
        ErrorCode::StringTooLong
    );
    require!(
        provider.len() <= MAX_SERVICE_PROVIDER_LEN,
        ErrorCode::StringTooLong
    );

    let clock = Clock::get()?;
    let created_at = clock.unix_timestamp;
    require!(created_at >= 0, ErrorCode::ClockOverflow);
    let created_at_u64: u64 = created_at
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let (name_hash_low, name_hash_high) = hash_to_u128_pair(name.as_bytes());
    let (details_hash_low, details_hash_high) = hash_to_u128_pair(details.as_bytes());
    let (logo_hash_low, logo_hash_high) = hash_to_u128_pair(logo_url.as_bytes());
    let (provider_hash_low, provider_hash_high) = hash_to_u128_pair(provider.as_bytes());
    let (creator_low, creator_high) = pubkey_to_u128_pair(ctx.accounts.creator.key());

    require!(
        ctx.accounts
            .subscription_registry
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    let service_id = ctx.accounts.subscription_registry.next_service_id;

    {
        let service = &mut ctx.accounts.subscription_service;
        service.id = service_id;
        service.creator = ctx.accounts.creator.key();
        service.encrypted_state = SubscriptionServiceAccount::blank_state();
        service.bump = ctx.bumps.subscription_service;
    }

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let registry_nonce = ctx.accounts.subscription_registry.encrypted_registry.nonce;
    let registry_key = ctx.accounts.subscription_registry.key();
    let service_nonce = ctx.accounts.subscription_service.encrypted_state.nonce;
    let service_key = ctx.accounts.subscription_service.key();

    let arguments = vec![
        Argument::PlaintextU128(registry_nonce),
        Argument::Account(
            registry_key,
            SubscriptionRegistry::ENCRYPTED_STATE_OFFSET as u32,
            SubscriptionRegistry::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU128(service_nonce),
        Argument::Account(
            service_key,
            SubscriptionServiceAccount::ENCRYPTED_STATE_OFFSET as u32,
            SubscriptionServiceAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU128(creator_low),
        Argument::PlaintextU128(creator_high),
        Argument::PlaintextU128(name_hash_low),
        Argument::PlaintextU128(name_hash_high),
        Argument::PlaintextU128(details_hash_low),
        Argument::PlaintextU128(details_hash_high),
        Argument::PlaintextU128(logo_hash_low),
        Argument::PlaintextU128(logo_hash_high),
        Argument::PlaintextU128(provider_hash_low),
        Argument::PlaintextU128(provider_hash_high),
        Argument::PlaintextU64(monthly_price_usdc),
        Argument::PlaintextU64(created_at_u64),
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
                field_4: monthly_price,
                field_5: created_at,
                field_6: name_hash_low,
                field_7: name_hash_high,
                field_8: details_hash_low,
                field_9: details_hash_high,
                field_10: logo_hash_low,
                field_11: logo_hash_high,
                field_12: provider_hash_low,
                field_13: provider_hash_high,
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

    emit!(SubscriptionServiceRegistered {
        id: service_id,
        creator: service.creator,
        monthly_price_usdc: monthly_price,
        name_hash_low,
        name_hash_high,
        details_hash_low,
        details_hash_high,
        logo_hash_low,
        logo_hash_high,
        provider_hash_low,
        provider_hash_high,
        created_at,
    });

    Ok(())
}

fn hash_to_u128_pair(data: &[u8]) -> (u128, u128) {
    let digest = hashv(&[data]);
    let bytes = digest.to_bytes();
    let mut low = [0u8; 16];
    let mut high = [0u8; 16];
    low.copy_from_slice(&bytes[..16]);
    high.copy_from_slice(&bytes[16..]);
    (u128::from_le_bytes(low), u128::from_le_bytes(high))
}

fn pubkey_to_u128_pair(pubkey: Pubkey) -> (u128, u128) {
    let bytes = pubkey.to_bytes();
    let mut low = [0u8; 16];
    let mut high = [0u8; 16];
    low.copy_from_slice(&bytes[..16]);
    high.copy_from_slice(&bytes[16..]);
    (u128::from_le_bytes(low), u128::from_le_bytes(high))
}
