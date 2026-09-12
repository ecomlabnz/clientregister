-- An education level is a number on the NZQCF, not the name of a certificate.
--
-- **Asked for on 12 September 2026:** *"education level must also have a
-- numerical identifier as per NZQCF - do you know how to determine the level?"*
--
-- The honest answer to the question is: for half the old list, you cannot.
--
-- The list read *Secondary school, Certificate, Diploma, Bachelor's degree,
-- Postgraduate diploma, Master's degree, Doctorate, Other*. Of those, exactly
-- four name one level — Bachelor's is 7, Postgraduate Diploma 8, Master's 9,
-- Doctoral 10. The rest span several:
--
--   * a Certificate sits at any of levels 1 to 6;
--   * a Diploma at 5, 6 or 7;
--   * secondary schooling spans 1 to 3, and is not a framework level at all.
--
-- And three qualifications that *do* name one level were missing: Graduate
-- Certificate and Graduate Diploma (7), Bachelor Honours and Postgraduate
-- Certificate (8).
--
-- This is not tidiness. INZ states points and requirements **by level**. A
-- certificate at level 2 and a certificate at level 6 are different visas, so a
-- field recording "Certificate" records nothing an application can be built on.
--
-- ## The shape
--
-- The field now records the level; the qualification's *name* stays in the
-- free-text box beside it ("Master of Engineering"), where it already was. The
-- number is carried by the key — `nzqcf_7` — rather than in a second column
-- somebody has to keep in step. `nzqcfLevel()` in `core/vocabulary.ts` reads it
-- back out.
--
-- ## Why this is safe to change directly
--
-- Checked against the practice's own register before writing this: it holds
-- **no education rows at all**. There is nothing to migrate and nothing to put
-- at risk. A trial register's rows are laid down by the demonstration caseload
-- and replaced whole every time it resets.
--
-- ## Why the update is guarded
--
-- Every dropdown here is the administrator's to edit, so a practice may have
-- rewritten this list themselves. Replacing that would be taking their work
-- away. So the new list is written **only where the old one is still exactly
-- the default** — compared with carriage returns stripped, because a value
-- saved from a browser textarea comes back CRLF. A practice that has edited
-- theirs keeps it and can add levels themselves.
UPDATE settings
   SET value = 'nzqcf_1 | 1 — Certificate
nzqcf_2 | 2 — Certificate
nzqcf_3 | 3 — Certificate
nzqcf_4 | 4 — Certificate
nzqcf_5 | 5 — Certificate or Diploma
nzqcf_6 | 6 — Certificate or Diploma
nzqcf_7 | 7 — Bachelor’s degree, Diploma, Graduate Certificate or Diploma
nzqcf_8 | 8 — Bachelor Honours, Postgraduate Certificate or Diploma
nzqcf_9 | 9 — Master’s degree
nzqcf_10 | 10 — Doctoral degree

secondary | Secondary school (no framework level)
overseas_unassessed | Overseas — level not assessed
other | Other',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE key = 'vocab.education_levels'
   AND replace(value, char(13), '') = 'secondary | Secondary school
certificate | Certificate
diploma | Diploma
bachelor | Bachelor’s degree
postgrad_diploma | Postgraduate diploma
masters | Master’s degree
doctorate | Doctorate
other | Other';

-- The four old keys that name exactly one level, moved across.
--
-- A no-op on the practice's register, which has no education rows — written
-- anyway because it costs nothing and any register that *does* hold them gets
-- the right answer rather than a raw key on the page.
UPDATE client_education SET level = 'nzqcf_7'  WHERE level = 'bachelor';
UPDATE client_education SET level = 'nzqcf_8'  WHERE level = 'postgrad_diploma';
UPDATE client_education SET level = 'nzqcf_9'  WHERE level = 'masters';
UPDATE client_education SET level = 'nzqcf_10' WHERE level = 'doctorate';

-- `certificate` and `diploma` are deliberately left as they are.
--
-- There is no correct answer: the word spans six levels and three levels
-- respectively, and picking one would be the register inventing a fact about
-- somebody's qualification. Left alone, such a row displays the word it was
-- given, which is a prompt to a person to open the file and choose the level —
-- the right outcome, and the only honest one. `secondary` and `other` keep
-- their keys, which are still in the list.
