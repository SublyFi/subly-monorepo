use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{Argument, CallbackAccount};

use crate::subly::error::ErrorCode;
use crate::subly::state::{EncryptedState, SubscriptionRegistry};
use crate::{
    GetSubscriptionServices, GetSubscriptionServicesSublyCallback,
    GetSubscriptionServicesSublyOutput, GetSubscriptionServicesSublyOutputStruct0,
};

#[event]
pub struct SubscriptionServicesFetched {
    pub service_count: u32,
    pub next_service_id: u64,
    pub services_root_low: u128,
    pub services_root_high: u128,
}

pub fn handler(ctx: Context<GetSubscriptionServices>, computation_offset: u64) -> Result<()> {
    require!(
        ctx.accounts
            .subscription_registry
            .pending_computation_offset
            .is_none(),
        ErrorCode::PendingComputationInProgress
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let registry = &ctx.accounts.subscription_registry;
    let nonce = registry.encrypted_registry.nonce;
    let account_key = registry.key();

    let arguments = vec![
        Argument::PlaintextU128(nonce),
        Argument::Account(
            account_key,
            SubscriptionRegistry::ENCRYPTED_STATE_OFFSET as u32,
            SubscriptionRegistry::ENCRYPTED_STATE_LEN as u32,
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
        vec![GetSubscriptionServicesSublyCallback::callback_ix(
            &callback_accounts,
        )],
    )?;

    ctx.accounts
        .subscription_registry
        .pending_computation_offset = Some(computation_offset);

    Ok(())
}

pub fn callback(
    ctx: Context<GetSubscriptionServicesSublyCallback>,
    output: ComputationOutputs<GetSubscriptionServicesSublyOutput>,
) -> Result<()> {
    let registry = &mut ctx.accounts.subscription_registry;
    if registry.pending_computation_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }

    let GetSubscriptionServicesSublyOutput {
        field_0:
            GetSubscriptionServicesSublyOutputStruct0 {
                field_0: encrypted_state,
                field_1: service_count,
                field_2: next_service_id,
                field_3: services_root_low,
                field_4: services_root_high,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    registry.encrypted_registry = EncryptedState::from(encrypted_state);

    emit!(SubscriptionServicesFetched {
        service_count,
        next_service_id,
        services_root_low,
        services_root_high,
    });

    Ok(())
}
