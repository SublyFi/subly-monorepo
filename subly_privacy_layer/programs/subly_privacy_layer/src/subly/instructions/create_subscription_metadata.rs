use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::subly::error::ErrorCode;
use crate::subly::state::{ConfidentialBundle, UserSubscriptions};
use crate::{SignerAccount, COMP_DEF_OFFSET_CREATE_SUBSCRIPTION_METADATA, ID, ID_CONST};

#[init_computation_definition_accounts("create_subscription_metadata", payer)]
#[derive(Accounts)]
pub struct InitCreateSubscriptionMetadataCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: comp_def_account, checked by arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("create_subscription_metadata", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CreateSubscriptionMetadata<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(
        mut,
        seeds = [b"user_subscriptions", payer.key().as_ref()],
        bump,
    )]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(
        mut,
        address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: checked by arcium macros
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    /// CHECK: checked by arcium macros
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(
            computation_offset,
            mxe_account,
            ErrorCode::ClusterNotSet
        )
    )]
    /// CHECK: checked by arcium macros
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CREATE_SUBSCRIPTION_METADATA))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(
        mut,
        address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS,
    )]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("create_subscription_metadata")]
#[derive(Accounts)]
pub struct CreateSubscriptionMetadataCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CREATE_SUBSCRIPTION_METADATA))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet)
    )]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut)]
    /// CHECK: computation account validated through BLS verification
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

pub fn handler(
    ctx: Context<CreateSubscriptionMetadata>,
    computation_offset: u64,
    started_at: u64,
    next_billing_ts: u64,
) -> Result<()> {
    msg!(
        "CreateSubscriptionMetadata: start with started_at={} next_billing_ts={}",
        started_at,
        next_billing_ts
    );

    let args = ArgBuilder::new()
        .plaintext_u64(started_at)
        .plaintext_u64(next_billing_ts)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![CreateSubscriptionMetadataCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[CallbackAccount {
                pubkey: ctx.accounts.user_subscriptions.key(),
                is_writable: true,
            }],
        )?],
        1,
        0,
    )?;

    msg!("CreateSubscriptionMetadata: queued computation");
    Ok(())
}

pub fn handle_callback(
    ctx: Context<CreateSubscriptionMetadataCallback>,
    output: SignedComputationOutputs<CreateSubscriptionMetadataOutput>,
) -> Result<()> {
    msg!("CreateSubscriptionMetadata callback: START");

    let metadata_enc = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(CreateSubscriptionMetadataOutput { field_0 }) => field_0,
        Err(err) => {
            msg!(
                "CreateSubscriptionMetadata callback verification failed {}",
                err
            );
            return Err(ErrorCode::AbortedComputation.into());
        }
    };

    msg!(
        "CreateSubscriptionMetadata callback: received ciphertexts={}",
        metadata_enc.ciphertexts.len()
    );

    // SubscriptionMetadata has 4 fields: started_at, last_payment_ts, next_billing_ts, status (all i64/u8)
    // Should have at least 4 ciphertexts
    require!(
        metadata_enc.ciphertexts.len() >= 4,
        ErrorCode::InvalidEncryptedPayload
    );

    // MXE encrypted data doesn't have encryption_key, only nonce
    // We'll store it with a zero key since only MXE can decrypt anyway
    let metadata_bundle = ConfidentialBundle::from_slice(
        &metadata_enc.ciphertexts[..4],
        metadata_enc.nonce.to_le_bytes(),
        [0u8; 32], // MXE-only encryption, no shared key
    )?;

    // Update the last subscription's encrypted_metadata
    let subscription_index = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .len()
        .checked_sub(1)
        .ok_or(ErrorCode::InvalidSubscriptionAccount)?;

    ctx.accounts.user_subscriptions.subscriptions[subscription_index].encrypted_metadata =
        metadata_bundle;

    msg!(
        "CreateSubscriptionMetadata callback: updated subscription {} with encrypted metadata",
        subscription_index
    );

    Ok(())
}
