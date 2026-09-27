-- Migration: 20260727_add_provider_manual_toggle
-- Description: Manual enable/disable toggle for provider failover dashboard (#1550).
-- Distinct from provider_maintenance_outages (time-windowed scheduled maintenance):
-- this tracks an immediate, admin-toggled on/off state for unscheduled maintenance.

ALTER TABLE provider_settings
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS disabled_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_provider_settings_is_enabled
  ON provider_settings (is_enabled);
