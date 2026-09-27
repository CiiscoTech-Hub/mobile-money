-- Rollback: Multi-Signature Custody Ledger System

DROP TABLE IF EXISTS multisig_audit_log;
DROP TABLE IF EXISTS multisig_signatures;
DROP TABLE IF EXISTS multisig_requests;
DROP TABLE IF EXISTS multisig_signers;
DROP TABLE IF EXISTS multisig_configs;

DROP FUNCTION IF EXISTS update_multisig_requests_updated_at();
DROP FUNCTION IF EXISTS update_multisig_signers_updated_at();
DROP FUNCTION IF EXISTS update_multisig_configs_updated_at();
