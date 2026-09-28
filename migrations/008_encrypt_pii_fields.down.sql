-- Rollback: 008_encrypt_pii_fields
-- Reverts column types back to VARCHAR from TEXT

-- Transactions table
ALTER TABLE transactions ALTER COLUMN phone_number TYPE VARCHAR(20);
ALTER TABLE transactions ALTER COLUMN stellar_address TYPE VARCHAR(56);

-- Users table
ALTER TABLE users ALTER COLUMN phone_number TYPE VARCHAR(20);
ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(255);
ALTER TABLE users ALTER COLUMN two_factor_secret TYPE VARCHAR(32);

-- Conditional reverts for optional columns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'phone_number' AND data_type = 'text'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN phone_number TYPE VARCHAR(20);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'stellar_address' AND data_type = 'text'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN stellar_address TYPE VARCHAR(56);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'notes' AND data_type = 'text'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN notes TYPE VARCHAR(500);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'admin_notes' AND data_type = 'text'
  ) THEN
    ALTER TABLE transactions ALTER COLUMN admin_notes TYPE VARCHAR(500);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'phone_number' AND data_type = 'text'
  ) THEN
    ALTER TABLE users ALTER COLUMN phone_number TYPE VARCHAR(20);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email' AND data_type = 'text'
  ) THEN
    ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(255);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'two_factor_secret' AND data_type = 'text'
  ) THEN
    ALTER TABLE users ALTER COLUMN two_factor_secret TYPE VARCHAR(32);
  END IF;
END $$;

