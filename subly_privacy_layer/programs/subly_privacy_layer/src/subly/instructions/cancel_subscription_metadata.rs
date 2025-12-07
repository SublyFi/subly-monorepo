use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;

use crate::subly::error::ErrorCode;
use crate::subly::state::UserSubscriptions;
use crate::{SignerAccount, COMP_DEF_OFFSET_CANCEL_SUBSCRIPTION_METADATA, ID, ID_CONST};

#[init_computation_definition_accounts("cancel_subscription_metadata", payer)]
#[derive(Accounts)]
pub struct InitCancelSubscriptionMetadataCompDef<'info> {
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

#[queue_computation_accounts("cancel_subscription_metadata", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CancelSubscriptionMetadata<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CANCEL_SUBSCRIPTION_METADATA))]
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

#[callback_accounts("cancel_subscription_metadata")]
#[derive(Accounts)]
pub struct CancelSubscriptionMetadataCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_CANCEL_SUBSCRIPTION_METADATA))]
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CancelSubscriptionMetadataArgs {
    pub subscription_index: u64,
}

pub fn handler(
    _ctx: Context<CancelSubscriptionMetadata>,
    _computation_offset: u64,
    _args: CancelSubscriptionMetadataArgs,
) -> Result<()> {
    // TODO: Implement MXE-encrypted metadata cancellation
    // Similar challenge as update_subscription_metadata
    // Requires passing Enc<Mxe, SubscriptionMetadata> as argument
    msg!("CancelSubscriptionMetadata: not yet implemented");
    Err(ErrorCode::AbortedComputation.into())
}

pub fn handle_callback(
    _ctx: Context<CancelSubscriptionMetadataCallback>,
    _output: SignedComputationOutputs<CancelSubscriptionMetadataOutput>,
) -> Result<()> {
    msg!("CancelSubscriptionMetadata callback: not yet implemented");
    Err(ErrorCode::AbortedComputation.into())
}
