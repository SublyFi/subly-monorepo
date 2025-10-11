use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use arcium_anchor::prelude::*;

pub mod subly;

pub use subly::error::ErrorCode;
pub use subly::instructions::initialize::InitializeArgs;
use subly::instructions::initialize::{
    callback as initialize_callback_handler, handler as initialize_handler,
};
pub use subly::instructions::register_paypal_recipient::RegisterPayPalRecipientArgs;
use subly::instructions::register_paypal_recipient::{
    callback as register_paypal_recipient_callback_handler,
    handler as register_paypal_recipient_handler,
};
pub use subly::instructions::register_subscription_service::RegisterSubscriptionServiceArgs;
use subly::instructions::register_subscription_service::{
    callback as register_subscription_service_callback_handler,
    handler as register_subscription_service_handler,
};
pub use subly::instructions::stake::StakeArgs;
use subly::instructions::stake::{callback as stake_callback_handler, handler as stake_handler};
pub use subly::instructions::subscribe_service::SubscribeServiceArgs;
use subly::instructions::subscribe_service::{
    callback as subscribe_service_callback_handler, handler as subscribe_service_handler,
};
use subly::instructions::sync_yield::{
    callback as sync_yield_callback_handler, handler as sync_yield_handler,
};
pub use subly::instructions::unstake::UnstakeArgs;
use subly::instructions::unstake::{
    callback as unstake_callback_handler, handler as unstake_handler,
};
pub use subly::instructions::unsubscribe_service::UnsubscribeServiceArgs;
use subly::instructions::unsubscribe_service::{
    callback as unsubscribe_service_callback_handler, handler as unsubscribe_service_handler,
};

pub const COMP_DEF_OFFSET_INITIALIZE_SUBLY: u32 = comp_def_offset("initialize_subly");
pub const COMP_DEF_OFFSET_REGISTER_PAYPAL_RECIPIENT_SUBLY: u32 =
    comp_def_offset("register_paypal_recipient_subly");
pub const COMP_DEF_OFFSET_REGISTER_SUBSCRIPTION_SERVICE_SUBLY: u32 =
    comp_def_offset("register_subscription_service_subly");
pub const COMP_DEF_OFFSET_SUBSCRIBE_SERVICE_SUBLY: u32 = comp_def_offset("subscribe_service_subly");
pub const COMP_DEF_OFFSET_SYNC_YIELD_SUBLY: u32 = comp_def_offset("sync_yield_subly");
pub const COMP_DEF_OFFSET_STAKE_SUBLY: u32 = comp_def_offset("stake_subly");
pub const COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE_SUBLY: u32 =
    comp_def_offset("unsubscribe_service_subly");
pub const COMP_DEF_OFFSET_UNSTAKE_SUBLY: u32 = comp_def_offset("unstake_subly");

declare_id!("EmWktRzQQNanVhAjpHod1UGVkKqJhpJVKxy5V1sc8gFw");

#[arcium_program]
pub mod subly_arcium {
    use super::*;

    pub fn init_initialize_subly_comp_def(ctx: Context<InitInitializeCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn initialize(
        ctx: Context<Initialize>,
        computation_offset: u64,
        args: InitializeArgs,
    ) -> Result<()> {
        initialize_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "initialize_subly")]
    pub fn initialize_subly_callback(
        ctx: Context<InitializeSublyCallback>,
        output: ComputationOutputs<InitializeSublyOutput>,
    ) -> Result<()> {
        initialize_callback_handler(ctx, output)
    }

    pub fn init_register_paypal_recipient_subly_comp_def(
        ctx: Context<InitRegisterPaypalCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn register_paypal_recipient(
        ctx: Context<RegisterPaypalRecipient>,
        computation_offset: u64,
        args: RegisterPayPalRecipientArgs,
    ) -> Result<()> {
        register_paypal_recipient_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "register_paypal_recipient_subly")]
    pub fn register_paypal_recipient_subly_callback(
        ctx: Context<RegisterPaypalRecipientSublyCallback>,
        output: ComputationOutputs<crate::RegisterPaypalRecipientSublyOutput>,
    ) -> Result<()> {
        register_paypal_recipient_callback_handler(ctx, output)
    }

    pub fn init_register_subscription_service_subly_comp_def(
        ctx: Context<InitRegisterSubscriptionServiceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn register_subscription_service(
        ctx: Context<RegisterSubscriptionService>,
        computation_offset: u64,
        args: RegisterSubscriptionServiceArgs,
    ) -> Result<()> {
        register_subscription_service_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "register_subscription_service_subly")]
    pub fn register_subscription_service_subly_callback(
        ctx: Context<RegisterSubscriptionServiceSublyCallback>,
        output: ComputationOutputs<crate::RegisterSubscriptionServiceSublyOutput>,
    ) -> Result<()> {
        register_subscription_service_callback_handler(ctx, output)
    }

    pub fn init_subscribe_service_subly_comp_def(
        ctx: Context<InitSubscribeServiceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn subscribe_service(
        ctx: Context<SubscribeService>,
        computation_offset: u64,
        args: SubscribeServiceArgs,
    ) -> Result<()> {
        subscribe_service_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "subscribe_service_subly")]
    pub fn subscribe_service_subly_callback(
        ctx: Context<SubscribeServiceSublyCallback>,
        output: ComputationOutputs<crate::SubscribeServiceSublyOutput>,
    ) -> Result<()> {
        subscribe_service_callback_handler(ctx, output)
    }

    pub fn init_stake_subly_comp_def(ctx: Context<InitStakeCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn stake(ctx: Context<Stake>, computation_offset: u64, args: StakeArgs) -> Result<()> {
        stake_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "stake_subly")]
    pub fn stake_subly_callback(
        ctx: Context<StakeSublyCallback>,
        output: ComputationOutputs<crate::StakeSublyOutput>,
    ) -> Result<()> {
        stake_callback_handler(ctx, output)
    }

    pub fn init_sync_yield_subly_comp_def(ctx: Context<InitSyncYieldCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn sync_yield(ctx: Context<SyncYield>, computation_offset: u64) -> Result<()> {
        sync_yield_handler(ctx, computation_offset)
    }

    #[arcium_callback(encrypted_ix = "sync_yield_subly")]
    pub fn sync_yield_subly_callback(
        ctx: Context<SyncYieldSublyCallback>,
        output: ComputationOutputs<crate::SyncYieldSublyOutput>,
    ) -> Result<()> {
        sync_yield_callback_handler(ctx, output)
    }

    pub fn init_unsubscribe_service_subly_comp_def(
        ctx: Context<InitUnsubscribeServiceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn unsubscribe_service(
        ctx: Context<UnsubscribeService>,
        computation_offset: u64,
        args: UnsubscribeServiceArgs,
    ) -> Result<()> {
        unsubscribe_service_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "unsubscribe_service_subly")]
    pub fn unsubscribe_service_subly_callback(
        ctx: Context<UnsubscribeServiceSublyCallback>,
        output: ComputationOutputs<crate::UnsubscribeServiceSublyOutput>,
    ) -> Result<()> {
        unsubscribe_service_callback_handler(ctx, output)
    }

    pub fn init_unstake_subly_comp_def(ctx: Context<InitUnstakeCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn unstake(
        ctx: Context<Unstake>,
        computation_offset: u64,
        args: UnstakeArgs,
    ) -> Result<()> {
        unstake_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "unstake_subly")]
    pub fn unstake_subly_callback(
        ctx: Context<UnstakeSublyCallback>,
        output: ComputationOutputs<crate::UnstakeSublyOutput>,
    ) -> Result<()> {
        unstake_callback_handler(ctx, output)
    }
}

#[queue_computation_accounts("initialize_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        space = subly::state::SublyConfig::LEN,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump,
    )]
    pub config: Box<Account<'info, subly::state::SublyConfig>>,
    #[account(
        init,
        payer = payer,
        seeds = [subly::constants::VAULT_SEED.as_bytes()],
        bump,
        token::mint = usdc_mint,
        token::authority = config,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        space = subly::state::SubscriptionRegistry::LEN,
        seeds = [subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump,
    )]
    pub subscription_registry: Box<Account<'info, subly::state::SubscriptionRegistry>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INITIALIZE_SUBLY))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("initialize_subly")]
#[derive(Accounts)]
pub struct InitializeSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INITIALIZE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: Provided by the runtime, validated by the account constraint.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(
        mut,
        seeds = [subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, subly::state::SubscriptionRegistry>,
}

impl<'info> Discriminator for InitializeSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SUBLINIT";
}

#[init_computation_definition_accounts("initialize_subly", payer)]
#[derive(Accounts)]
pub struct InitInitializeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("register_paypal_recipient_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RegisterPaypalRecipient<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = subly::state::UserSubscriptionsAccount::LEN,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            payer.key().as_ref()
        ],
        bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(
        COMP_DEF_OFFSET_REGISTER_PAYPAL_RECIPIENT_SUBLY
    ))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("register_paypal_recipient_subly")]
#[derive(Accounts)]
pub struct RegisterPaypalRecipientSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(
        COMP_DEF_OFFSET_REGISTER_PAYPAL_RECIPIENT_SUBLY
    ))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            user_subscriptions.owner.as_ref()
        ],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
}

impl<'info> Discriminator for RegisterPaypalRecipientSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"PAYPACB";
}

#[init_computation_definition_accounts("register_paypal_recipient_subly", payer)]
#[derive(Accounts)]
pub struct InitRegisterPaypalCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("register_subscription_service_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct RegisterSubscriptionService<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, subly::state::SubscriptionRegistry>,
    #[account(
        init,
        payer = payer,
        space = subly::state::SubscriptionServiceAccount::LEN,
        seeds = [
            subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes(),
            &subscription_registry.next_service_id.to_le_bytes()
        ],
        bump,
    )]
    pub subscription_service: Account<'info, subly::state::SubscriptionServiceAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(
        COMP_DEF_OFFSET_REGISTER_SUBSCRIPTION_SERVICE_SUBLY
    ))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("register_subscription_service_subly")]
#[derive(Accounts)]
pub struct RegisterSubscriptionServiceSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(
        COMP_DEF_OFFSET_REGISTER_SUBSCRIPTION_SERVICE_SUBLY
    ))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, subly::state::SubscriptionRegistry>,
    #[account(
        mut,
        seeds = [
            subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes(),
            &subscription_service.id.to_le_bytes()
        ],
        bump = subscription_service.bump,
    )]
    pub subscription_service: Account<'info, subly::state::SubscriptionServiceAccount>,
}

impl<'info> Discriminator for RegisterSubscriptionServiceSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SRVREGCB";
}

#[init_computation_definition_accounts("register_subscription_service_subly", payer)]
#[derive(Accounts)]
pub struct InitRegisterSubscriptionServiceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("subscribe_service_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SubscribeService<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(
        mut,
        seeds = [subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes()],
        bump = subscription_registry.bump,
    )]
    pub subscription_registry: Account<'info, subly::state::SubscriptionRegistry>,
    #[account(
        seeds = [
            subly::constants::SUBSCRIPTION_REGISTRY_SEED.as_bytes(),
            &subscription_service.id.to_le_bytes()
        ],
        bump = subscription_service.bump,
    )]
    pub subscription_service: Account<'info, subly::state::SubscriptionServiceAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = subly::state::UserStakeAccount::LEN,
        seeds = [subly::constants::USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        init_if_needed,
        payer = user,
        space = subly::state::UserSubscriptionsAccount::LEN,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            user.key().as_ref()
        ],
        bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBSCRIBE_SERVICE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("subscribe_service_subly")]
#[derive(Accounts)]
pub struct SubscribeServiceSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBSCRIBE_SERVICE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_POSITION_SEED.as_bytes(),
            user_stake.owner.as_ref()
        ],
        bump = user_stake.bump,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            user_subscriptions.owner.as_ref()
        ],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
}

impl<'info> Discriminator for SubscribeServiceSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SUBSUBCB";
}

#[init_computation_definition_accounts("subscribe_service_subly", payer)]
#[derive(Accounts)]
pub struct InitSubscribeServiceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("unsubscribe_service_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct UnsubscribeService<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            user.key().as_ref()
        ],
        bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("unsubscribe_service_subly")]
#[derive(Accounts)]
pub struct UnsubscribeServiceSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSUBSCRIBE_SERVICE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_SUBSCRIPTIONS_SEED.as_bytes(),
            user_subscriptions.owner.as_ref()
        ],
        bump = user_subscriptions.bump,
    )]
    pub user_subscriptions: Account<'info, subly::state::UserSubscriptionsAccount>,
}

impl<'info> Discriminator for UnsubscribeServiceSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SUBUNSCB";
}

#[init_computation_definition_accounts("unsubscribe_service_subly", payer)]
#[derive(Accounts)]
pub struct InitUnsubscribeServiceCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("sync_yield_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct SyncYield<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_POSITION_SEED.as_bytes(),
            user.key().as_ref()
        ],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::InvalidPositionOwner,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 9,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SYNC_YIELD_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("sync_yield_subly")]
#[derive(Accounts)]
pub struct SyncYieldSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SYNC_YIELD_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address.
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(
        mut,
        seeds = [
            subly::constants::USER_POSITION_SEED.as_bytes(),
            user_stake.owner.as_ref()
        ],
        bump = user_stake.bump,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
}

impl<'info> Discriminator for SyncYieldSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SNYLDSNP";
}

#[init_computation_definition_accounts("sync_yield_subly", payer)]
#[derive(Accounts)]
pub struct InitSyncYieldCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program.
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("stake_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Stake<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = subly::state::UserStakeAccount::LEN,
        seeds = [subly::constants::USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [subly::constants::VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STAKE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("stake_subly")]
#[derive(Accounts)]
pub struct StakeSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_STAKE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(mut)]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
}

impl<'info> Discriminator for StakeSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SUBSTKCB";
}

#[init_computation_definition_accounts("stake_subly", payer)]
#[derive(Accounts)]
pub struct InitStakeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

#[queue_computation_accounts("unstake_subly", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [subly::constants::USER_POSITION_SEED.as_bytes(), user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::InvalidPositionOwner,
    )]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        mut,
        seeds = [subly::constants::VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: Verified by the Arcium program
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: Verified by the Arcium program
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: Verified by the Arcium program
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSTAKE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub arcium_program: Program<'info, Arcium>,
}

#[callback_accounts("unstake_subly")]
#[derive(Accounts)]
pub struct UnstakeSublyCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UNSTAKE_SUBLY))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instruction sysvar verified by address
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [subly::constants::CONFIG_SEED.as_bytes()],
        bump = config.bump,
    )]
    pub config: Account<'info, subly::state::SublyConfig>,
    #[account(mut)]
    pub user_stake: Account<'info, subly::state::UserStakeAccount>,
    #[account(
        mut,
        seeds = [subly::constants::VAULT_SEED.as_bytes()],
        bump = config.vault_bump,
        constraint = vault.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_token_account.owner == user_stake.owner @ ErrorCode::InvalidTokenOwner,
        constraint = user_token_account.mint == config.usdc_mint @ ErrorCode::InvalidMint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> Discriminator for UnstakeSublyCallback<'info> {
    const DISCRIMINATOR: &'static [u8] = b"SUBUNSTK";
}

#[init_computation_definition_accounts("unstake_subly", payer)]
#[derive(Accounts)]
pub struct InitUnstakeCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut)]
    /// CHECK: Initialized by the Arcium program
    pub comp_def_account: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}
