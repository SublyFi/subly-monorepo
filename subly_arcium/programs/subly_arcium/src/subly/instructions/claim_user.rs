use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED, VAULT_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SublyConfig, UserStakeAccount};
use crate::{
    ClaimUser, ClaimUserSublyCallback, ClaimUserSublyOutput, ClaimUserSublyOutputStruct0, ID,
};

#[event]
pub struct UserYieldClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub claimed_at: i64,
}

pub fn handler(ctx: Context<ClaimUser>, computation_offset: u64, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    let config = &ctx.accounts.config;
    require!(
        config.pending_initialize_offset.is_none(),
        ErrorCode::PendingComputationMismatch
    );
    require!(
        config.pending_config_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );
    require!(!config.paused, ErrorCode::ProgramPaused);

    let user = &ctx.accounts.user;
    let user_stake = &ctx.accounts.user_stake;
    require_keys_eq!(
        user_stake.owner,
        user.key(),
        ErrorCode::InvalidPositionOwner
    );
    require!(
        user_stake.pending_computation_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let config_key = config.key();
    let config_nonce = config.encrypted_state.nonce;
    let stake_key = user_stake.key();
    let stake_nonce = user_stake.encrypted_state.nonce;
    let vault_key = ctx.accounts.vault.key();
    let user_token_key = ctx.accounts.user_token_account.key();
    let token_program_key = ctx.accounts.token_program.key();

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
        Argument::PlaintextU64(amount),
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
            pubkey: vault_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: user_token_key,
            is_writable: true,
        },
        CallbackAccount {
            pubkey: token_program_key,
            is_writable: false,
        },
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![ClaimUserSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.config.pending_config_offset = Some(computation_offset);
    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<ClaimUserSublyCallback>,
    output: ComputationOutputs<ClaimUserSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user_stake = &mut ctx.accounts.user_stake;

    if config.pending_config_offset.take().is_none()
        || user_stake.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let ClaimUserSublyOutput {
        field_0:
            ClaimUserSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
                field_2: success_flag,
                field_3: claimed_amount,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);
    require!(claimed_amount > 0, ErrorCode::NothingToClaim);

    config.encrypted_state = EncryptedState::from(config_cipher);
    config.paused = false;

    user_stake.encrypted_state = EncryptedState::from(stake_cipher);

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

    let vault = &ctx.accounts.vault;
    let expected_vault =
        Pubkey::create_program_address(&[VAULT_SEED.as_bytes(), &[config.vault_bump]], &ID)
            .map_err(|_| ErrorCode::InvalidMint)?;
    require_keys_eq!(expected_vault, vault.key(), ErrorCode::InvalidMint);

    let config_seed = CONFIG_SEED.as_bytes();
    let bump_bytes = [config.bump];
    let signer_seeds_slice: &[&[u8]] = &[config_seed, &bump_bytes];
    let signer_seeds = &[signer_seeds_slice];

    let transfer_accounts = Transfer {
        from: vault.to_account_info(),
        to: ctx.accounts.user_token_account.to_account_info(),
        authority: config.to_account_info(),
    };

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
            signer_seeds,
        ),
        claimed_amount,
    )?;

    let claimed_at = Clock::get()?.unix_timestamp;

    emit!(UserYieldClaimed {
        user: user_stake.owner,
        amount: claimed_amount,
        claimed_at,
    });

    Ok(())
}
