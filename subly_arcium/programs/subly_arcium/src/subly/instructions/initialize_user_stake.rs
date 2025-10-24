use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::subly::error::ErrorCode;
use crate::subly::state::EncryptedState;
use crate::{
    InitializeUserStake, InitializeUserStakeSublyCallback, InitializeUserStakeSublyOutput,
};

pub fn handler(ctx: Context<InitializeUserStake>, computation_offset: u64) -> Result<()> {
    let user_stake = &mut ctx.accounts.user_stake;
    user_stake.ensure_owner(ctx.accounts.user.key(), ctx.bumps.user_stake);

    require!(
        user_stake.pending_computation_offset.is_none(),
        ErrorCode::PendingComputationInProgress
    );

    let user_stake_key = user_stake.key();
    user_stake.pending_computation_offset = Some(computation_offset);

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let callback_accounts = vec![CallbackAccount {
        pubkey: user_stake_key,
        is_writable: true,
    }];

    queue_computation(
        ctx.accounts,
        computation_offset,
        vec![], // No arguments needed - creates new encrypted state
        None,
        vec![InitializeUserStakeSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    Ok(())
}

pub fn callback(
    ctx: Context<InitializeUserStakeSublyCallback>,
    output: ComputationOutputs<InitializeUserStakeSublyOutput>,
) -> Result<()> {
    let user_stake = &mut ctx.accounts.user_stake;

    if user_stake.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let InitializeUserStakeSublyOutput {
        field_0: stake_cipher,
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    user_stake.encrypted_state = EncryptedState::from(stake_cipher);

    Ok(())
}
