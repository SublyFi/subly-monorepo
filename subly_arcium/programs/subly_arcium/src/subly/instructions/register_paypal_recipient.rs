use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::constants::MAX_PAYPAL_RECEIVER_LEN;
use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, PayPalRecipientType, UserSubscriptionsAccount};
use crate::{
    RegisterPaypalRecipient, RegisterPaypalRecipientSublyCallback,
    RegisterPaypalRecipientSublyOutput, RegisterPaypalRecipientSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterPayPalRecipientArgs {
    pub recipient_type: String,
    pub receiver: String,
}

#[event]
pub struct PayPalRecipientRegistered {
    pub user: Pubkey,
    pub recipient_type: String,
    pub receiver_hash_low: u128,
    pub receiver_hash_high: u128,
}

pub fn handler(
    ctx: Context<RegisterPaypalRecipient>,
    computation_offset: u64,
    args: RegisterPayPalRecipientArgs,
) -> Result<()> {
    let recipient_type = PayPalRecipientType::from_str(&args.recipient_type)?;
    let receiver = args.receiver.trim();
    require!(!receiver.is_empty(), ErrorCode::InvalidPayPalRecipientType);
    require!(
        receiver.len() <= MAX_PAYPAL_RECEIVER_LEN,
        ErrorCode::InvalidPayPalRecipientType
    );

    let (receiver_hash_low, receiver_hash_high) = hash_to_u128_pair(receiver.as_bytes());
    let recipient_type_index = recipient_type.as_index();

    let payer = &ctx.accounts.payer;
    let user_key = payer.key();

    {
        let user_subscriptions = &mut ctx.accounts.user_subscriptions;
        user_subscriptions.ensure_owner(user_key, ctx.bumps.user_subscriptions);
        require_keys_eq!(
            user_subscriptions.owner,
            user_key,
            ErrorCode::InvalidSubscriptionAccount
        );
        require!(
            user_subscriptions.pending_computation_offset.is_none(),
            ErrorCode::PendingComputationInProgress
        );
    }

    let nonce = ctx.accounts.user_subscriptions.encrypted_state.nonce;
    let account_key = ctx.accounts.user_subscriptions.key();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let arguments = vec![
        Argument::PlaintextU128(nonce),
        Argument::Account(
            account_key,
            UserSubscriptionsAccount::ENCRYPTED_STATE_OFFSET as u32,
            UserSubscriptionsAccount::ENCRYPTED_STATE_LEN as u32,
        ),
        Argument::PlaintextU8(recipient_type_index),
        Argument::PlaintextU128(receiver_hash_low),
        Argument::PlaintextU128(receiver_hash_high),
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
        vec![RegisterPaypalRecipientSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts.user_subscriptions.pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<RegisterPaypalRecipientSublyCallback>,
    output: ComputationOutputs<RegisterPaypalRecipientSublyOutput>,
) -> Result<()> {
    let user_subscriptions = &mut ctx.accounts.user_subscriptions;
    if user_subscriptions
        .pending_computation_offset
        .take()
        .is_none()
    {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let RegisterPaypalRecipientSublyOutput {
        field_0:
            RegisterPaypalRecipientSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: recipient_type_index,
                field_2: receiver_hash_low,
                field_3: receiver_hash_high,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    let recipient_type = PayPalRecipientType::from_index(recipient_type_index)
        .ok_or(ErrorCode::InvalidPayPalRecipientType)?;

    user_subscriptions.encrypted_state = EncryptedState::from(encrypted_state);

    emit!(PayPalRecipientRegistered {
        user: user_subscriptions.owner,
        recipient_type: recipient_type.as_str().to_string(),
        receiver_hash_low,
        receiver_hash_high,
    });

    Ok(())
}

fn hash_to_u128_pair(data: &[u8]) -> (u128, u128) {
    let digest = hashv(&[data]);
    let bytes = digest.to_bytes();
    let mut low = [0u8; 16];
    let mut high = [0u8; 16];
    low.copy_from_slice(&bytes[..16]);
    high.copy_from_slice(&bytes[16..]);
    (u128::from_le_bytes(low), u128::from_le_bytes(high))
}
