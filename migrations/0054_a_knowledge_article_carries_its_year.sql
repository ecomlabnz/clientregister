-- A knowledge-base article carries its year.
--
-- The practice's decision, 1 September 2026. Every other reference in the
-- register says which year it belongs to — CASE-26-024, and the client and
-- quote counters beside it — and the knowledge base did not: KB-0001 could be
-- from any year, and in five years a four-digit run tells you nothing about
-- when an article was written. Immigration instructions date quickly, so when
-- an article is from is part of what it is.
--
-- So KB-0001 becomes KB-26-001, on the same pattern and through the same
-- counter machinery cases already use: `<prefix>-<two-digit year>-<three
-- digits>`. Three digits rather than four, because the run restarts each year
-- and a practice writing a thousand articles in one year has a different
-- problem.
--
-- Measured before writing this, against the live register: one article,
-- KB-0001, written 31 August 2026. It becomes KB-26-001 and its address
-- changes with it — an article is linked to by id, not by reference, so no link
-- inside the register breaks. A link somebody pasted elsewhere still resolves,
-- because it was never the reference that resolved it.
--
-- The renumbering is derived from each article's own creation year rather than
-- assumed to be this one, so an article written in a different year keeps that
-- year. The yearly counter is then set to the highest number actually used, so
-- the next article follows on rather than colliding.

PRAGMA foreign_keys = ON;

UPDATE kb_articles
   SET ref = 'KB-' || substr(created_at, 3, 2) || '-'
             || substr('000' || CAST(CAST(substr(ref, 4) AS INTEGER) AS TEXT), -3, 3)
 WHERE ref LIKE 'KB-%'
   AND ref NOT LIKE 'KB-__-%';

-- One counter per year, named as `nextYearlyRef` names it.
INSERT OR REPLACE INTO counters (name, value)
SELECT 'kb:20' || substr(ref, 4, 2), MAX(CAST(substr(ref, 7) AS INTEGER))
  FROM kb_articles
 WHERE ref LIKE 'KB-__-%'
 GROUP BY substr(ref, 4, 2);

-- The old flat counter has nothing left to count.
DELETE FROM counters WHERE name = 'kb';
