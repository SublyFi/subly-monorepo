use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use arcium_anchor::prelude::*;

pub mod subly;

pub use subly::error::ErrorCode;
pub use subly::instructions::initialize::InitializeArgs;
use subly::instructions::initialize::{
    callback as initialize_callback_handler, handler as initialize_handler,
};
pub use subly::instructions::stake::StakeArgs;
use subly::instructions::stake::{callback as stake_callback_handler, handler as stake_handler};
pub use subly::instructions::unstake::UnstakeArgs;
use subly::instructions::unstake::{
    callback as unstake_callback_handler, handler as unstake_handler,
};

pub const COMP_DEF_OFFSET_INITIALIZE_SUBLY: u32 = comp_def_offset("initialize_subly");
pub const COMP_DEF_OFFSET_STAKE_SUBLY: u32 = comp_def_offset("stake_subly");
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

    pub fn init_stake_subly_comp_def(ctx: Context<InitStakeCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)
    }

    pub fn stake(
        ctx: Context<Stake>,
        computation_offset: u64,
        args: StakeArgs,
    ) -> Result<()> {
        stake_handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "stake_subly")]
    pub fn stake_subly_callback(
        ctx: Context<StakeSublyCallback>,
        output: ComputationOutputs<crate::StakeSublyOutput>,
    ) -> Result<()> {
        stake_callback_handler(ctx, output)
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
