-- Rollback: 20260625_create_verification_countries
-- Drops verification_countries table and associated trigger/function

DROP TRIGGER IF EXISTS trg_vc_updated_at ON verification_countries;
DROP FUNCTION IF EXISTS update_verification_countries_updated_at();
DROP INDEX IF EXISTS idx_vc_passport;
DROP INDEX IF EXISTS idx_vc_region;
DROP INDEX IF EXISTS idx_vc_alpha3;
DROP INDEX IF EXISTS idx_vc_alpha2;
DROP TABLE IF EXISTS verification_countries;
