-- Rollback: 20260529_add_settlement_delay
-- Removes settlement delay columns and reverts post_transaction function

DROP FUNCTION IF EXISTS get_pending_balance(VARCHAR, DATE);
DROP FUNCTION IF EXISTS get_available_balance(VARCHAR, DATE);

-- Revert post_transaction to the original version (without settlement_date)
CREATE OR REPLACE FUNCTION post_transaction(
  p_reference_number VARCHAR(50),
  p_description TEXT,
  p_transaction_id UUID,
  p_posted_by UUID,
  p_entries JSONB
)
RETURNS TABLE(entry_id UUID, account_code VARCHAR, debit DECIMAL, credit DECIMAL) AS $BODY$
DECLARE
  v_account_id UUID;
  v_total_debits DECIMAL(20, 7) := 0;
  v_total_credits DECIMAL(20, 7) := 0;
  v_entry JSONB;
  v_new_entry_id UUID;
BEGIN
  IF p_entries IS NULL OR jsonb_array_length(p_entries) = 0 THEN
    RAISE EXCEPTION 'At least one ledger entry is required';
  END IF;

  IF jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'Double-entry requires at least 2 entries (debit and credit)';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    SELECT id INTO v_account_id
    FROM accounts
    WHERE code = (v_entry->>'account_code')
      AND is_active = true;
    
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'Account not found or inactive: %', (v_entry->>'account_code');
    END IF;

    v_total_debits := v_total_debits + COALESCE((v_entry->>'debit_amount')::DECIMAL(20, 7), 0);
    v_total_credits := v_total_credits + COALESCE((v_entry->>'credit_amount')::DECIMAL(20, 7), 0);
  END LOOP;

  IF v_total_debits != v_total_credits THEN
    RAISE EXCEPTION 'Transaction is not balanced: debits=% credits=%', v_total_debits, v_total_credits;
  END IF;

  IF v_total_debits = 0 THEN
    RAISE EXCEPTION 'Transaction amounts cannot be zero';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    SELECT id INTO v_account_id
    FROM accounts
    WHERE code = (v_entry->>'account_code');

    INSERT INTO ledger_entries (
      account_id,
      debit_amount,
      credit_amount,
      transaction_id,
      reference_number,
      description,
      posted_by,
      metadata
    ) VALUES (
      v_account_id,
      COALESCE((v_entry->>'debit_amount')::DECIMAL(20, 7), 0),
      COALESCE((v_entry->>'credit_amount')::DECIMAL(20, 7), 0),
      p_transaction_id,
      p_reference_number,
      COALESCE(v_entry->>'description', p_description),
      p_posted_by,
      COALESCE(v_entry->'metadata', '{}'::JSONB)
    )
    RETURNING id INTO v_new_entry_id;

    RETURN QUERY
    SELECT 
      v_new_entry_id,
      (v_entry->>'account_code')::VARCHAR,
      COALESCE((v_entry->>'debit_amount')::DECIMAL(20, 7), 0),
      COALESCE((v_entry->>'credit_amount')::DECIMAL(20, 7), 0);
  END LOOP;

  RETURN;
END;
$BODY$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS idx_ledger_entries_settlement_date;
ALTER TABLE ledger_entries DROP COLUMN IF EXISTS settlement_date;
DROP INDEX IF EXISTS idx_users_settlement_delay;
ALTER TABLE users DROP COLUMN IF EXISTS settlement_delay_days;
