use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, PayPalRecipientType, UserSubscriptionsAccount};
use crate::{
    GetPaypalRecipient, GetPaypalRecipientSublyCallback, GetPaypalRecipientSublyOutput,
    GetPaypalRecipientSublyOutputStruct0,
};

#[event]
pub struct PayPalRecipientFetched {
    pub user: Pubkey,
    pub configured: bool,
    pub recipient_type: String,
    pub receiver_hash_low: u128,
    pub receiver_hash_high: u128,
}

pub fn handler(ctx: Context<GetPaypalRecipient>, computation_offset: u64) -> Result<()> {
    let user_key = ctx.accounts.payer.key();
    let (nonce, account_key) = {
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
        (subscriptions.encrypted_state.nonce, subscriptions.key())
    };

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(nonce),
        Argument::Account(
            account_key,
            UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32,
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
        vec![GetPaypalRecipientSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<GetPaypalRecipientSublyCallback>,
    output: ComputationOutputs<GetPaypalRecipientSublyOutput>,
) -> Result<()> {
    let subscriptions = &mut ctx.accounts.user_subscriptions;
    if subscriptions.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let GetPaypalRecipientSublyOutput {
        field_0:
            GetPaypalRecipientSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: configured_flag,
                field_2: recipient_type_index,
                field_3: receiver_hash_low,
                field_4: receiver_hash_high,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    let recipient_type = PayPalRecipientType::from_index(recipient_type_index)
        .ok_or(ErrorCode::InvalidPayPalRecipientType)?;

    subscriptions.encrypted_state = EncryptedState::from(encrypted_state);

    emit!(PayPalRecipientFetched {
        user: subscriptions.owner,
        configured: configured_flag != 0,
        recipient_type: recipient_type.as_str().to_string(),
        receiver_hash_low,
        receiver_hash_high,
    });

    Ok(())
}
