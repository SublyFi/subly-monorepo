use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer as SystemTransfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::{SignerAccount, ID, ID_CONST};

use crate::subly::constants::{
    BASIS_POINTS_DIVISOR, BILLING_PERIOD_SECONDS, CONFIG_SEED, USER_POSITION_SEED,
    USER_SUBSCRIPTIONS_SEED,
};
use crate::subly::error::ErrorCode;
use crate::subly::state::{
    ConfidentialBundle, SublyConfig, UserStake, UserSubscriptions, MAX_CONFIDENTIAL_CIPHERTEXTS,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscribeServiceArgs {
    // Single encryption key and nonce for all encrypted data
    pub encryption_pubkey: [u8; 32],
    pub nonce: [u8; 16],
    // Encrypted fields
    pub total_ciphertext: [u8; 32],
    pub subscription_service_id_ciphertext: [u8; 32],
    pub subscription_monthly_price_ciphertext: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EncryptedPayloadEvent {
    pub ciphertexts: Vec<[u8; 32]>,
    pub nonce: [u8; 16],
    pub encryption_key: [u8; 32],
}

#[event]
pub struct SubscriptionActivated {
    pub user: Pubkey,
    pub encrypted_subscription: EncryptedPayloadEvent,
    pub encrypted_total_commitment: EncryptedPayloadEvent,
}

#[queue_computation_accounts("subscribe_service", user)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubscribeService<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, SublyConfig>>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump = user_position.bump,
    )]
    pub user_position: Box<Account<'info, UserStake>>,
    #[account(
        mut,
        seeds = [USER_SUBSCRIPTIONS_SEED.as_bytes(), user.key().as_ref()],
        bump,
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
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_SUBSCRIBE_SERVICE))]
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

#[callback_accounts("subscribe_service")]
#[derive(Accounts)]
pub struct SubscribeServiceCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(crate::COMP_DEF_OFFSET_SUBSCRIBE_SERVICE))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub user_subscriptions: Account<'info, UserSubscriptions>,
}

#[init_computation_definition_accounts("subscribe_service", user)]
#[derive(Accounts)]
pub struct InitSubscribeServiceCompDef<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        address = derive_mxe_pda!()
    )]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: to be initialized by the arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubscribeService>,
    computation_offset: u64,
    args: SubscribeServiceArgs,
) -> Result<()> {
    msg!("SubscribeService: begin");
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    config.ensure_active()?;
    msg!("SubscribeService: config active");

    let (expected_config, _) = Pubkey::find_program_address(&[CONFIG_SEED.as_bytes()], &crate::ID);
    require_keys_eq!(
        expected_config,
        config.key(),
        ErrorCode::InvalidSubscriptionAccount
    );
    msg!("SubscribeService: config PDA verified");

    let user_key = ctx.accounts.user.key();

    let (expected_user_position, position_bump) = Pubkey::find_program_address(
        &[USER_POSITION_SEED.as_bytes(), user_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_position,
        ctx.accounts.user_position.key(),
        ErrorCode::InvalidPositionOwner
    );
    ctx.accounts
        .user_position
        .ensure_owner(user_key, position_bump);
    msg!(
        "SubscribeService: user position verified total_principal={}",
        ctx.accounts.user_position.total_principal
    );

    let (expected_user_subscriptions, subscriptions_bump) = Pubkey::find_program_address(
        &[USER_SUBSCRIPTIONS_SEED.as_bytes(), user_key.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_user_subscriptions,
        ctx.accounts.user_subscriptions.key(),
        ErrorCode::InvalidSubscriptionAccount
    );
    ctx.accounts
        .user_subscriptions
        .ensure_owner(user_key, subscriptions_bump);
    msg!("SubscribeService: user subscriptions verified");

    // Safety check: ensure subscriptions Vec is valid before calling methods on it
    // If capacity is 0, the Vec was not properly initialized despite account existing
    if ctx.accounts.user_subscriptions.subscriptions.capacity() == 0 {
        msg!("SubscribeService: subscriptions Vec has 0 capacity, reinitializing");
        ctx.accounts.user_subscriptions.subscriptions = Vec::new();
        ctx.accounts.user_subscriptions.next_subscription_id = 1; // Start from 1, not 0
        ctx.accounts
            .user_subscriptions
            .encrypted_active_commitment
            .ciphertexts = [[0u8; 32]; MAX_CONFIDENTIAL_CIPHERTEXTS];
        ctx.accounts
            .user_subscriptions
            .encrypted_active_commitment
            .ciphertext_count = 0;
        ctx.accounts
            .user_subscriptions
            .encrypted_active_commitment
            .nonce = [0u8; 16];
        ctx.accounts
            .user_subscriptions
            .encrypted_active_commitment
            .encryption_key = [0u8; 32];

        ctx.accounts
            .user_subscriptions
            .encrypted_pending_commitment
            .ciphertexts = [[0u8; 32]; MAX_CONFIDENTIAL_CIPHERTEXTS];
        ctx.accounts
            .user_subscriptions
            .encrypted_pending_commitment
            .ciphertext_count = 0;
        ctx.accounts
            .user_subscriptions
            .encrypted_pending_commitment
            .nonce = [0u8; 16];
        ctx.accounts
            .user_subscriptions
            .encrypted_pending_commitment
            .encryption_key = [0u8; 32];
    }

    ctx.accounts.user_subscriptions.refresh(now)?;
    msg!(
        "SubscribeService: subscriptions refreshed active_count={} pending_count={} total_entries={}",
        ctx.accounts
            .user_subscriptions
            .encrypted_active_commitment
            .ciphertext_count,
        ctx.accounts
            .user_subscriptions
            .encrypted_pending_commitment
            .ciphertext_count,
        ctx.accounts.user_subscriptions.subscriptions.len()
    );
    require!(
        ctx.accounts.user_subscriptions.paypal_configured,
        ErrorCode::PayPalInfoMissing
    );
    msg!("SubscribeService: PayPal configured");

    let monthly_budget =
        compute_monthly_budget(ctx.accounts.user_position.total_principal, config.apy_bps)?;
    msg!(
        "SubscribeService: monthly budget total_principal={} apy_bps={} -> {}",
        ctx.accounts.user_position.total_principal,
        config.apy_bps,
        monthly_budget
    );
    require!(monthly_budget > 0, ErrorCode::SubscriptionBudgetExceeded);

    // Ensure account has enough space and rent to append the new subscription.
    let desired_len = ctx.accounts.user_subscriptions.subscriptions.len() + 1;
    let required_space = UserSubscriptions::required_size(
        desired_len,
        ctx.accounts.user_subscriptions.receiver_len(),
    );
    let user_subscriptions_info = ctx.accounts.user_subscriptions.to_account_info();
    if user_subscriptions_info.data_len() < required_space {
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(required_space);
        let current_lamports = user_subscriptions_info.lamports();
        if required_lamports > current_lamports {
            msg!(
                "SubscribeService: resizing subscriptions account, funding diff {}",
                required_lamports - current_lamports
            );
            let difference = required_lamports - current_lamports;
            let transfer_accounts = SystemTransfer {
                from: ctx.accounts.user.to_account_info(),
                to: user_subscriptions_info.clone(),
            };
            let cpi_program = ctx.accounts.system_program.to_account_info();
            system_program::transfer(CpiContext::new(cpi_program, transfer_accounts), difference)?;
        }
        user_subscriptions_info.resize(required_space)?;
    }
    msg!(
        "SubscribeService: account size ok len={}, required={}",
        user_subscriptions_info.data_len(),
        required_space
    );

    let nonce = u128::from_le_bytes(args.nonce);
    msg!("SubscribeService: nonce parsed nonce={}", nonce);

    let stored_commitment = &ctx.accounts.user_subscriptions.encrypted_active_commitment;
    msg!(
        "SubscribeService: existing commitment ciphertext_count={}",
        stored_commitment.ciphertext_count
    );
    if stored_commitment.ciphertext_count > 0 {
        msg!(
            "SubscribeService: validating existing commitment count={}",
            stored_commitment.ciphertext_count
        );
        require!(
            stored_commitment.ciphertext_count == 1,
            ErrorCode::InvalidCommitmentState
        );
        require!(
            stored_commitment.encryption_key == args.encryption_pubkey
                && stored_commitment.nonce == args.nonce
                && stored_commitment.ciphertexts[0] == args.total_ciphertext,
            ErrorCode::CommitmentCiphertextMismatch
        );
    }
    msg!("SubscribeService: commitment validated/set");

    // For Enc<Shared, T> types, all encrypted data must use the same encryption key and nonce
    // The circuit expects: (total: Enc<Shared, u64>, subscription: Enc<Shared, SubscriptionInfo>, budget: u64)
    // SubscriptionInfo is a struct with 2 u64 fields
    // When passing a struct, we need to pass individual encrypted fields sequentially
    let computation_args = vec![
        Argument::ArcisPubkey(args.encryption_pubkey),
        Argument::PlaintextU128(nonce),
        Argument::EncryptedU64(args.total_ciphertext),
        Argument::ArcisPubkey(args.encryption_pubkey),
        Argument::PlaintextU128(nonce),
        Argument::EncryptedU64(args.subscription_service_id_ciphertext),
        Argument::EncryptedU64(args.subscription_monthly_price_ciphertext),
        Argument::PlaintextU64(monthly_budget),
    ];
    msg!(
        "SubscribeService: arguments prepared nonce={} monthly_budget={}",
        nonce,
        monthly_budget
    );

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    msg!(
        "SubscribeService: sign_pda bump set {}",
        ctx.accounts.sign_pda_account.bump
    );

    queue_computation(
        ctx.accounts,
        computation_offset,
        computation_args,
        None,
        vec![SubscribeServiceCallback::callback_ix(&[CallbackAccount {
            pubkey: ctx.accounts.user_subscriptions.key(),
            is_writable: true,
        }])],
    )?;
    msg!("SubscribeService: queue_computation ok");

    Ok(())
}

pub fn handle_callback(
    ctx: Context<SubscribeServiceCallback>,
    output: ComputationOutputs<SubscribeServiceOutput>,
) -> Result<()> {
    msg!("SubscribeService callback: START");

    let (total_enc, subscription_enc, within_budget) = match output {
        ComputationOutputs::Success(SubscribeServiceOutput {
            field_0:
                SubscribeServiceOutputStruct0 {
                    field_0,
                    field_1,
                    field_2,
                },
        }) => (field_0, field_1, field_2),
        _ => return Err(ErrorCode::AbortedComputation.into()),
    };

    msg!(
        "SubscribeService callback: within_budget={} total_ct_len={} subscription_ct_len={}",
        within_budget,
        total_enc.ciphertexts.len(),
        subscription_enc.ciphertexts.len()
    );

    require!(within_budget, ErrorCode::SubscriptionBudgetExceeded);

    // Total should be a single u64 ciphertext
    require!(
        total_enc.ciphertexts.len() >= 1,
        ErrorCode::InvalidEncryptedPayload
    );

    // SubscriptionInfo struct has 2 fields (service_id: u64, monthly_price: u64)
    // so subscription_enc should have 2 ciphertexts
    require!(
        subscription_enc.ciphertexts.len() >= 2,
        ErrorCode::InvalidEncryptedPayload
    );

    let total_bundle = ConfidentialBundle::from_slice(
        &total_enc.ciphertexts[..1],
        total_enc.nonce.to_le_bytes(),
        total_enc.encryption_key,
    )?;
    msg!(
        "SubscribeService callback: total bundle prepared nonce={:?}",
        total_bundle.nonce
    );

    let subscription_bundle = ConfidentialBundle::from_slice(
        &subscription_enc.ciphertexts[..2],
        subscription_enc.nonce.to_le_bytes(),
        subscription_enc.encryption_key,
    )?;
    msg!(
        "SubscribeService callback: subscription bundle prepared nonce={:?}",
        subscription_bundle.nonce
    );

    let now = Clock::get()?.unix_timestamp;
    let billing_period = BILLING_PERIOD_SECONDS;

    let subscription_id = ctx.accounts.user_subscriptions.record_subscription(
        subscription_bundle.clone(),
        now,
        billing_period,
    )?;
    msg!(
        "SubscribeService callback: recorded subscription id={} total_subscriptions={}",
        subscription_id,
        ctx.accounts.user_subscriptions.subscriptions.len()
    );

    ctx.accounts.user_subscriptions.encrypted_active_commitment = total_bundle.clone();

    let user_key = ctx.accounts.user_subscriptions.owner;

    let encrypted_subscription_event = EncryptedPayloadEvent {
        ciphertexts: subscription_bundle.as_vec(),
        nonce: subscription_bundle.nonce,
        encryption_key: subscription_bundle.encryption_key,
    };
    let encrypted_total_event = EncryptedPayloadEvent {
        ciphertexts: vec![total_bundle.ciphertexts[0]],
        nonce: total_bundle.nonce,
        encryption_key: total_bundle.encryption_key,
    };
    msg!("SubscribeService callback: emitting event");

    emit!(SubscriptionActivated {
        user: user_key,
        encrypted_subscription: encrypted_subscription_event,
        encrypted_total_commitment: encrypted_total_event,
    });

    msg!(
        "SubscribeService callback: END - subscription_id={}",
        subscription_id
    );
    Ok(())
}

fn compute_monthly_budget(total_principal: u64, apy_bps: u16) -> Result<u64> {
    if total_principal == 0 || apy_bps == 0 {
        return Ok(0);
    }

    let annual_yield = (total_principal as u128)
        .checked_mul(apy_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(BASIS_POINTS_DIVISOR as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let monthly_yield = annual_yield
        .checked_div(12)
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(monthly_yield).map_err(|_| ErrorCode::MathOverflow.into())
}
