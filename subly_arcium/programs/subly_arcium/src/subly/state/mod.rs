use anchor_lang::prelude::*;
use arcium_anchor::prelude::MXEEncryptedStruct;

pub const CONFIG_CT_LEN: usize = 6;
pub const REGISTRY_CT_LEN: usize = 3;
pub const USER_STAKE_CT_LEN: usize = 164;

const fn encrypted_block_len(ciphertexts: usize) -> usize {
    16 + (ciphertexts * 32)
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
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
    pub encrypted_registry: EncryptedState<REGISTRY_CT_LEN>,
    pub bump: u8,
}

impl SubscriptionRegistry {
    pub const LEN: usize = 8 // discriminator
        + encrypted_block_len(REGISTRY_CT_LEN)
        + 1; // bump

    pub fn blank_state() -> EncryptedState<REGISTRY_CT_LEN> {
        EncryptedState::blank()
    }
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
