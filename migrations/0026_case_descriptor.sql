-- The name and the detail, kept apart.
--
-- A case title was doing two jobs at once: naming the matter and describing it.
-- "AEWV — Orchard worker, Kiwi Orchards" is both "which matter is this" and
-- "what is it about", and because it was one field the answer to the first
-- drifted with the second — sixteen cases, sixteen different shapes.
--
-- The title is now the name, in the practice's convention: "AEWV. TAGATA,
-- Sione". The descriptor is the line under it — the role and the employer, the
-- ground of the request, whatever distinguishes this matter from the next one
-- of the same kind for the same person.
--
-- Existing titles are split on the em dash they already used. Anything without
-- one keeps its whole title and gets no descriptor, which is correct: there was
-- no detail to move.

ALTER TABLE cases ADD COLUMN descriptor TEXT;

-- ` — ` is three *characters*, not three bytes: the em dash is three bytes in
-- UTF-8, but SQLite's SUBSTR and INSTR count characters on a TEXT value. Written
-- as +5 first, which ate the first two letters of every descriptor. Caught by
-- rehearsing on a scratch copy, which is the entire reason for rehearsing.
UPDATE cases
   SET descriptor = TRIM(SUBSTR(title, INSTR(title, ' — ') + 3)),
       title      = TRIM(SUBSTR(title, 1, INSTR(title, ' — ') - 1))
 WHERE INSTR(title, ' — ') > 0;
