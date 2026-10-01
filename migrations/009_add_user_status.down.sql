-- Rollback: 009_add_user_status
-- Removes status field from users and drops audit table

DROP INDEX IF EXISTS idx_user_status_audit_created_at;
DROP INDEX IF EXISTS idx_user_status_audit_changed_by;
DROP INDEX IF EXISTS idx_user_status_audit_user_id;
DROP TABLE IF EXISTS user_status_audit;
DROP INDEX IF EXISTS idx_users_status;
ALTER TABLE users DROP COLUMN IF EXISTS status;

