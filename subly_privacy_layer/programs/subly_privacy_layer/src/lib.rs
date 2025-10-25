pub mod subly;

use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use subly::instructions::create_subscription_metadata::CreateSubscriptionMetadataOutput;
use subly::instructions::subscribe_service::SubscribeServiceOutput;

pub use subly::constants as subly_constants;
pub use subly::instructions::create_subscription_metadata::{
    CreateSubscriptionMetadata, CreateSubscriptionMetadataCallback,
    InitCreateSubscriptionMetadataCompDef,
};
pub use subly::instructions::find_due_subscriptions::{
    DueSubscriptionInfo, FindDueSubscriptions, FindDueSubscriptionsArgs, SubscriptionsDue,
};
pub use subly::instructions::initialize::{Initialize, InitializeArgs};
pub use subly::instructions::record_subscription_payment::{
    RecordSubscriptionPayment, RecordSubscriptionPaymentArgs, SubscriptionPaymentRecorded,
};
pub use subly::instructions::register_paypal_recipient::{
    PayPalRecipientRegistered, RegisterPayPalRecipient, RegisterPayPalRecipientArgs,
};
pub use subly::instructions::register_subscription_service::{
    RegisterSubscriptionService, RegisterSubscriptionServiceArgs, SubscriptionServiceRegistered,
};
pub use subly::instructions::stake::Stake;
pub use subly::instructions::subscribe_service::{
    InitSubscribeServiceCompDef, SubscribeService, SubscribeServiceArgs, SubscribeServiceCallback,
    SubscriptionActivated,
};
pub use subly::instructions::sync_yield::{SyncYield, YieldSnapshot};
pub use subly::instructions::unstake::Unstake;
pub use subly::instructions::unsubscribe_service::{
    SubscriptionCancellationRequested, UnsubscribeService, UnsubscribeServiceArgs,
};
pub use subly::state::{
    PayPalRecipientType, StakeEntry, SublyConfig, SubscriptionRegistry, SubscriptionService,
    SubscriptionStatus, UserStake, UserSubscription, UserSubscriptions,
};

pub mod __client_accounts_initialize {
    pub use crate::subly::instructions::initialize::__client_accounts_initialize::*;
}

pub mod __client_accounts_stake {
    pub use crate::subly::instructions::stake::__client_accounts_stake::*;
}

pub mod __client_accounts_unstake {
    pub use crate::subly::instructions::unstake::__client_accounts_unstake::*;
}

pub mod __client_accounts_sync_yield {
    pub use crate::subly::instructions::sync_yield::__client_accounts_sync_yield::*;
}

pub mod __client_accounts_register_subscription_service {
    pub use crate::subly::instructions::register_subscription_service::__client_accounts_register_subscription_service::*;
}

pub mod __client_accounts_subscribe_service {
    pub use crate::subly::instructions::subscribe_service::__client_accounts_subscribe_service::*;
}

pub mod __client_accounts_init_subscribe_service_comp_def {
    pub use crate::subly::instructions::subscribe_service::__client_accounts_init_subscribe_service_comp_def::*;
}

pub mod __client_accounts_subscribe_service_callback {
    pub use crate::subly::instructions::subscribe_service::__client_accounts_subscribe_service_callback::*;
}

pub mod __client_accounts_init_create_subscription_metadata_comp_def {
    pub use crate::subly::instructions::create_subscription_metadata::__client_accounts_init_create_subscription_metadata_comp_def::*;
}

pub mod __client_accounts_create_subscription_metadata {
    pub use crate::subly::instructions::create_subscription_metadata::__client_accounts_create_subscription_metadata::*;
}

pub mod __client_accounts_create_subscription_metadata_callback {
    pub use crate::subly::instructions::create_subscription_metadata::__client_accounts_create_subscription_metadata_callback::*;
}

pub mod __client_accounts_register_pay_pal_recipient {
    pub use crate::subly::instructions::register_paypal_recipient::__client_accounts_register_pay_pal_recipient::*;
}

pub mod __client_accounts_find_due_subscriptions {
    pub use crate::subly::instructions::find_due_subscriptions::__client_accounts_find_due_subscriptions::*;
}

pub mod __client_accounts_record_subscription_payment {
    pub use crate::subly::instructions::record_subscription_payment::__client_accounts_record_subscription_payment::*;
}

pub mod __client_accounts_unsubscribe_service {
    pub use crate::subly::instructions::unsubscribe_service::__client_accounts_unsubscribe_service::*;
}

const COMP_DEF_OFFSET_SUBSCRIBE_SERVICE: u32 = comp_def_offset("subscribe_service");
const COMP_DEF_OFFSET_CREATE_SUBSCRIPTION_METADATA: u32 =
    comp_def_offset("create_subscription_metadata");
const COMP_DEF_OFFSET_UPDATE_SUBSCRIPTION_METADATA: u32 =
    comp_def_offset("update_subscription_metadata");

declare_id!("HLSVfoqwhdrEpLn2XnvaywFWPM8Mi2rXvEu9vdZZNhyw");

#[arcium_program]
pub mod subly_privacy_layer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        subly::instructions::initialize::handler(ctx, args)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, lock_option: u8) -> Result<()> {
        subly::instructions::stake::handler(ctx, amount, lock_option)
    }

    pub fn unstake(ctx: Context<Unstake>, tranche_id: u64) -> Result<()> {
        subly::instructions::unstake::handler(ctx, tranche_id)
    }

    pub fn sync_yield(ctx: Context<SyncYield>) -> Result<()> {
        subly::instructions::sync_yield::handler(ctx)
    }

    pub fn register_subscription_service(
        ctx: Context<RegisterSubscriptionService>,
        args: RegisterSubscriptionServiceArgs,
    ) -> Result<()> {
        subly::instructions::register_subscription_service::handler(ctx, args)
    }

    pub fn init_subscribe_service_comp_def(
        ctx: Context<InitSubscribeServiceCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn subscribe_service(
        ctx: Context<SubscribeService>,
        computation_offset: u64,
        args: SubscribeServiceArgs,
    ) -> Result<()> {
        subly::instructions::subscribe_service::handler(ctx, computation_offset, args)
    }

    #[arcium_callback(encrypted_ix = "subscribe_service")]
    pub fn subscribe_service_callback(
        ctx: Context<SubscribeServiceCallback>,
        output: ComputationOutputs<SubscribeServiceOutput>,
    ) -> Result<()> {
        subly::instructions::subscribe_service::handle_callback(ctx, output)
    }

    pub fn init_create_subscription_metadata_comp_def(
        ctx: Context<InitCreateSubscriptionMetadataCompDef>,
    ) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn create_subscription_metadata(
        ctx: Context<CreateSubscriptionMetadata>,
        computation_offset: u64,
        started_at: u64,
        next_billing_ts: u64,
    ) -> Result<()> {
        subly::instructions::create_subscription_metadata::handler(
            ctx,
            computation_offset,
            started_at,
            next_billing_ts,
        )
    }

    #[arcium_callback(encrypted_ix = "create_subscription_metadata")]
    pub fn create_subscription_metadata_callback(
        ctx: Context<CreateSubscriptionMetadataCallback>,
        output: ComputationOutputs<CreateSubscriptionMetadataOutput>,
    ) -> Result<()> {
        subly::instructions::create_subscription_metadata::handle_callback(ctx, output)
    }

    pub fn register_paypal_recipient(
        ctx: Context<RegisterPayPalRecipient>,
        args: RegisterPayPalRecipientArgs,
    ) -> Result<()> {
        subly::instructions::register_paypal_recipient::handler(ctx, args)
    }

    pub fn find_due_subscriptions(
        ctx: Context<FindDueSubscriptions>,
        args: FindDueSubscriptionsArgs,
    ) -> Result<()> {
        subly::instructions::find_due_subscriptions::handler(ctx, args)
    }

    pub fn record_subscription_payment(
        ctx: Context<RecordSubscriptionPayment>,
        args: RecordSubscriptionPaymentArgs,
    ) -> Result<()> {
        subly::instructions::record_subscription_payment::handler(ctx, args)
    }

    pub fn unsubscribe_service(
        ctx: Context<UnsubscribeService>,
        args: UnsubscribeServiceArgs,
    ) -> Result<()> {
        subly::instructions::unsubscribe_service::handler(ctx, args)
    }
}
