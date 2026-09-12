-- A history date may be a year, and an education row records when it was awarded.
--
-- **Two things asked for on 12 September 2026**, both about the education
-- section, and the first of them is really about every history:
--
--   *"for education section - we also need the award date (should be able to
--   enter full date or month and year or just year)"*
--
-- ## The award date
--
-- A qualification has three dates that are not the same fact: when study
-- started, when it finished, and when the qualification was **conferred**. The
-- third is the one an application asks for and the one on the certificate, and
-- it is routinely months after the last exam. The register had the first two
-- and no place to put the third, so it went in the note or nowhere.
--
-- ## Why a year is now a date
--
-- Migration 0091 made a history date either a day or a month, because a person
-- remembers leaving a job in March 2019 and the register should not invent the
-- 15th. A conferral is the same argument one step further: what somebody
-- remembers, and what an old certificate often says, is **1998**. Recording
-- `1998-01` would be the register inventing January.
--
-- So the rule becomes: a history date is a day, a month, **or a year** —
-- `2019-03-15`, `2019-03`, or `2019`. The string still says which, by being ten
-- characters, seven, or four. No second column, for the reason 0091 gives: a
-- precision column can disagree with the date beside it.
--
-- ## Why every history and not only education
--
-- The shape of a history date has one owner — `HISTORY_DATE_RE` in
-- `core/histories.ts` and these triggers, which have to agree. Teaching the
-- form a year while the database still refused one would turn a typo into an
-- abort somebody cannot get past. And the argument for a year is not special to
-- education: a client who worked somewhere "in 2015" is the ordinary case too.
--
-- So all three histories take a year. Nothing that is already stored changes:
-- every day and every month still passes, and this only widens what is allowed.
--
-- ## Sorting still works
--
-- These are ISO strings compared as text, so `'2019' < '2019-02' < '2019-03-01'`
-- — a year sorts before every month in it and every day in it. That is the
-- right answer for a start and the wrong one for an end, which is the same
-- asymmetry 0091 already documents and `historyInstant()` already handles by
-- reading an end date as the *last* moment of its period.

ALTER TABLE client_education ADD COLUMN awarded_on TEXT;


DROP TRIGGER IF EXISTS client_employment_dates_are_dates_or_months_insert;
CREATE TRIGGER client_employment_dates_are_dates_months_or_years_insert
BEFORE INSERT ON client_employment
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

DROP TRIGGER IF EXISTS client_employment_dates_are_dates_or_months_update;
CREATE TRIGGER client_employment_dates_are_dates_months_or_years_update
BEFORE UPDATE OF started_on, ended_on ON client_employment
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

DROP TRIGGER IF EXISTS client_education_dates_are_dates_or_months_insert;
CREATE TRIGGER client_education_dates_are_dates_months_or_years_insert
BEFORE INSERT ON client_education
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.awarded_on IS NOT NULL AND NEW.awarded_on <> ''
      AND NOT (
        (LENGTH(NEW.awarded_on) = 10 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.awarded_on) = 7 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.awarded_on) = 4 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

DROP TRIGGER IF EXISTS client_education_dates_are_dates_or_months_update;
CREATE TRIGGER client_education_dates_are_dates_months_or_years_update
BEFORE UPDATE OF started_on, ended_on, awarded_on ON client_education
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.awarded_on IS NOT NULL AND NEW.awarded_on <> ''
      AND NOT (
        (LENGTH(NEW.awarded_on) = 10 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.awarded_on) = 7 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.awarded_on) = 4 AND NEW.awarded_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

DROP TRIGGER IF EXISTS client_travel_dates_are_dates_or_months_insert;
CREATE TRIGGER client_travel_dates_are_dates_months_or_years_insert
BEFORE INSERT ON client_travel
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;

DROP TRIGGER IF EXISTS client_travel_dates_are_dates_or_months_update;
CREATE TRIGGER client_travel_dates_are_dates_months_or_years_update
BEFORE UPDATE OF started_on, ended_on ON client_travel
WHEN (NEW.started_on IS NOT NULL AND NEW.started_on <> ''
      AND NOT (
        (LENGTH(NEW.started_on) = 10 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 7 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.started_on) = 4 AND NEW.started_on GLOB '[0-9][0-9][0-9][0-9]')))
  OR (NEW.ended_on IS NOT NULL AND NEW.ended_on <> ''
      AND NOT (
        (LENGTH(NEW.ended_on) = 10 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 7 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        OR (LENGTH(NEW.ended_on) = 4 AND NEW.ended_on GLOB '[0-9][0-9][0-9][0-9]')))
BEGIN
  SELECT RAISE(ABORT, 'a date in a history is a day, a month or a year, written 2019-03-15, 2019-03 or 2019');
END;
