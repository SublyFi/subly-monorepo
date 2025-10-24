use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::{lock_duration_for_index, USER_POSITION_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SublyConfig, UserStakeAccount};
use crate::{Stake, StakeSublyCallback, StakeSublyOutput, StakeSublyOutputStruct0, ID};

const CONFIG_CIPHERTEXT_OFFSET: u32 =
    (SublyConfig::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const CONFIG_CIPHERTEXT_LEN: u32 =
    (SublyConfig::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_STAKE_CIPHERTEXT_OFFSET: u32 =
    (UserStakeAccount::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_STAKE_CIPHERTEXT_LEN: u32 =
    (UserStakeAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StakeArgs {
    pub amount: u64,
    pub lock_option: u8,
}

pub fn handler(ctx: Context<Stake>, computation_offset: u64, args: StakeArgs) -> Result<()> {
    require!(args.amount > 0, ErrorCode::AmountTooSmall);

    let lock_duration =
        lock_duration_for_index(args.lock_option).ok_or(ErrorCode::InvalidLockOption)?;

    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ComputationValidationFailed);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    require!(!ctx.accounts.config.paused, ErrorCode::ProgramPaused);
    require!(
        ctx.accounts.config.pending_initialize_offset.is_none(),
        ErrorCode::PendingComputationMismatch
    );
    require!(
        ctx.accounts.config.pending_config_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    {
        let user_stake = &mut ctx.accounts.user_stake;
        user_stake.ensure_owner(ctx.accounts.user.key(), ctx.bumps.user_stake);
        require!(
            user_stake.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
    }

    // Move funds into the vault prior to queuing computation.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        args.amount,
    )?;

    let config_key = ctx.accounts.config.key();
    let user_stake_key = ctx.accounts.user_stake.key();

    let arguments = vec![
        Argument::PlaintextU128(ctx.accounts.config.encrypted_state.nonce),
        Argument::Account(config_key, CONFIG_CIPHERTEXT_OFFSET, CONFIG_CIPHERTEXT_LEN),
        Argument::PlaintextU128(ctx.accounts.user_stake.encrypted_state.nonce),
        Argument::Account(
            user_stake_key,
            USER_STAKE_CIPHERTEXT_OFFSET,
            USER_STAKE_CIPHERTEXT_LEN,
        ),
        Argument::PlaintextU64(args.amount),
        Argument::PlaintextU64(lock_duration as u64),
        Argument::PlaintextU64(now_u64),
    ];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let callback_accounts = [
        CallbackAccount {
            pubkey: config_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: user_stake_key,
            is_writable: true,
        },
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![StakeSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.config.pending_config_offset = Some(computation_offset);
    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<StakeSublyCallback>,
    output: ComputationOutputs<StakeSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user_stake = &mut ctx.accounts.user_stake;

    if config.pending_config_offset.take().is_none()
        || user_stake.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let StakeSublyOutput {
        field_0:
            StakeSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

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

    config.encrypted_state = EncryptedState::from(config_cipher);
    config.paused = false;

    user_stake.encrypted_state = EncryptedState::from(stake_cipher);

    Ok(())
}
