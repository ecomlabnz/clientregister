-- 0006_audit_immutable.sql
--
-- Make the audit log append-only at the database, not merely by convention.
--
-- Until now nothing in the application updated or deleted an audit row, but
-- that is a promise about the code rather than a property of the data: a bug,
-- a careless migration, or someone at the D1 console could quietly rewrite
-- history, and the log would still look intact.
--
-- These triggers refuse both operations for every caller — the Worker, the
-- Cloudflare dashboard console, the D1 HTTP API, wrangler. Rows can only be
-- added. Removing that guarantee takes a deliberate, recorded migration that
-- drops these triggers, which is exactly the visibility an audit trail needs.
--
-- The consequence to be aware of: the log now grows without bound and cannot
-- be pruned in place. Export and archive it instead (see docs/operations.md).

PRAGMA foreign_keys = ON;

CREATE TRIGGER audit_log_is_append_only_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be modified');
END;

CREATE TRIGGER audit_log_is_append_only_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted');
END;

-- The log is now read by actor as well as by time and entity, so that a
-- question about one person's activity does not scan the whole table.
CREATE INDEX IF NOT EXISTS idx_audit_actor_label ON audit_log (actor_label, at DESC);
