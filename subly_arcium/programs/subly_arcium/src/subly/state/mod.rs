use anchor_lang::prelude::*;
use arcium_anchor::prelude::MXEEncryptedStruct;

use crate::subly::error::ErrorCode;

pub const MXE_NONCE_LEN: usize = 16;
pub const MXE_CIPHERTEXT_LEN: usize = 32;

pub const CONFIG_CT_LEN: usize = 6;
pub const REGISTRY_CT_LEN: usize = 4;
pub const USER_STAKE_CT_LEN: usize = 6;
pub const USER_SUBSCRIPTIONS_CT_LEN: usize = 7;
pub const SUBSCRIPTION_CONTRACT_CT_LEN: usize = 9;
pub const SUBSCRIPTION_SERVICE_CT_LEN: usize = 6;

const fn encrypted_block_len(ciphertexts: usize) -> usize {
    MXE_NONCE_LEN + (ciphertexts * MXE_CIPHERTEXT_LEN)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct EncryptedState<const LEN: usize> {
    pub nonce: u128,
    pub ciphertexts: [[u8; 32]; LEN],
}

impl<const LEN: usize> From<MXEEncryptedStruct<LEN>> for EncryptedState<LEN> {
    fn from(value: MXEEncryptedStruct<LEN>) -> Self {
        Self {
            nonce: value.nonce,
            ciphertexts: value.ciphertexts,
        }
    }
}

impl<const LEN: usize> EncryptedState<LEN> {
    pub fn into_mxe(self) -> MXEEncryptedStruct<LEN> {
        MXEEncryptedStruct {
            nonce: self.nonce,
            ciphertexts: self.ciphertexts,
        }
    }

    pub fn blank() -> Self {
        Self {
            nonce: 0,
            ciphertexts: [[0u8; 32]; LEN],
        }
    }
}

impl<const LEN: usize> Default for EncryptedState<LEN> {
    fn default() -> Self {
        Self::blank()
    }
}

#[account]
pub struct SublyConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub encrypted_state: EncryptedState<CONFIG_CT_LEN>,
    pub pending_initialize_offset: Option<u64>,
    pub pending_config_offset: Option<u64>,
    pub paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

impl SublyConfig {
    pub const LEN: usize = 8 // discriminator
        + 32 // authority
        + 32 // usdc_mint
        + 32 // vault
        + encrypted_block_len(CONFIG_CT_LEN)
        + 1  // option tag
        + 8  // computation offset
        + 1  // option tag for config offset
        + 8  // config offset value
        + 1  // paused flag
        + 1  // bump
        + 1; // vault bump

    pub fn blank_state() -> EncryptedState<CONFIG_CT_LEN> {
        EncryptedState::blank()
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 32 + 32 + 32;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(CONFIG_CT_LEN);
}

#[account]
pub struct SubscriptionRegistry {
    pub next_service_id: u64,
    pub service_count: u32,
    pub encrypted_registry: EncryptedState<REGISTRY_CT_LEN>,
    pub pending_computation_offset: Option<u64>,
    pub bump: u8,
}

impl SubscriptionRegistry {
    pub const LEN: usize = 8 // discriminator
        + 8  // next_service_id
        + 4  // service_count
        + encrypted_block_len(REGISTRY_CT_LEN)
        + 1  // option tag
        + 8  // pending computation offset
        + 1; // bump

    pub fn blank_state() -> EncryptedState<REGISTRY_CT_LEN> {
        EncryptedState::blank()
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 8 + 4;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(REGISTRY_CT_LEN);
}

#[account]
pub struct UserStakeAccount {
    pub owner: Pubkey,
    pub entry_count: u8,
    pub encrypted_state: EncryptedState<USER_STAKE_CT_LEN>,
    pub pending_computation_offset: Option<u64>,
    pub bump: u8,
}

impl UserStakeAccount {
    pub const LEN: usize = 8 // discriminator
        + 32 // owner
        + 1  // entry_count
        + encrypted_block_len(USER_STAKE_CT_LEN)
        + 1  // pending offset option tag
        + 8  // pending offset value
        + 1; // bump

    pub fn blank_state() -> EncryptedState<USER_STAKE_CT_LEN> {
        EncryptedState::blank()
    }

    pub fn ensure_owner(&mut self, owner: Pubkey, bump: u8) {
        if self.owner == Pubkey::default() {
            self.owner = owner;
            self.entry_count = 0;
            self.pending_computation_offset = None;
            self.bump = bump;
            self.encrypted_state = Self::blank_state();
        }
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 32 + 1;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(USER_STAKE_CT_LEN);
}

#[account]
pub struct UserSubscriptionsAccount {
    pub owner: Pubkey,
    pub encrypted_state: EncryptedState<USER_SUBSCRIPTIONS_CT_LEN>,
    pub pending_computation_offset: Option<u64>,
    pub bump: u8,
}

impl UserSubscriptionsAccount {
    pub const LEN: usize = 8 // discriminator
        + 32 // owner
        + encrypted_block_len(USER_SUBSCRIPTIONS_CT_LEN)
        + 1  // pending computation option tag
        + 8  // pending computation value
        + 1; // bump

    pub fn blank_state() -> EncryptedState<USER_SUBSCRIPTIONS_CT_LEN> {
        EncryptedState::blank()
    }

    pub fn ensure_owner(&mut self, owner: Pubkey, bump: u8) {
        if self.owner == Pubkey::default() {
            self.owner = owner;
            self.pending_computation_offset = None;
            self.encrypted_state = Self::blank_state();
            self.bump = bump;
        }
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 32;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(USER_SUBSCRIPTIONS_CT_LEN);
}

#[account]
pub struct SubscriptionContractAccount {
    pub owner: Pubkey,
    pub contract_seed: [u8; 32],
    pub encrypted_state: EncryptedState<SUBSCRIPTION_CONTRACT_CT_LEN>,
    pub pending_computation_offset: Option<u64>,
    pub bump: u8,
}

impl SubscriptionContractAccount {
    pub const LEN: usize = 8 // discriminator
        + 32 // owner
        + 32 // contract seed
        + encrypted_block_len(SUBSCRIPTION_CONTRACT_CT_LEN)
        + 1  // pending computation option tag
        + 8  // pending computation value
        + 1; // bump

    pub fn blank_state() -> EncryptedState<SUBSCRIPTION_CONTRACT_CT_LEN> {
        EncryptedState::blank()
    }

    pub fn ensure_owner(&mut self, owner: Pubkey, seed: [u8; 32], bump: u8) -> Result<()> {
        if self.owner == Pubkey::default() {
            self.owner = owner;
            self.contract_seed = seed;
            self.pending_computation_offset = None;
            self.encrypted_state = Self::blank_state();
            self.bump = bump;
        } else if self.owner != owner || self.contract_seed != seed {
            return Err(ErrorCode::InvalidSubscriptionAccount.into());
        }
        Ok(())
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 32 + 32;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(SUBSCRIPTION_CONTRACT_CT_LEN);
}

#[account]
pub struct SubscriptionServiceAccount {
    pub id: u64,
    pub creator: Pubkey,
    pub encrypted_state: EncryptedState<SUBSCRIPTION_SERVICE_CT_LEN>,
    pub bump: u8,
}

impl SubscriptionServiceAccount {
    pub const LEN: usize = 8 // discriminator
        + 8  // id
        + 32 // creator
        + encrypted_block_len(SUBSCRIPTION_SERVICE_CT_LEN)
        + 1; // bump

    pub fn blank_state() -> EncryptedState<SUBSCRIPTION_SERVICE_CT_LEN> {
        EncryptedState::blank()
    }

    pub const ENCRYPTED_STATE_OFFSET: usize = 8 + 8 + 32;
    pub const ENCRYPTED_STATE_LEN: usize = encrypted_block_len(SUBSCRIPTION_SERVICE_CT_LEN);
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayPalRecipientType {
    Email,
    PayPalId,
    Phone,
    UserHandle,
}

impl PayPalRecipientType {
    pub fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_uppercase().as_str() {
            "EMAIL" => Ok(Self::Email),
            "PAYPAL_ID" => Ok(Self::PayPalId),
            "PHONE" => Ok(Self::Phone),
            "USER_HANDLE" => Ok(Self::UserHandle),
            _ => Err(ErrorCode::InvalidPayPalRecipientType.into()),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Email => "EMAIL",
            Self::PayPalId => "PAYPAL_ID",
            Self::Phone => "PHONE",
            Self::UserHandle => "USER_HANDLE",
        }
    }

    pub fn as_index(&self) -> u8 {
        match self {
            Self::Email => 0,
            Self::PayPalId => 1,
            Self::Phone => 2,
            Self::UserHandle => 3,
        }
    }

    pub fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::Email),
            1 => Some(Self::PayPalId),
            2 => Some(Self::Phone),
            3 => Some(Self::UserHandle),
            _ => None,
        }
    }
}
