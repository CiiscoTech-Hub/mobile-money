-- Add mTLS client certificate validation columns to api_keys
ALTER TABLE api_keys
ADD COLUMN client_cert_cn VARCHAR(255),
ADD COLUMN client_cert_fingerprint VARCHAR(255);
