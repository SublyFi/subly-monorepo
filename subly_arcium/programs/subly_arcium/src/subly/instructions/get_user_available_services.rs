use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{
    EncryptedState, SublyConfig, UserStakeAccount, UserSubscriptionsAccount,
};
use crate::{
    GetUserAvailableServices, GetUserAvailableServicesSublyCallback,
    GetUserAvailableServicesSublyOutput, GetUserAvailableServicesSublyOutputStruct0,
};

#[event]
pub struct UserAvailableServicesFetched {
    pub user: Pubkey,
    pub total_principal: u64,
    pub apy_bps: u16,
    pub monthly_budget_usdc: u64,
    pub active_commitment_usdc: u64,
    pub pending_commitment_usdc: u64,
    pub available_budget_usdc: u64,
}

pub fn handler(ctx: Context<GetUserAvailableServices>, computation_offset: u64) -> Result<()> {
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

    let user_key = ctx.accounts.payer.key();

    {
        let stake_account = &mut ctx.accounts.user_stake;
        stake_account.ensure_owner(user_key, ctx.bumps.user_stake);
        require_keys_eq!(
            stake_account.owner,
            user_key,
            ErrorCode::InvalidPositionOwner
        );
        require!(
            stake_account.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
    }

    {
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
    }

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let config_nonce = ctx.accounts.config.encrypted_state.nonce;
    let config_key = ctx.accounts.config.key();
    let stake_nonce = ctx.accounts.user_stake.encrypted_state.nonce;
    let stake_key = ctx.accounts.user_stake.key();
    let subscriptions_nonce = ctx.accounts.user_subscriptions.encrypted_state.nonce;
    let subscriptions_key = ctx.accounts.user_subscriptions.key();

    let arguments = vec![
        Argument::PlaintextU128(config_nonce),
        Argument::Account(
            config_key,
            SublyConfig::ENCRYPTED_STATE_OFFSET as u32,
            SublyConfig::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU128(stake_nonce),
        Argument::Account(
            stake_key,
            UserStakeAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserStakeAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU128(subscriptions_nonce),
        Argument::Account(
            subscriptions_key,
            UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU64(now_u64),
    ];

    let callback_accounts = [
        CallbackAccount {
            pubkey: config_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: stake_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: subscriptions_key,
            is_writable: true,
        },
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![GetUserAvailableServicesSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);
    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<GetUserAvailableServicesSublyCallback>,
    output: ComputationOutputs<GetUserAvailableServicesSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let stake = &mut ctx.accounts.user_stake;
    let subscriptions = &mut ctx.accounts.user_subscriptions;

    if stake.pending_computation_offset.take().is_none()
        || subscriptions.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let GetUserAvailableServicesSublyOutput {
        field_0:
            GetUserAvailableServicesSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
                field_2: subscriptions_cipher,
                field_3: success_flag,
                field_4: total_principal,
                field_5: apy_bps,
                field_6: monthly_budget,
                field_7: active_commitment,
                field_8: pending_commitment,
                field_9: available_budget,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag != 0, ErrorCode::ComputationValidationFailed);

    config.encrypted_state = EncryptedState::from(config_cipher);
    stake.encrypted_state = EncryptedState::from(stake_cipher);
    subscriptions.encrypted_state = EncryptedState::from(subscriptions_cipher);

    emit!(UserAvailableServicesFetched {
        user: subscriptions.owner,
        total_principal,
        apy_bps,
        monthly_budget_usdc: monthly_budget,
        active_commitment_usdc: active_commitment,
        pending_commitment_usdc: pending_commitment,
        available_budget_usdc: available_budget,
    });

    Ok(())
}
