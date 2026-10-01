-- Rollback: 008_add_user_contacts
-- Drops user_contacts table

DROP TRIGGER IF EXISTS user_contacts_updated_at ON user_contacts;
DROP FUNCTION IF EXISTS update_user_contacts_updated_at();
DROP INDEX IF EXISTS idx_user_contacts_user_id;
DROP TABLE IF EXISTS user_contacts;

