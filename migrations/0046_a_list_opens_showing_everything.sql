-- A list opens showing everything.
--
-- The practice's decision of 1 September 2026: Clients, Cases and Tasks all
-- open unfiltered. A list that narrows itself before anybody has asked it to
-- is how work goes unnoticed — the rows that are missing are exactly the ones
-- nobody sees — and the filter is one click away either way.
--
-- Changing the shipped defaults in `core/preferences.ts` is not enough on its
-- own. A preference already written to `user_preferences` wins over the
-- default, so the owner's stored `pref.tasks_mine = true` and
-- `pref.cases_scope = open` would have gone on filtering his lists while the
-- code claimed otherwise — a setting that looks changed and is not.
--
-- So this clears the rows rather than rewriting them. `readPreferences` treats
-- a missing row as "no choice made" and hands back the current default, which
-- means the register keeps one answer to "where does a list start" instead of
-- two that can disagree. Anybody who wants a narrowed list sets it again in
-- Settings, and that choice will then be a real one rather than an inherited
-- default nobody remembers making.
--
-- Deliberately not a delete of every preference row: only the three keys whose
-- default moved. Rehearsed on a scratch database seeded from a copy of the
-- production table before running here.

DELETE FROM user_preferences
 WHERE key IN ('pref.tasks_mine', 'pref.cases_scope', 'pref.clients_view');
