-- Migration: 20260625_create_verification_countries
-- Description: Create verification_countries table for multi-nationality
--              passport verification support (issue #1579).
--              Stores the expanded ISO 3166-1 country list used by the
--              validators and KYC verification flow.

CREATE TABLE IF NOT EXISTS verification_countries (
  id                           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  alpha2                       CHAR(2)      NOT NULL,
  alpha3                       CHAR(3)      NOT NULL,
  name                         VARCHAR(100) NOT NULL,
  region                       VARCHAR(20)  NOT NULL
                                 CHECK (region IN ('Africa','Americas','Asia','Europe','Oceania')),
  passport_verification_enabled BOOLEAN     NOT NULL DEFAULT false,
  is_active                    BOOLEAN      NOT NULL DEFAULT true,
  created_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_verification_countries_alpha2 UNIQUE (alpha2),
  CONSTRAINT uq_verification_countries_alpha3 UNIQUE (alpha3)
);

CREATE INDEX IF NOT EXISTS idx_vc_alpha2   ON verification_countries (alpha2);
CREATE INDEX IF NOT EXISTS idx_vc_alpha3   ON verification_countries (alpha3);
CREATE INDEX IF NOT EXISTS idx_vc_region   ON verification_countries (region);
CREATE INDEX IF NOT EXISTS idx_vc_passport ON verification_countries (passport_verification_enabled)
  WHERE passport_verification_enabled = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_verification_countries_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vc_updated_at ON verification_countries;
CREATE TRIGGER trg_vc_updated_at
  BEFORE UPDATE ON verification_countries
  FOR EACH ROW EXECUTE FUNCTION update_verification_countries_updated_at();

COMMENT ON TABLE verification_countries IS
  'ISO 3166-1 country list used for passport-based identity verification. '
  'Seeded by src/scripts/seedVerificationCountries.ts and validated by '
  'src/utils/validators.ts.';
COMMENT ON COLUMN verification_countries.passport_verification_enabled IS
  'True when a per-country ICAO passport format regex is registered in validators.ts.';
