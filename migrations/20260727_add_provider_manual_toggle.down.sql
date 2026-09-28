-- Rollback: 20260727_add_provider_manual_toggle

DROP INDEX IF EXISTS idx_provider_settings_is_enabled;

ALTER TABLE provider_settings
  DROP COLUMN IF EXISTS is_enabled,
  DROP COLUMN IF EXISTS disabled_reason,
  DROP COLUMN IF EXISTS disabled_by,
  DROP COLUMN IF EXISTS disabled_at;
