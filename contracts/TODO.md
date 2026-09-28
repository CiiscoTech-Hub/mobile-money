# Implementation Progress: Multi-Sig Upgrade Authority for Escrow

## Steps
- [x] Plan approved by user
- [x] 1. Fix HTLC Cargo.toml: bump soroban-sdk 25.3.0 → 26.0.1
- [x] 2. Update escrow `lib.rs`:
  - [x] 2a. Add error variants for upgrade/admin checks
  - [x] 2b. Add `admin_signers` + `required_admin_signatures` to `EscrowState`
  - [x] 2c. Update `initialize()` to accept admin multi-sig params
  - [x] 2d. Add `upgrade()` function with multi-sig validation
  - [x] 2e. Update existing tests to include admin params
  - [x] 2f. Add comprehensive multi-sig upgrade tests
- [ ] 3. Build and test
- [ ] 4. Regenerate/update test snapshots

