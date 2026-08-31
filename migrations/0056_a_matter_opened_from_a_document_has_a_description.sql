-- A matter opened from a document has a description.
--
-- Found on the live register on 1 September 2026, one matter in.
--
-- Migration 0049 made the description the name of a matter and removed the
-- title field from the matter form. The form that opens a matter from a read
-- document was not changed with it: it still asked for a title, wrote that to
-- `title`, and left `descriptor` empty. So the first matter opened that way
-- arrived with nothing in the column the case list, the client's file and the
-- AI brief all now read.
--
-- The form is fixed in the same release. This repairs what it wrote.
--
-- Measured before writing this, against the live register: 45 matters, of which
-- 44 have a description equal to their title and one has none. That one takes
-- its title as its description, exactly as migration 0049 did for the matter it
-- found in the same state — the title is the only thing on it that says what the
-- matter is, so it is not discarded, it is moved to where it is read from.

PRAGMA foreign_keys = ON;

UPDATE cases
   SET descriptor = title
 WHERE descriptor IS NULL OR TRIM(descriptor) = '';
