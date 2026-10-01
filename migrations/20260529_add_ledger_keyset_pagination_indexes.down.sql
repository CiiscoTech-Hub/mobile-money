-- Rollback: 20260529_add_ledger_keyset_pagination_indexes
-- Removes keyset pagination indexes from ledger_entries

DROP INDEX IF EXISTS idx_ledger_entries_keyset;
DROP INDEX IF EXISTS idx_ledger_entries_account_keyset;
