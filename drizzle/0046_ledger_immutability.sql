-- Enforce ledger immutability at the database level. The double-entry ledger was
-- append-only by convention only: nothing stopped an UPDATE/DELETE, and
-- ledger_entries cascaded on deletion of their transaction. This migration makes
-- the guarantees real.

-- 1. Reject UPDATE/DELETE on the append-only ledger tables via a trigger. This
--    also neutralises the ON DELETE CASCADE from ledger_entries -> ledger_transactions:
--    the parent transaction can never be deleted, so the cascade can never fire.
CREATE OR REPLACE FUNCTION revelis_reject_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION revelis_reject_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_transactions_immutable ON ledger_transactions;
CREATE TRIGGER ledger_transactions_immutable
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION revelis_reject_ledger_mutation();

DROP TRIGGER IF EXISTS ledger_audit_logs_immutable ON ledger_audit_logs;
CREATE TRIGGER ledger_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON ledger_audit_logs
  FOR EACH ROW EXECUTE FUNCTION revelis_reject_ledger_mutation();

-- 2. Ledger entry amounts must be strictly positive (direction carries the sign).
--    NOT VALID so the migration cannot fail on any legacy row; new writes enforced.
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_positive CHECK (amount > 0) NOT VALID;
