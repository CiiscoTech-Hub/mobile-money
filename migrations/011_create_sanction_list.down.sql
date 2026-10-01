-- Rollback: 011_create_sanction_list
-- Drops sanction_list table

DROP TRIGGER IF EXISTS sanction_list_updated_at ON sanction_list;
DROP FUNCTION IF EXISTS update_sanction_list_updated_at();
DROP INDEX IF EXISTS idx_sanction_list_external_id;
DROP INDEX IF EXISTS idx_sanction_list_name;
DROP TABLE IF EXISTS sanction_list;

