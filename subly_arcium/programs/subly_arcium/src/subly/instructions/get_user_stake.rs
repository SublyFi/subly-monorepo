use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};
use std::convert::TryFrom;

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, UserStakeAccount};
use crate::{
    GetUserStake, GetUserStakeSublyCallback, GetUserStakeSublyOutput,
    GetUserStakeSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StakeEntrySnapshot {
    pub tranche_id: u64,
    pub principal: u64,
    pub deposited_at: i64,
    pub lock_end_ts: i64,
    pub lock_duration: i64,
    pub claimed_operator: u64,
    pub claimed_user: u64,
    pub unrealized_yield: u64,
}

#[event]
pub struct UserStakeFetched {
    pub user: Pubkey,
    pub total_principal: u64,
    pub entries: Vec<StakeEntrySnapshot>,
}

pub fn handler(ctx: Context<GetUserStake>, computation_offset: u64) -> Result<()> {
    let user_key = ctx.accounts.payer.key();
    let (nonce, account_key) = {
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
        (stake_account.encrypted_state.nonce, stake_account.key())
    };

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(nonce),
        Argument::Account(
            account_key,
            UserStakeAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserStakeAccount::ENCRYPTED_STATE_LEN as u32,
        ),
    ];

    let callback_accounts = [CallbackAccount {
        pubkey: account_key,
        is_writable: true,
    }];

    queue_computation(
        ctx.accounts,
        computation_offset,
        arguments,
        None,
        vec![GetUserStakeSublyCallback::callback_ix(&callback_accounts)],
    )?;

    ctx.accounts.user_stake.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<GetUserStakeSublyCallback>,
    output: ComputationOutputs<GetUserStakeSublyOutput>,
) -> Result<()> {
    let stake_account = &mut ctx.accounts.user_stake;
    if stake_account.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let GetUserStakeSublyOutput {
        field_0:
            GetUserStakeSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: total_principal,
                field_2: entry_count,
                field_3: tranche_ids,
                field_4: principals,
                field_5: deposited_at,
                field_6: lock_end_ts,
                field_7: lock_durations,
                field_8: claimed_operator,
                field_9: claimed_user,
                field_10: unrealized_yield,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    stake_account.encrypted_state = EncryptedState::from(encrypted_state);

    let max_entries = principals.len();
    let requested_count = usize::from(entry_count);
    let capped_count = requested_count.min(max_entries);

    let mut snapshots = Vec::new();
    for idx in 0..capped_count {
        let principal = principals[idx];
        if principal == 0 {
            continue;
        }
        let deposited_at_i64 =
            i64::try_from(deposited_at[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
        let lock_end_ts_i64 =
            i64::try_from(lock_end_ts[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
        let lock_duration_i64 =
            i64::try_from(lock_durations[idx]).map_err(|_| ErrorCode::ClockOverflow)?;
        snapshots.push(StakeEntrySnapshot {
            tranche_id: tranche_ids[idx],
            principal,
            deposited_at: deposited_at_i64,
            lock_end_ts: lock_end_ts_i64,
            lock_duration: lock_duration_i64,
            claimed_operator: claimed_operator[idx],
            claimed_user: claimed_user[idx],
            unrealized_yield: unrealized_yield[idx],
        });
    }

    emit!(UserStakeFetched {
        user: stake_account.owner,
        total_principal,
        entries: snapshots,
    });

    Ok(())
}
