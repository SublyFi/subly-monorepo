use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::subly::error::ErrorCode;
use crate::subly::state::{ConfidentialBundle, UserSubscriptions};
use crate::{SignerAccount, COMP_DEF_OFFSET_UPDATE_SUBSCRIPTION_METADATA, ID, ID_CONST};

#[init_computation_definition_accounts("update_subscription_metadata", payer)]
#[derive(Accounts)]
pub struct InitUpdateSubscriptionMetadataCompDef<'info> {
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

#[queue_computation_accounts("update_subscription_metadata", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct UpdateSubscriptionMetadata<'info> {
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
        address = derive_mempool_pda!()
    )]
    /// CHECK: checked by arcium macros
    pub mempool_account: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_execpool_pda!()
    )]
    /// CHECK: checked by arcium macros
    pub executing_pool: UncheckedAccount<'info>,
    #[account(
        mut,
        address = derive_comp_pda!(computation_offset)
    )]
    /// CHECK: checked by arcium macros
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_SUBSCRIPTION_METADATA))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(
        mut,
        address = derive_cluster_pda!(mxe_account)
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

#[callback_accounts("update_subscription_metadata")]
#[derive(Accounts)]
pub struct UpdateSubscriptionMetadataCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_SUBSCRIPTION_METADATA))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateSubscriptionMetadataArgs {
    pub subscription_index: u64,
    // Encrypted metadata from subscription (MXE encrypted)
    pub nonce: [u8; 16],
    pub metadata_ct_0: [u8; 32],
    pub metadata_ct_1: [u8; 32],
    pub metadata_ct_2: [u8; 32],
    pub metadata_ct_3: [u8; 32],
    // New plaintext values
    pub payment_ts: u64,
    pub billing_period_seconds: u64,
}

pub fn handler(
    _ctx: Context<UpdateSubscriptionMetadata>,
    _computation_offset: u64,
    _args: UpdateSubscriptionMetadataArgs,
) -> Result<()> {
    // TODO: Implement MXE-encrypted metadata update
    // The challenge is passing Enc<Mxe, SubscriptionMetadata> as argument
    // This requires the subscription's encrypted_metadata to be passed from client
    // For now, this is a placeholder until Arcium provides guidance on
    // passing MXE-encrypted data as computation arguments
    msg!("UpdateSubscriptionMetadata: not yet implemented");
    Err(ErrorCode::AbortedComputation.into())
}

pub fn handle_callback(
    _ctx: Context<UpdateSubscriptionMetadataCallback>,
    _output: ComputationOutputs<UpdateSubscriptionMetadataOutput>,
) -> Result<()> {
    msg!("UpdateSubscriptionMetadata callback: not yet implemented");
    Err(ErrorCode::AbortedComputation.into())
}
