-- 0009_appearance.sql
--
-- Where a person's choice of theme lives.
--
-- On the user rather than in a cookie, so it follows them between the office
-- desktop and a laptop at home, and so the server can render the right theme
-- into the first response. That is what avoids the flash of the wrong colours
-- that a JavaScript theme switcher gives you: by the time the browser paints,
-- the attribute is already on the element.
--
-- It also costs nothing to read: the session already loads the user row.

PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'slate';
ALTER TABLE users ADD COLUMN colour_mode TEXT NOT NULL DEFAULT 'system'
  CHECK (colour_mode IN ('light', 'dark', 'system'));
