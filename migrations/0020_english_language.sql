-- English language ability.
--
-- INZ assesses a person on four things and the register held three of them:
-- who they are, their immigration history, their character and their health.
-- English was missing, and it decides eligibility for a good many categories
-- outright.
--
-- Three columns rather than one, because "IELTS 6.5" is three separate facts
-- and only one of them can be compared or expire. The test type is a term from
-- an editable list, the score is text because the tests do not agree on a
-- scale — 6.5, 58, B2 — and the date matters because most results are only
-- accepted for two years.

ALTER TABLE clients ADD COLUMN english_test_type TEXT;
ALTER TABLE clients ADD COLUMN english_test_score TEXT;
ALTER TABLE clients ADD COLUMN english_test_date TEXT;
