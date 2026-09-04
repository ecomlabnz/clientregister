-- Remove everything scripts/seed-demo.mjs created.
--
-- Every seeded row has an id beginning `demo_`, which is what makes this
-- possible without touching real records. Foreign keys cascade from clients
-- and cases, but the dependents are deleted explicitly so the intent is on the
-- page rather than implied.
--
-- The audit log is append-only and is deliberately not touched: the record
-- that demonstration data was created and removed is itself worth keeping.

PRAGMA foreign_keys = ON;

DELETE FROM case_tags WHERE case_id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM tags WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM case_parties WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM invoice_items WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM invoice_shares WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM invoices WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM quotes WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM tasks WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM entries WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM case_status_history WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM cases WHERE id LIKE 'demo\_%' ESCAPE '\';
DELETE FROM clients WHERE id LIKE 'demo\_%' ESCAPE '\';

-- Reset the reference counters to the highest number still in use.
UPDATE counters SET value = (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 4) AS INTEGER)), 0) FROM clients) WHERE name = 'client';
UPDATE counters SET value = (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 6) AS INTEGER)), 0) FROM cases) WHERE name = 'case';
UPDATE counters SET value = (SELECT COALESCE(MAX(CAST(SUBSTR(ref, 3) AS INTEGER)), 0) FROM quotes) WHERE name = 'quote';
