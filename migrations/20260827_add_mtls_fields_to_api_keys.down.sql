-- Rollback: Remove mTLS columns from api_keys
ALTER TABLE api_keys
DROP COLUMN IF EXISTS client_cert_cn,
DROP COLUMN IF EXISTS client_cert_fingerprint;
