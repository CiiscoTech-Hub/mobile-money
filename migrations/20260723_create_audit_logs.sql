-- Add immutable audit trails for compliance document status changes.

CREATE OR REPLACE FUNCTION log_compliance_document_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.updated_by IS NULL THEN
    RAISE EXCEPTION
      'updated_by is required when changing a compliance document status';
  END IF;

  INSERT INTO audit_logs (
    admin_id,
    action,
    resource,
    resource_id,
    diff
  )
  VALUES (
    NEW.updated_by,
    'COMPLIANCE_STATUS_CHANGED',
    'compliance_document',
    NEW.id::TEXT,
    jsonb_build_object(
      'old_status', OLD.status,
      'new_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS compliance_document_status_audit
  ON compliance_documents;

CREATE TRIGGER compliance_document_status_audit
  AFTER UPDATE OF status ON compliance_documents
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION log_compliance_document_status_change();

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_log_update ON audit_logs;
CREATE TRIGGER prevent_audit_log_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

DROP TRIGGER IF EXISTS prevent_audit_log_delete ON audit_logs;
CREATE TRIGGER prevent_audit_log_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

