-- A matter that says it was decided carries the date it was decided.
--
-- The practice entered a matter that had already been granted and asked why
-- the file said "Decided —" beside a status of Approved. Both were written by
-- the same form press, and they disagreed.
--
-- The rule existed. It lived in the status-change handler, which stamps
-- `decided_at` when a matter moves to approved or declined. What it did not
-- cover was a matter *created* at one of those statuses — a granted case being
-- entered after the fact, which is a normal thing for a practice loading its
-- own history to do. That route never wrote the column, and there was no field
-- anywhere in the application through which a person could write it either.
--
-- Nine matters in the live register are in that state: seven approved and two
-- declined, each with no decision date. Every one of them has been raising a
-- contradiction alert, which is the alerts page correctly reporting a fault
-- nobody could fix from the interface.
--
-- This is the case the standing rule was written for, almost word for word: a
-- guarantee in a handler lasts until somebody adds a second handler. So the
-- database keeps it. Whatever writes the row — the create form, the status
-- card, a bulk load, or a statement run by hand at a console — a matter at a
-- decided status leaves with a decision date.
--
-- Two deliberate limits.
--
-- **It fills a blank; it never corrects one.** A date already recorded is a
-- fact somebody entered, and this has no better information than they did. The
-- date it writes is the time the row was written, which is right for a
-- decision recorded as it arrives and wrong for one recorded weeks later — so
-- migration 0061 comes with a "Decided on" field on the case form, and *that*
-- is the way to record a decision that happened in June. The trigger is the
-- floor, not the answer.
--
-- **Decided means approved or declined.** Withdrawn and closed are endings, not
-- decisions: nobody decided them, the practice or the client stopped. They keep
-- `closed_at`, which is the date that means something for them.
--
-- The nine existing rows are left exactly as they are. Stamping them now would
-- write today's date onto decisions that arrived on dates the register does not
-- know, which is a worse record than an honest blank — and they are already
-- named on the alerts page, one by one, for the practice to fill in.

CREATE TRIGGER cases_decided_carry_their_date_on_insert
AFTER INSERT ON cases
WHEN NEW.status IN ('approved', 'declined') AND NEW.decided_at IS NULL
BEGIN
  UPDATE cases SET decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER cases_decided_carry_their_date_on_update
AFTER UPDATE OF status ON cases
WHEN NEW.status IN ('approved', 'declined') AND NEW.decided_at IS NULL
BEGIN
  UPDATE cases SET decided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
