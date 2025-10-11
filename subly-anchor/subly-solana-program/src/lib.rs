pub mod subly;

use anchor_lang::prelude::*;

pub use subly::constants as subly_constants;
pub use subly::instructions::claim_operator::ClaimOperator;
pub use subly::instructions::claim_user::ClaimUser;
pub use subly::instructions::find_due_subscriptions::{
    DueSubscriptionInfo, FindDueSubscriptions, FindDueSubscriptionsArgs, SubscriptionsDue,
};
pub use subly::instructions::fund_rewards::FundRewards;
pub use subly::instructions::get_paypal_recipient::{GetPayPalRecipient, PayPalRecipientFetched};
pub use subly::instructions::get_subscription_services::{
    GetSubscriptionServices, SubscriptionServiceInfo, SubscriptionServicesFetched,
};
pub use subly::instructions::get_user_available_services::{
    GetUserAvailableServices, UserAvailableServicesFetched,
};
pub use subly::instructions::get_user_stake::{GetUserStake, StakeEntrySnapshot, UserStakeFetched};
pub use subly::instructions::get_user_subscriptions::{
    GetUserSubscriptions, UserSubscriptionInfo, UserSubscriptionsFetched,
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
    SubscribeService, SubscribeServiceArgs, SubscriptionActivated,
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

pub mod __client_accounts_claim_operator {
    pub use crate::subly::instructions::claim_operator::__client_accounts_claim_operator::*;
}

pub mod __client_accounts_claim_user {
    pub use crate::subly::instructions::claim_user::__client_accounts_claim_user::*;
}

pub mod __client_accounts_fund_rewards {
    pub use crate::subly::instructions::fund_rewards::__client_accounts_fund_rewards::*;
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

pub mod __client_accounts_get_subscription_services {
    pub use crate::subly::instructions::get_subscription_services::__client_accounts_get_subscription_services::*;
}

pub mod __client_accounts_subscribe_service {
    pub use crate::subly::instructions::subscribe_service::__client_accounts_subscribe_service::*;
}

pub mod __client_accounts_get_user_available_services {
    pub use crate::subly::instructions::get_user_available_services::__client_accounts_get_user_available_services::*;
}

pub mod __client_accounts_get_user_subscriptions {
    pub use crate::subly::instructions::get_user_subscriptions::__client_accounts_get_user_subscriptions::*;
}

pub mod __client_accounts_get_pay_pal_recipient {
    pub use crate::subly::instructions::get_paypal_recipient::__client_accounts_get_pay_pal_recipient::*;
}

pub mod __client_accounts_get_user_stake {
    pub use crate::subly::instructions::get_user_stake::__client_accounts_get_user_stake::*;
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

declare_id!("C1gJtFGfd2Tt3omV6eWvezeofymZbp7RYj94Hg4drWq1");

#[program]
pub mod subly_solana_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        subly::instructions::initialize::handler(ctx, args)
    }

    pub fn stake(ctx: Context<Stake>, amount: u64, lock_option: u8) -> Result<()> {
        subly::instructions::stake::handler(ctx, amount, lock_option)
    }

    pub fn claim_operator(ctx: Context<ClaimOperator>, amount: u64) -> Result<()> {
        subly::instructions::claim_operator::handler(ctx, amount)
    }

    pub fn claim_user(ctx: Context<ClaimUser>, amount: u64) -> Result<()> {
        subly::instructions::claim_user::handler(ctx, amount)
    }

    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        subly::instructions::fund_rewards::handler(ctx, amount)
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

    pub fn get_subscription_services(ctx: Context<GetSubscriptionServices>) -> Result<()> {
        subly::instructions::get_subscription_services::handler(ctx)
    }

    pub fn subscribe_service(
        ctx: Context<SubscribeService>,
        args: SubscribeServiceArgs,
    ) -> Result<()> {
        subly::instructions::subscribe_service::handler(ctx, args)
    }

    pub fn get_user_available_services(ctx: Context<GetUserAvailableServices>) -> Result<()> {
        subly::instructions::get_user_available_services::handler(ctx)
    }

    pub fn get_user_subscriptions(ctx: Context<GetUserSubscriptions>) -> Result<()> {
        subly::instructions::get_user_subscriptions::handler(ctx)
    }

    pub fn get_paypal_recipient(ctx: Context<GetPayPalRecipient>) -> Result<()> {
        subly::instructions::get_paypal_recipient::handler(ctx)
    }

    pub fn get_user_stake(ctx: Context<GetUserStake>) -> Result<()> {
        subly::instructions::get_user_stake::handler(ctx)
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
