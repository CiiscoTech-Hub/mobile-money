DROP TRIGGER IF EXISTS prevent_audit_log_delete ON audit_logs;
DROP TRIGGER IF EXISTS prevent_audit_log_update ON audit_logs;
DROP FUNCTION IF EXISTS prevent_audit_log_modification();

DROP TRIGGER IF EXISTS compliance_document_status_audit
  ON compliance_documents;
DROP FUNCTION IF EXISTS log_compliance_document_status_change();

