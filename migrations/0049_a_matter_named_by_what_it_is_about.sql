-- A matter is named by what it is about.
--
-- The practice's decision, 31 August 2026, on reading the case list back and
-- finding the Matter column saying nothing.
--
-- Every matter was named "SURNAME, Given — Type": the client column and the
-- type column, read back. That was not carelessness. The form pre-filled the
-- title from the client and the type as they were chosen, and a field that
-- arrives looking plausibly complete is never replaced — it buys the
-- appearance of being answered at the cost of the answer. Forty-four matters
-- were named that way, and the batch loads generated the rest the same.
--
-- So the title field is gone from the form and `descriptor` — "what this
-- matter is about" — is the one name a matter has. `title` stays as a column,
-- NOT NULL and still read by the matter's own heading, the client's case list
-- and the AI brief, and is now *derived* from the description. One fact, one
-- owner: the description is written, the title follows it.
--
-- Why the column is kept rather than dropped: a practice may one day want a
-- matter named something other than its description, and this decision is two
-- hours old. Nothing is lost by leaving it, and the form can offer it again
-- without a migration.
--
-- Measured before writing this, against the live register: 43 of 44 matters
-- already carry a description, and one does not. So:
--
--   * The one with no description takes its title, because the title is then
--     the only thing that says what the matter is — and on those matters the
--     title is genuinely informative ("Privacy Act request for INZ file"),
--     not the generated pattern.
--   * Every matter's title is then set to its description, so the two agree
--     and every page reading `title` shows the useful text.
--
-- No heuristic tries to tell a generated title from a written one. It does not
-- need to: where a description exists the title was redundant, and where it
-- does not the title is all there is. Nothing is discarded either way — a
-- title that was informative ends up in the description and stays visible.

PRAGMA foreign_keys = ON;

-- The description is the name now, so a matter without one takes its title.
UPDATE cases
   SET descriptor = title
 WHERE descriptor IS NULL OR TRIM(descriptor) = '';

-- And the title follows the description, as it will for every save from here.
UPDATE cases
   SET title = descriptor
 WHERE descriptor IS NOT NULL AND TRIM(descriptor) <> '' AND title <> descriptor;

-- The status history, the audit log and the file notes are untouched. A note
-- written in August referring to a matter by its old name is a record of what
-- was said at the time, and renaming the matter does not make it false.
