use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::subly::{
    error::ErrorCode,
    state::{EncryptedState, SublyConfig, SubscriptionRegistry},
};
use crate::{
    Initialize, InitializeSublyCallback, InitializeSublyOutput,
    InitializeSublyOutputStruct0,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeArgs {
    pub authority: Pubkey,
}

pub fn handler(
    ctx: Context<Initialize>,
    computation_offset: u64,
    args: InitializeArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let clock_ts: u64 = clock
        .unix_timestamp
        .try_into()
        .map_err(|_| ErrorCode::ClockOverflow)?;

    let config = &mut ctx.accounts.config;
    config.authority = args.authority;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.vault = ctx.accounts.vault.key();
    config.encrypted_state = SublyConfig::blank_state();
    config.pending_initialize_offset = Some(computation_offset);
    config.pending_config_offset = None;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.vault_bump = ctx.bumps.vault;

    let registry = &mut ctx.accounts.subscription_registry;
    registry.encrypted_registry = SubscriptionRegistry::blank_state();
    registry.bump = ctx.bumps.subscription_registry;

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    let args = vec![Argument::PlaintextU64(clock_ts)];
    let callback_accounts = vec![
        CallbackAccount {
            pubkey: ctx.accounts.config.key(),
            is_writable: true,
        },
        CallbackAccount {
            pubkey: ctx.accounts.subscription_registry.key(),
            is_writable: true,
        },
    ];
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![InitializeSublyCallback::callback_ix(&callback_accounts)],
    )?;
    Ok(())
}

pub fn callback(
    ctx: Context<InitializeSublyCallback>,
    output: ComputationOutputs<InitializeSublyOutput>,
) -> Result<()> {
    let InitializeSublyOutput {
        field_0:
            InitializeSublyOutputStruct0 {
                field_0: config_cipher,
                field_1: registry_cipher,
            },
    } = match output {
        ComputationOutputs::Success(payload) => payload,
        ComputationOutputs::Failure => return Err(ErrorCode::AbortedComputation.into()),
    };

    let subly_config = &mut ctx.accounts.config;
    if subly_config.pending_initialize_offset.take().is_none() {
        return Err(ErrorCode::PendingComputationMismatch.into());
    }
    subly_config.encrypted_state = EncryptedState::from(config_cipher);
    subly_config.paused = false;
    subly_config.pending_config_offset = None;

    let subscription_registry = &mut ctx.accounts.subscription_registry;
    subscription_registry.encrypted_registry = EncryptedState::from(registry_cipher);

    Ok(())
}
