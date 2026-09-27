-- Rollback: 20260327_create_device_fingerprints
-- Drops device_fingerprints table

DROP INDEX IF EXISTS idx_device_fingerprints_user_fingerprint;
DROP INDEX IF EXISTS idx_device_fingerprints_user_id;
DROP TABLE IF EXISTS device_fingerprints;

