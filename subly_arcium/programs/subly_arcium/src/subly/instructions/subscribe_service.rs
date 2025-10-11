use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::BILLING_PERIOD_SECONDS;
use crate::subly::error::ErrorCode;
use crate::subly::state::{
    EncryptedState, PayPalRecipientType, SublyConfig, SubscriptionServiceAccount, UserStakeAccount,
    UserSubscriptionsAccount,
};
use crate::{
    SubscribeService, SubscribeServiceSublyCallback, SubscribeServiceSublyOutput,
    SubscribeServiceSublyOutputStruct0,
};

const CONFIG_CIPHERTEXT_OFFSET: u32 = SublyConfig::ENCRYPTED_STATE_OFFSET as u32;
const CONFIG_CIPHERTEXT_LEN: u32 = SublyConfig::ENCRYPTED_STATE_LEN as u32;
const USER_STAKE_CIPHERTEXT_OFFSET: u32 = UserStakeAccount::ENCRYPTED_STATE_OFFSET as u32;
const USER_STAKE_CIPHERTEXT_LEN: u32 = UserStakeAccount::ENCRYPTED_STATE_LEN as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET: u32 =
    UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32;
const USER_SUBSCRIPTIONS_CIPHERTEXT_LEN: u32 = UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32;
const SERVICE_CIPHERTEXT_OFFSET: u32 = SubscriptionServiceAccount::ENCRYPTED_STATE_OFFSET as u32;
const SERVICE_CIPHERTEXT_LEN: u32 = SubscriptionServiceAccount::ENCRYPTED_STATE_LEN as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscribeServiceArgs {
    pub service_id: u64,
}

#[event]
pub struct SubscriptionActivated {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub service_id: u64,
    pub recipient_type: String,
    pub receiver_hash_low: u128,
    pub receiver_hash_high: u128,
}

pub fn handler(
    ctx: Context<SubscribeService>,
    computation_offset: u64,
    args: SubscribeServiceArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;
    let billing_period_u64: u64 = BILLING_PERIOD_SECONDS
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let config_nonce;
    let config_key;
    {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, ErrorCode::ProgramPaused);
        require!(
            config.pending_initialize_offset.is_none(),
            ErrorCode::PendingComputationMismatch
        );
        require!(
            config.pending_config_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
        config_nonce = config.encrypted_state.nonce;
        config_key = config.key();
    }

    let registry = &ctx.accounts.subscription_registry;
    require!(
        registry.pending_computation_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );
    require!(
        registry.service_count > 0,
        ErrorCode::SubscriptionServiceNotFound
    );

    let service = &ctx.accounts.subscription_service;
    require_eq!(
        service.id,
        args.service_id,
        ErrorCode::SubscriptionServiceNotFound
    );
    let service_nonce = service.encrypted_state.nonce;
    let service_key = service.key();

    let user_key = ctx.accounts.user.key();

    let user_stake_nonce;
    let user_stake_key;
    {
        let user_stake = &mut ctx.accounts.user_stake;
        let stake_bump = ctx.bumps.user_stake;
        user_stake.ensure_owner(user_key, stake_bump);
        require_keys_eq!(user_stake.owner, user_key, ErrorCode::InvalidPositionOwner);
        require!(
            user_stake.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
        user_stake_nonce = user_stake.encrypted_state.nonce;
        user_stake_key = user_stake.key();
    }

    let user_subscriptions_nonce;
    let user_subscriptions_key;
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
        user_subscriptions_nonce = user_subscriptions.encrypted_state.nonce;
        user_subscriptions_key = user_subscriptions.key();
    }

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(config_nonce),
        Argument::Account(config_key, CONFIG_CIPHERTEXT_OFFSET, CONFIG_CIPHERTEXT_LEN),
        Argument::PlaintextU128(user_stake_nonce),
        Argument::Account(
            user_stake_key,
            USER_STAKE_CIPHERTEXT_OFFSET,
            USER_STAKE_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU128(user_subscriptions_nonce),
        Argument::Account(
            user_subscriptions_key,
            USER_SUBSCRIPTIONS_CIPHERTEXT_OFFSET,
            USER_SUBSCRIPTIONS_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU128(service_nonce),
        Argument::Account(
            service_key,
            SERVICE_CIPHERTEXT_OFFSET,
            SERVICE_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU64(args.service_id),
        Argument::PlaintextU64(now_u64),
        Argument::PlaintextU64(billing_period_u64),
    ];

    let callback_accounts = [
        CallbackAccount {
            pubkey: config_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: user_stake_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: user_subscriptions_key,
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

    ctx.accounts.config.pending_config_offset = Some(computation_offset);
    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);
    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<SubscribeServiceSublyCallback>,
    output: ComputationOutputs<SubscribeServiceSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user_stake = &mut ctx.accounts.user_stake;
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;

    if config.pending_config_offset.take().is_none()
        || user_stake.pending_computation_offset.take().is_none()
        || user_subscriptions
            .pending_computation_offset
            .take()
            .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let SubscribeServiceSublyOutput {
        field_0:
            SubscribeServiceSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
                field_2: subscriptions_cipher,
                field_3: success_flag,
                field_4: subscription_id,
                field_5: service_id,
                field_6: recipient_type_index,
                field_7: receiver_hash_low,
                field_8: receiver_hash_high,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);

    config.encrypted_state = EncryptedState::from(config_cipher);
    user_stake.encrypted_state = EncryptedState::from(stake_cipher);
    user_subscriptions.encrypted_state = EncryptedState::from(subscriptions_cipher);

    let recipient_type = PayPalRecipientType::from_index(recipient_type_index)
        .ok_or(ErrorCode::InvalidPayPalRecipientType)?;

    emit!(SubscriptionActivated {
        user: user_subscriptions.owner,
        subscription_id,
        service_id,
        recipient_type: recipient_type.as_str().to_string(),
        receiver_hash_low,
        receiver_hash_high,
    });

    Ok(())
}
