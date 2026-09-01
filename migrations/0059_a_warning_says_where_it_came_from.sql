-- A warning says where it came from.
--
-- The practice's decision, 1 September 2026, on loading the batch-03 folders.
-- Every warning raised on that load restates a fact that is written down
-- somewhere — a decline letter, a PPI response, a line in a brief. Read on the
-- client's page a year later, a warning with no source is a claim: you believe
-- it or you go looking. With the matter named it is one click to the evidence.
--
-- Nullable on purpose. A warning typed in by hand — "do not phone, she is in a
-- refuge" — comes from a conversation and has no matter behind it, and that is
-- the ordinary case rather than an omission.
--
-- ON DELETE SET NULL rather than CASCADE: if the matter goes, the warning is
-- still true. It loses its citation, not its point.

PRAGMA foreign_keys = ON;

ALTER TABLE flags ADD COLUMN source_case_id TEXT REFERENCES cases(id) ON DELETE SET NULL;
