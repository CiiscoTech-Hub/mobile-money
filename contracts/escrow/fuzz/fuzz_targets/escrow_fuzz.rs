#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env,
};
use escrow::{EscrowContract, EscrowContractClient};
use arbitrary::Arbitrary;

#[derive(Arbitrary, Debug)]
struct FuzzSession {
    amount: i128,
    emergency_unlock_timestamp: u64,
    lock_until_ledger: u32,
    fee_bps: u32,
    steps: Vec<FuzzStep>,
}

#[derive(Arbitrary, Debug)]
enum FuzzStep {
    Release {
        ledger_sequence: u32,
        ledger_timestamp: u64,
    },
    Refund {
        ledger_sequence: u32,
        ledger_timestamp: u64,
    },
    EmergencyRefund {
        ledger_sequence: u32,
        ledger_timestamp: u64,
    },
    SelfRefund {
        ledger_sequence: u32,
        ledger_timestamp: u64,
    },
}

fuzz_target!(|session: FuzzSession| {
    let env = Env::default();
    env.mock_all_auths();

    let depositor = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Deploy a test SAC token.
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_id.address();

    // If the fuzzing amount is positive, try to mint exactly that amount to the depositor
    // so we can test successful/failed deposits without test-setup level panics.
    if session.amount > 0 {
        let token_client = StellarAssetClient::new(&env, &token_address);
        let mint_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token_client.mint(&depositor, &session.amount);
        }));
        if mint_res.is_err() {
            return;
        }
    }

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    // Setup initial ledger state.
    // Ensure the timestamp/sequence are non-zero.
    env.ledger().set_sequence(1);
    env.ledger().set_timestamp(1);

    // Try to initialize the contract.
    // `try_initialize` returns a Result and does not propagate contract-level panics or assertions.
    let init_res = client.try_initialize(
        &depositor,
        &beneficiary,
        &arbiter,
        &token_address,
        &session.amount,
        &session.emergency_unlock_timestamp,
        &session.lock_until_ledger,
        &session.fee_bps,
        &fee_recipient,
    );

    if init_res.is_err() {
        return;
    }

    // If initialization was successful, we proceed to run the steps.
    for step in session.steps {
        match step {
            FuzzStep::Release { ledger_sequence, ledger_timestamp } => {
                env.ledger().set_sequence(ledger_sequence);
                env.ledger().set_timestamp(ledger_timestamp);
                let _ = client.try_release();
            }
            FuzzStep::Refund { ledger_sequence, ledger_timestamp } => {
                env.ledger().set_sequence(ledger_sequence);
                env.ledger().set_timestamp(ledger_timestamp);
                let _ = client.try_refund();
            }
            FuzzStep::EmergencyRefund { ledger_sequence, ledger_timestamp } => {
                env.ledger().set_sequence(ledger_sequence);
                env.ledger().set_timestamp(ledger_timestamp);
                let _ = client.try_emergency_refund();
            }
            FuzzStep::SelfRefund { ledger_sequence, ledger_timestamp } => {
                env.ledger().set_sequence(ledger_sequence);
                env.ledger().set_timestamp(ledger_timestamp);
                let _ = client.try_self_refund();
            }
        }
    }
});
