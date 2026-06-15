-- Audit append-only trigger
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é append-only: UPDATE e DELETE não permitidos';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- Gestor restricted view
CREATE OR REPLACE VIEW v_gestor_cotistas AS
SELECT
  c.id,
  p.cpf_cnpj,
  p.legal_name,
  p.status,
  pba.bank_code,
  pba.branch,
  pba.account
FROM parties p
JOIN cotistas c ON c.party_id = p.id
LEFT JOIN party_bank_accounts pba ON pba.party_id = p.id AND pba.is_primary = TRUE
WHERE p.status = 'aprovado'
  AND (p.expires_at IS NULL OR p.expires_at > NOW());
