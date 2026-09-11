-- A date in a history may be a month.
--
-- **Asked for on 12 September 2026:** *"in the histories - can we allow filling
-- in only the Month and year if the date is not available?"*
--
-- Yes, and it is the ordinary case rather than the exception. A person
-- remembers leaving a job in March 2019; an application form asks for MM/YYYY;
-- a reference letter says "from June 2015 to August 2018". Migration 0089 said
-- to use the 1st where the day was unknown, which is the register recording a
-- day nobody said. A history full of 1sts reads as precision that is not there,
-- and the one row where the 1st is *true* becomes indistinguishable.
--
-- ## The shape
--
-- The same six columns, still TEXT, now holding either `YYYY-MM-DD` or
-- `YYYY-MM`. No second column saying which: the string says which, by being
-- seven characters or ten.
--
-- A separate precision column was the alternative and is worse. It can
-- disagree with the date beside it — `2019-03-15` marked "month only" is a
-- state with no meaning — and every read would have to consult both. One fact,
-- one owner.
--
-- ## Why the two sort together
--
-- Ordering and comparison still work, unchanged, because these are ISO strings
-- compared as text: `'2019-02' < '2019-03-01' < '2019-03' < '2019-04'`. The one
-- surprise there is that `'2019-03'` sorts *after* every day in March, which is
-- the right answer for an end date (a period ending "March 2019" ran to the end
-- of the month) and the wrong one for a start.
--
-- So nothing compares these raw. `core/histories.ts` widens a month to an
-- instant before comparing — the 1st for a start, the last day for an end —
-- which is the honest reading of what somebody meant, and the only place that
-- arithmetic lives.
--
-- ## What the database checks
--
-- The shape, and only the shape. A value must be a date or a month, and the
-- register has no way to be handed anything else by any route — a form, a
-- reading of a document, a bulk load — and store it. Whether the period makes
-- sense is already covered: 0089 refuses one that ends before it starts, and
-- that comparison is still a text comparison of two ISO strings, which is why
-- it keeps working unchanged.
--
-- GLOB rather than a regular expression, because SQLite has no REGEXP without a
-- host function and D1 does not provide one. `[0-9]` eight or six times is
-- exact, and `LENGTH` pins it so a longer string cannot pass by having a
-- matching prefix.
--
-- ## Nothing to migrate
--
-- Checked against the practice's register before writing this: all three tables
-- hold zero rows, as they did yesterday. Every existing value would already
-- satisfy the rule in any case — a ten-character ISO date passes the first arm.

CREATE TRIGGER client_employment_dates_are_dates_or_months_insert
BEFORE INSERT ON client_employment
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;

CREATE TRIGGER client_employment_dates_are_dates_or_months_update
BEFORE UPDATE OF started_on, ended_on ON client_employment
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;

CREATE TRIGGER client_education_dates_are_dates_or_months_insert
BEFORE INSERT ON client_education
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;

CREATE TRIGGER client_education_dates_are_dates_or_months_update
BEFORE UPDATE OF started_on, ended_on ON client_education
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;

CREATE TRIGGER client_travel_dates_are_dates_or_months_insert
BEFORE INSERT ON client_travel
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;

CREATE TRIGGER client_travel_dates_are_dates_or_months_update
BEFORE UPDATE OF started_on, ended_on ON client_travel
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day or a month, written 2019-03-15 or 2019-03');
END;
