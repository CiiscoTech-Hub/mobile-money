-- Rollback: 20260424_create_audit_logs
-- Drops audit_logs table

DROP INDEX IF EXISTS idx_audit_logs_resource;
DROP INDEX IF EXISTS idx_audit_logs_admin_id;
DROP TABLE IF EXISTS audit_logs;
