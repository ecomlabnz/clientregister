-- PPI and RFI are one status; appeal and reconsideration are two.
--
-- The practice's decision, 31 August 2026, on reading the status list back:
--
-- **"INZ — further information requested" goes.** It and "PPI letter received"
-- described the same working state — a letter from INZ with a clock on it and
-- a reply to draft — and the register was asking which of two words to use for
-- one thing. The remaining status is renamed "PPI / RFI letter received" and
-- covers both. One matter currently sits on the old status and is moved.
--
-- (Worth recording, since it is a real distinction the practice is choosing to
-- set aside for status purposes: a PPI is a formal opportunity to comment on
-- prejudicial information, an RFI is a request for documents, and they carry
-- different consequences. What they share is the thing a status is for — the
-- file is with us, a reply is owed, a date is running. Which kind it is
-- belongs on the matter, in the note that records the letter.)
--
-- **"Appeal / reconsideration" splits in two.** Those are different places
-- with different clocks: an IPT appeal is with the Immigration and Protection
-- Tribunal on the Tribunal's timetable, a reconsideration is asking INZ to
-- look at its own decision again. One status could not answer "who is holding
-- this file". No matter is on the old status, so nothing moves.
--
-- `cases.status` carries no CHECK constraint — the list is enforced in
-- `domain.ts` and by the transition table — so this migration is only about
-- the rows. Nothing is deleted: the affected matter keeps its reference, its
-- history and its dates, and its status_history still records every step it
-- took under the old name.

PRAGMA foreign_keys = ON;

UPDATE cases SET status = 'ppi', updated_at = updated_at WHERE status = 'inz_rfi';

-- The history is a record of what was said at the time and is left exactly as
-- written. A row saying a matter moved to "inz_rfi" in August is true; it is
-- not made false by the status being renamed afterwards.
