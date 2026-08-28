-- 0015_user_preferences.sql
--
-- Preferences that belong to a person rather than to the practice.
--
-- Settings say how this practice works — the GST rate, the follow-up lead time,
-- what a case type is called — and one answer serves everybody. Preferences say
-- how one person likes to work: where they land after signing in, how many rows
-- they want on a page, which view of the client list they usually want. Those
-- are not the practice's business and should not be an administrator's job.
--
-- Key and value rather than a column each, for the same reason settings are:
-- adding a preference should be a declaration in the module that owns it, not a
-- migration. What keeps that safe is that only a declared key can be written —
-- the same rule the settings framework already enforces.
--
-- Theme and colour mode deliberately stay as columns on `users`. They are read
-- on every single request to render the page, and a second query for them on
-- every page load is a cost with nothing to show for it.

PRAGMA foreign_keys = ON;

CREATE TABLE user_preferences (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
