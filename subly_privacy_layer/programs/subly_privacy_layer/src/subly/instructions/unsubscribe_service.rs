use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::subly::constants::USER_SUBSCRIPTIONS_SEED;
use crate::subly::error::ErrorCode;
use crate::subly::instructions::subscribe_service::EncryptedPayloadEvent;
use crate::subly::state::{ConfidentialBundle, UserSubscriptions};
use crate::{SignerAccount, COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE, ID, ID_CONST};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UnsubscribeServiceArgs {
    pub subscription_id: u64,
    pub encryption_pubkey: [u8; 32],
    pub nonce: [u8; 16],
    pub active_commitment_ciphertext: [u8; 32],
    pub pending_commitment_ciphertext: [u8; 32],
}

#[event]
pub struct SubscriptionCancellationRequested {
    pub user: Pubkey,
    pub subscription_id: u64,
    pub encrypted_subscription: EncryptedPayloadEvent,
    // pending_until_ts removed - now encrypted in metadata
}

#[init_computation_definition_accounts("unsubscribe_service", user)]
#[derive(Accounts)]
pub struct InitUnsubscribeServiceCompDef<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
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

#[derive(Accounts)]
#[queue_computation_accounts("unsubscribe_service", user)]
#[instruction(computation_offset: u64)]
pub struct UnsubscribeService<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Box<Account<'info, UserSubscriptions>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE))]
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

#[callback_accounts("unsubscribe_service")]
#[derive(Accounts)]
pub struct UnsubscribeServiceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE))]
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
    ctx: Context<UnsubscribeService>,
    computation_offset: u64,
    args: UnsubscribeServiceArgs,
) -> Result<()> {
    let user_key = ctx.accounts.user.key();

    let stored_bump = ctx.accounts.user_subscriptions.bump;
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, stored_bump);

    let subscription = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .iter()
        .find(|subscription| subscription.id == args.subscription_id)
        .cloned()
        .ok_or(ErrorCode::SubscriptionNotFound)?;

    require!(
        subscription.encrypted_data.ciphertext_count >= 2,
        ErrorCode::InvalidEncryptedPayload
    );

    let expected_key = subscription.encrypted_data.encryption_key;
    let expected_nonce = subscription.encrypted_data.nonce;
    require!(
        expected_key == args.encryption_pubkey && expected_nonce == args.nonce,
        ErrorCode::CommitmentCiphertextMismatch
    );

    let active_commitment = &ctx.accounts.user_subscriptions.encrypted_active_commitment;
    require!(
        active_commitment.ciphertext_count == 1,
        ErrorCode::InvalidCommitmentState
    );
    require!(
        active_commitment.encryption_key == expected_key
            && active_commitment.nonce == expected_nonce
            && active_commitment.ciphertexts[0] == args.active_commitment_ciphertext,
        ErrorCode::CommitmentCiphertextMismatch
    );

    let pending_commitment = &mut ctx.accounts.user_subscriptions.encrypted_pending_commitment;
    if pending_commitment.ciphertext_count == 0 {
        *pending_commitment = ConfidentialBundle::from_slice(
            &[args.pending_commitment_ciphertext],
            expected_nonce,
            expected_key,
        )?;
    } else {
        require!(
            pending_commitment.ciphertext_count == 1,
            ErrorCode::InvalidCommitmentState
        );
        require!(
            pending_commitment.encryption_key == expected_key
                && pending_commitment.nonce == expected_nonce
                && pending_commitment.ciphertexts[0] == args.pending_commitment_ciphertext,
            ErrorCode::CommitmentCiphertextMismatch
        );
    }

    let nonce_u128 = u128::from_le_bytes(expected_nonce);
    let computation_args = ArgBuilder::new()
        .x25519_pubkey(expected_key)
        .plaintext_u128(nonce_u128)
        .encrypted_u64(active_commitment.ciphertexts[0])
        .x25519_pubkey(expected_key)
        .plaintext_u128(nonce_u128)
        .encrypted_u64(pending_commitment.ciphertexts[0])
        .x25519_pubkey(expected_key)
        .plaintext_u128(nonce_u128)
        .encrypted_u64(subscription.encrypted_data.ciphertexts[0])
        .encrypted_u64(subscription.encrypted_data.ciphertexts[1])
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        computation_args,
        None,
        vec![UnsubscribeServiceCallback::callback_ix(
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

    emit!(SubscriptionCancellationRequested {
        user: user_key,
        subscription_id: args.subscription_id,
        encrypted_subscription: EncryptedPayloadEvent {
            ciphertexts: subscription.encrypted_data.as_vec(),
            nonce: subscription.encrypted_data.nonce,
            encryption_key: subscription.encrypted_data.encryption_key,
        },
    });

    Ok(())
}

pub fn handle_callback(
    ctx: Context<UnsubscribeServiceCallback>,
    output: SignedComputationOutputs<UnsubscribeServiceOutput>,
) -> Result<()> {
    let (updated_active, updated_pending, transition_valid) = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(UnsubscribeServiceOutput {
            field_0:
                UnsubscribeServiceOutputStruct0 {
                    field_0,
                    field_1,
                    field_2,
                },
        }) => (field_0, field_1, field_2),
        Err(err) => {
            msg!("UnsubscribeService callback verification failed {}", err);
            return Err(ErrorCode::AbortedComputation.into());
        }
    };

    require!(transition_valid, ErrorCode::InvalidCommitmentState);
    require!(
        updated_active.ciphertexts.len() >= 1 && updated_pending.ciphertexts.len() >= 1,
        ErrorCode::InvalidEncryptedPayload
    );

    let active_bundle = ConfidentialBundle::from_slice(
        &updated_active.ciphertexts[..1],
        updated_active.nonce.to_le_bytes(),
        updated_active.encryption_key,
    )?;
    let pending_bundle = ConfidentialBundle::from_slice(
        &updated_pending.ciphertexts[..1],
        updated_pending.nonce.to_le_bytes(),
        updated_pending.encryption_key,
    )?;

    ctx.accounts.user_subscriptions.encrypted_active_commitment = active_bundle;
    ctx.accounts.user_subscriptions.encrypted_pending_commitment = pending_bundle;

    Ok(())
}
