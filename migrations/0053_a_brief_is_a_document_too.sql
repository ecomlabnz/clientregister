-- A brief is a document too.
--
-- Asked for by the practice on 1 September 2026. The document categories are
-- vocabulary — an administrator edits them in Settings without a deployment —
-- but the register was seeded with the defaults and has held them unchanged
-- since, so a new default alone would never reach it. This adds the category to
-- the value actually stored, once.
--
-- Placed before "Other", where anything without a home ends up. Nothing is
-- reordered and nothing is renamed: a category key is what existing files are
-- filed under, and moving one would move the files with it.
--
-- Skipped if the practice has already added a category by this name, so running
-- it twice does nothing the first run did not.

UPDATE settings
   SET value = REPLACE(value, 'other | Other', 'brief | Brief' || char(13) || char(10) || 'other | Other'),
       updated_at = updated_at
 WHERE key = 'vocab.doc_categories'
   AND value LIKE '%other | Other%'
   AND value NOT LIKE '%brief |%';
