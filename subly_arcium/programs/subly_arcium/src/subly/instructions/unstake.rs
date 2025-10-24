use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::{CONFIG_SEED, USER_POSITION_SEED, VAULT_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SublyConfig, UserStakeAccount};
use crate::{Unstake, UnstakeSublyCallback, UnstakeSublyOutput, UnstakeSublyOutputStruct0, ID};

const CONFIG_CIPHERTEXT_OFFSET: u32 =
    (SublyConfig::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const CONFIG_CIPHERTEXT_LEN: u32 =
    (SublyConfig::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_STAKE_CIPHERTEXT_OFFSET: u32 =
    (UserStakeAccount::ENCRYPTED_STATE_OFFSET + crate::subly::state::MXE_NONCE_LEN) as u32;
const USER_STAKE_CIPHERTEXT_LEN: u32 =
    (UserStakeAccount::ENCRYPTED_STATE_LEN - crate::subly::state::MXE_NONCE_LEN) as u32;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UnstakeArgs {
    pub amount: u64,
}

pub fn handler(ctx: Context<Unstake>, computation_offset: u64, args: UnstakeArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ComputationValidationFailed);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

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
        require_keys_eq!(
            user_stake.owner,
            ctx.accounts.user.key(),
            ErrorCode::InvalidPositionOwner
        );
        require!(
            user_stake.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
    }

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
        vec![UnstakeSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.config.pending_config_offset = Some(computation_offset);
    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<UnstakeSublyCallback>,
    output: ComputationOutputs<UnstakeSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let user_stake = &mut ctx.accounts.user_stake;

    if config.pending_config_offset.take().is_none()
        || user_stake.pending_computation_offset.take().is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let UnstakeSublyOutput {
        field_0:
            UnstakeSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: stake_cipher,
                field_2: withdrawn_amount,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(withdrawn_amount > 0, ErrorCode::NothingToUnstake);

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

    // Transfer withdrawn funds from the vault back to the user.
    let vault = &ctx.accounts.vault;
    let expected_vault = Pubkey::create_program_address(
        &[
            VAULT_SEED.as_bytes(),
            config.usdc_mint.as_ref(),
            &[config.vault_bump],
        ],
        &ID,
    )
    .map_err(|_| ErrorCode::InvalidMint)?;
    require_keys_eq!(expected_vault, vault.key(), ErrorCode::InvalidMint);

    let config_seed = CONFIG_SEED.as_bytes();
    let bump_bytes = [config.bump];
    let signer_seeds_slice: &[&[u8]] = &[config_seed, &bump_bytes];
    let signer_seeds = &[signer_seeds_slice];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: config.to_account_info(),
            },
            signer_seeds,
        ),
        withdrawn_amount,
    )?;

    Ok(())
}
