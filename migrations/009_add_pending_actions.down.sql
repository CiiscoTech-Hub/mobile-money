-- Rollback: 009_add_pending_actions
-- Drops pending_actions table

DROP INDEX IF EXISTS idx_pending_actions_type;
DROP INDEX IF EXISTS idx_pending_actions_checker_id;
DROP INDEX IF EXISTS idx_pending_actions_maker_id;
DROP INDEX IF EXISTS idx_pending_actions_status;
DROP TABLE IF EXISTS pending_actions;

