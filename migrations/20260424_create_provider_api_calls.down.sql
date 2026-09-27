-- Rollback: 20260424_create_provider_api_calls
-- Drops provider_api_calls table and associated trigger/function

DROP TRIGGER IF EXISTS trg_trim_provider_api_calls ON provider_api_calls;
DROP FUNCTION IF EXISTS trim_provider_api_calls();
DROP INDEX IF EXISTS idx_pac_provider_called_at;
DROP TABLE IF EXISTS provider_api_calls;
