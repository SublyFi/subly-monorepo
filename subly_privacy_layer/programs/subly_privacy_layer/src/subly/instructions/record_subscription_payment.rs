use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::subly::constants::{BILLING_PERIOD_SECONDS, CONFIG_SEED, USER_SUBSCRIPTIONS_SEED};
use crate::subly::error::ErrorCode;
use crate::subly::state::{ConfidentialBundle, SublyConfig, UserSubscriptions};
use crate::{SignerAccount, COMP_DEF_OFFSET_PROCESS_SUBSCRIPTION_PAYMENT};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecordSubscriptionPaymentArgs {
    pub subscription_id: u64,
    pub payment_ts: Option<i64>,
}

#[event]
pub struct SubscriptionPaymentRecorded {
    pub operator: Pubkey,
    pub user: Pubkey,
    pub paid_ts: i64,
    pub amount_usdc: u64,
}

#[init_computation_definition_accounts("process_subscription_payment", operator)]
#[derive(Accounts)]
pub struct InitProcessSubscriptionPaymentCompDef<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
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

#[queue_computation_accounts("process_subscription_payment", operator)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RecordSubscriptionPayment<'info> {
    #[account(
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
    #[account(mut)]
    pub operator: Signer<'info>,
    /// CHECK: used only for PDA seed validation
    pub user: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Box<Account<'info, UserSubscriptions>>,
    #[account(
        init_if_needed,
        space = 9,
        payer = operator,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_SUBSCRIPTION_PAYMENT))]
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

#[callback_accounts("process_subscription_payment")]
#[derive(Accounts)]
pub struct ProcessSubscriptionPaymentCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_PROCESS_SUBSCRIPTION_PAYMENT))]
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
    #[account(
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, SublyConfig>,
}

pub fn handler(
    ctx: Context<RecordSubscriptionPayment>,
    computation_offset: u64,
    args: RecordSubscriptionPaymentArgs,
) -> Result<()> {
    let clock = Clock::get()?;
    let paid_ts = args.payment_ts.unwrap_or(clock.unix_timestamp);

    require_keys_eq!(
        ctx.accounts.config.authority,
        ctx.accounts.operator.key(),
        ErrorCode::UnauthorizedAuthority
    );
    ctx.accounts.config.ensure_active()?;

    let user_key = ctx.accounts.user.key();
    let user_bump = ctx.accounts.user_subscriptions.bump;
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, user_bump);

    require!(
        ctx.accounts.user_subscriptions.paypal_configured,
        ErrorCode::PayPalInfoMissing
    );

    let subscription = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .iter()
        .find(|s| s.id == args.subscription_id)
        .cloned()
        .ok_or(ErrorCode::SubscriptionNotFound)?;

    require!(
        subscription.encrypted_data.ciphertext_count >= 2,
        ErrorCode::InvalidEncryptedPayload
    );
    require!(
        subscription.encrypted_metadata.ciphertext_count >= 4,
        ErrorCode::SubscriptionNotPayable
    );

    let paid_ts_u64: u64 = paid_ts
        .try_into()
        .map_err(|_| ErrorCode::SubscriptionNotPayable)?;
    let billing_period_seconds: u64 = BILLING_PERIOD_SECONDS
        .try_into()
        .map_err(|_| ErrorCode::MathOverflow)?;

    let sub_nonce = u128::from_le_bytes(subscription.encrypted_data.nonce);
    let meta_nonce = u128::from_le_bytes(subscription.encrypted_metadata.nonce);

    let computation_args = ArgBuilder::new()
        .plaintext_u64(args.subscription_id)
        .x25519_pubkey(subscription.encrypted_data.encryption_key)
        .plaintext_u128(sub_nonce)
        .encrypted_u64(subscription.encrypted_data.ciphertexts[0])
        .encrypted_u64(subscription.encrypted_data.ciphertexts[1])
        .plaintext_u128(meta_nonce)
        .encrypted_u64(subscription.encrypted_metadata.ciphertexts[0])
        .encrypted_u64(subscription.encrypted_metadata.ciphertexts[1])
        .encrypted_u64(subscription.encrypted_metadata.ciphertexts[2])
        .encrypted_u64(subscription.encrypted_metadata.ciphertexts[3])
        .plaintext_u64(paid_ts_u64)
        .plaintext_u64(billing_period_seconds)
        .build();

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        computation_args,
        None,
        vec![ProcessSubscriptionPaymentCallback::callback_ix(
            computation_offset,
            &ctx.accounts.mxe_account,
            &[
                CallbackAccount {
                    pubkey: ctx.accounts.user_subscriptions.key(),
                    is_writable: true,
                },
                CallbackAccount {
                    pubkey: ctx.accounts.config.key(),
                    is_writable: false,
                },
            ],
        )?],
        1,
        0,
    )?;

    Ok(())
}

pub fn handle_callback(
    ctx: Context<ProcessSubscriptionPaymentCallback>,
    output: SignedComputationOutputs<ProcessSubscriptionPaymentOutput>,
) -> Result<()> {
    let (metadata_enc, is_due, amount, subscription_id, payment_ts) = match output.verify_output(
        &ctx.accounts.cluster_account,
        &ctx.accounts.computation_account,
    ) {
        Ok(ProcessSubscriptionPaymentOutput {
            field_0:
                ProcessSubscriptionPaymentOutputStruct0 {
                    field_0,
                    field_1,
                    field_2,
                    field_3,
                    field_4,
                },
        }) => (field_0, field_1, field_2, field_3, field_4),
        Err(err) => {
            msg!(
                "RecordSubscriptionPayment callback verification failed {}",
                err
            );
            return Err(ErrorCode::AbortedComputation.into());
        }
    };

    require!(
        metadata_enc.ciphertexts.len() >= 4,
        ErrorCode::InvalidEncryptedPayload
    );

    let metadata_bundle = ConfidentialBundle::from_slice(
        &metadata_enc.ciphertexts[..4],
        metadata_enc.nonce.to_le_bytes(),
        [0u8; 32],
    )?;

    let subscription = ctx
        .accounts
        .user_subscriptions
        .subscriptions
        .iter_mut()
        .find(|s| s.id == subscription_id)
        .ok_or(ErrorCode::SubscriptionNotFound)?;

    subscription.encrypted_metadata = metadata_bundle;

    if is_due {
        let paid_ts_i64: i64 = payment_ts.try_into().map_err(|_| ErrorCode::MathOverflow)?;

        emit!(SubscriptionPaymentRecorded {
            operator: ctx.accounts.config.authority,
            user: ctx.accounts.user_subscriptions.owner,
            paid_ts: paid_ts_i64,
            amount_usdc: amount,
        });
    }

    Ok(())
}
