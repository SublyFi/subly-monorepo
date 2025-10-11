use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::USER_POSITION_SEED;
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SublyConfig, UserStakeAccount};
use crate::{
    SyncYield, SyncYieldSublyCallback, SyncYieldSublyOutput, SyncYieldSublyOutputStruct0, ID,
};

const CONFIG_CIPHERTEXT_OFFSET: u32 = SublyConfig::ENCRYPTED_STATE_OFFSET as u32;
const CONFIG_CIPHERTEXT_LEN: u32 = SublyConfig::ENCRYPTED_STATE_LEN as u32;
const USER_STAKE_CIPHERTEXT_OFFSET: u32 = UserStakeAccount::ENCRYPTED_STATE_OFFSET as u32;
const USER_STAKE_CIPHERTEXT_LEN: u32 = UserStakeAccount::ENCRYPTED_STATE_LEN as u32;

#[event]
pub struct YieldSnapshot {
    pub owner: Pubkey,
    pub total_principal: u64,
    pub total_unrealized_yield: u64,
    pub total_generated_yield: u64,
    pub operator_claimed: u64,
    pub user_claimed: u64,
    pub tranche_count: u32,
    pub last_updated_ts: u64,
}

pub fn handler(ctx: Context<SyncYield>, computation_offset: u64) -> Result<()> {
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

    require_keys_eq!(
        ctx.accounts.user_stake.owner,
        ctx.accounts.user.key(),
        ErrorCode::InvalidPositionOwner
    );
    require!(
        ctx.accounts.user_stake.pending_computation_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    let config_nonce = ctx.accounts.config.encrypted_state.nonce;
    let user_nonce = ctx.accounts.user_stake.encrypted_state.nonce;
    let config_key = ctx.accounts.config.key();
    let user_key = ctx.accounts.user_stake.key();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(config_nonce),
        Argument::Account(config_key, CONFIG_CIPHERTEXT_OFFSET, CONFIG_CIPHERTEXT_LEN),
        Argument::PlaintextU128(user_nonce),
        Argument::Account(
            user_key,
            USER_STAKE_CIPHERTEXT_OFFSET,
            USER_STAKE_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU64(now_u64),
    ];

    let callback_accounts = [
        CallbackAccount {
            pubkey: config_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: user_key,
            is_writable: true,
        },
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![SyncYieldSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.config.pending_config_offset = Some(computation_offset);
    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<SyncYieldSublyCallback>,
    output: ComputationOutputs<SyncYieldSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user_stake = &mut ctx.accounts.user_stake;

    if config.pending_config_offset.take().is_none()
        || user_stake.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let SyncYieldSublyOutput {
        field_0:
            SyncYieldSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
                field_2: total_principal,
                field_3: total_unrealized_yield,
                field_4: total_generated_yield,
                field_5: operator_claimed,
                field_6: user_claimed,
                field_7: tranche_count,
                field_8: last_updated,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    config.encrypted_state = EncryptedState::from(config_cipher);
    config.pending_config_offset = None;
    config.paused = false;

    user_stake.encrypted_state = EncryptedState::from(stake_cipher);
    user_stake.entry_count = tranche_count
        .try_into()
        .map_err(|_| ErrorCode::ComputationValidationFailed)?;

    let expected_user_pda = Pubkey::create_program_address(
        &[
            USER_POSITION_SEED.as_bytes(),
            user_stake.owner.as_ref(),
            &[user_stake.bump],
        ],
        &ID,
    )
    .map_err(|_| ErrorCode::InvalidPositionOwner)?;
    require_keys_eq!(
        expected_user_pda,
        user_stake.key(),
        ErrorCode::InvalidPositionOwner
    );

    emit!(YieldSnapshot {
        owner: user_stake.owner,
        total_principal,
        total_unrealized_yield,
        total_generated_yield,
        operator_claimed,
        user_claimed,
        tranche_count,
        last_updated_ts: last_updated,
    });

    Ok(())
}
