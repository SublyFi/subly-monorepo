use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SublyConfig};
use crate::{
    FundRewards, FundRewardsSublyCallback, FundRewardsSublyOutput, FundRewardsSublyOutputStruct0,
};

#[event]
pub struct RewardPoolFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub new_reward_pool: u64,
}

pub fn handler(ctx: Context<FundRewards>, computation_offset: u64, amount: u64) -> Result<()> {
    require!(amount > 0, ErrorCode::AmountTooSmall);

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

    let now = Clock::get()?.unix_timestamp;
    require!(now >= 0, ErrorCode::ClockOverflow);
    let now_u64: u64 = now.try_into().map_err(|_| ErrorCode::ClockOverflow)?;

    let transfer_accounts = Transfer {
        from: ctx.accounts.funder_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.payer.to_account_info(),
    };
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer_accounts,
        ),
        amount,
    )?;

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let config_key = config.key();
    let config_nonce = config.encrypted_state.nonce;

    let arguments = vec![
        Argument::PlaintextU128(config_nonce),
        Argument::Account(
            config_key,
            SublyConfig::ENCRYPTED_STATE_OFFSET as u32,
            SublyConfig::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU64(amount),
        Argument::PlaintextU64(now_u64),
    ];

    let callback_accounts = [CallbackAccount {
        pubkey: config_key,
        is_writable: true,
    }];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![FundRewardsSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.config.pending_config_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<FundRewardsSublyCallback>,
    output: ComputationOutputs<FundRewardsSublyOutput>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if config.pending_config_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let FundRewardsSublyOutput {
        field_0:
            FundRewardsSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: success_flag,
                field_2: reward_pool,
                field_3: funded_amount,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    require!(success_flag == 1, ErrorCode::ComputationValidationFailed);

    config.encrypted_state = EncryptedState::from(config_cipher);
    config.paused = false;

    emit!(RewardPoolFunded {
        funder: ctx.accounts.funder.key(),
        amount: funded_amount,
        new_reward_pool: reward_pool,
    });

    Ok(())
}
