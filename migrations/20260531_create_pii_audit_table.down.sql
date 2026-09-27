-- Rollback: 20260531_create_pii_audit_table
-- Drops pii_access_audit_logs table

DROP INDEX IF EXISTS idx_pii_audit_accessed_at;
DROP INDEX IF EXISTS idx_pii_audit_target_id;
DROP INDEX IF EXISTS idx_pii_audit_admin_id;
DROP TABLE IF EXISTS pii_access_audit_logs;
