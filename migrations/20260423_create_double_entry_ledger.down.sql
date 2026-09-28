-- Rollback: 20260423_create_double_entry_ledger
-- Drops the double-entry ledger system

DROP FUNCTION IF EXISTS get_account_balance(VARCHAR, DATE);
DROP FUNCTION IF EXISTS get_trial_balance(DATE);
DROP FUNCTION IF EXISTS check_ledger_balance();
DROP FUNCTION IF EXISTS refresh_account_balances();
DROP FUNCTION IF EXISTS post_transaction(VARCHAR, TEXT, UUID, UUID, JSONB);
DROP MATERIALIZED VIEW IF EXISTS account_balances;
DROP TRIGGER IF EXISTS prevent_ledger_delete ON ledger_entries;
DROP TRIGGER IF EXISTS prevent_ledger_update ON ledger_entries;
DROP FUNCTION IF EXISTS prevent_ledger_modification();
DROP INDEX IF EXISTS idx_ledger_entries_account_date;
DROP INDEX IF EXISTS idx_ledger_entries_created_at;
DROP INDEX IF EXISTS idx_ledger_entries_reference_number;
DROP INDEX IF EXISTS idx_ledger_entries_transaction_id;
DROP INDEX IF EXISTS idx_ledger_entries_account_id;
DROP INDEX IF EXISTS idx_ledger_entries_entry_date;
DROP TABLE IF EXISTS ledger_entries;
DROP TRIGGER IF EXISTS accounts_updated_at ON accounts;
DROP FUNCTION IF EXISTS update_accounts_updated_at();
DROP INDEX IF EXISTS idx_accounts_is_active;
DROP INDEX IF EXISTS idx_accounts_parent_id;
DROP INDEX IF EXISTS idx_accounts_type;
DROP INDEX IF EXISTS idx_accounts_code;
DROP TABLE IF EXISTS accounts;
