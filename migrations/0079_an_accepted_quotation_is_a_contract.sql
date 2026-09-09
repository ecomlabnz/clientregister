-- Once a client has accepted, the quotation stops changing.
--
-- **Reported on 9 September 2026,** within an hour of acceptance going live:
-- *"once accepted — the quotation should not change, right? is there a block
-- for that?"* and then, having tried it: *"in quote 12 I managed to delete a
-- line! should not be possible."*
--
-- No block. The only guard on any of it was `quote:write`, which asks whether
-- somebody is allowed to edit quotations at all — not whether *this* quotation
-- is still theirs to edit. So an accepted quotation could have its fee lines
-- changed, its payment schedule rewritten, its parties swapped and its total
-- moved, after a client had put their name to it. That is not an editing
-- mistake; it is a contract being altered after it was formed, by the party who
-- wrote it.
--
-- ## Why this is triggers and not a check on the page
--
-- Because the page is not where it went wrong. Eleven routes write to a
-- quotation — the lines, the stages, the parties, the status, the validity, the
-- letter flag, the template, the generator — and a rule added to each of them
-- is eleven chances to forget and one certainty that the twelfth will. The
-- screen is being changed too, so the buttons disappear rather than erroring;
-- but the screen is the courtesy and this is the guarantee.
--
-- ## What freezes
--
-- Everything the client agreed to: the fee lines, the payment stages, the
-- people named, the figures, the kind of work, the dates, whether a letter of
-- engagement goes with it, and the note under the schedule.
--
-- ## What does not
--
-- `notes` — the practice's own note on the file, which is not printed on the
-- document and is not part of what anybody agreed. `updated_at`, so ordinary
-- bookkeeping still works. And the acceptance columns themselves, which were
-- already frozen by 0078 and by a different rule: they record a moment, not a
-- decision.
--
-- Deliberately **not** allowed: moving the status off `accepted`. There is no
-- version of that which is honest. A quotation accepted in error is answered
-- with a new quotation, exactly as it would be on paper — which is what the
-- refusal says.

-- ---------------------------------------------------------------------------
-- The fee lines.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_items_frozen_once_accepted_insert
BEFORE INSERT ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_items_frozen_once_accepted_update
BEFORE UPDATE ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_items_frozen_once_accepted_delete
BEFORE DELETE ON quote_items
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;

-- ---------------------------------------------------------------------------
-- The payment schedule.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_stages_frozen_once_accepted_insert
BEFORE INSERT ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_stages_frozen_once_accepted_update
BEFORE UPDATE ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_stages_frozen_once_accepted_delete
BEFORE DELETE ON quote_stages
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and its payment schedule cannot be changed. Issue a new quotation instead.');
END;

-- ---------------------------------------------------------------------------
-- The people the engagement is with.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_parties_frozen_once_accepted_insert
BEFORE INSERT ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = NEW.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_parties_frozen_once_accepted_update
BEFORE UPDATE ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

CREATE TRIGGER quote_parties_frozen_once_accepted_delete
BEFORE DELETE ON quote_parties
WHEN (SELECT accepted_at FROM quotes WHERE id = OLD.quote_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and the people named on it cannot be changed. Issue a new quotation instead.');
END;

-- ---------------------------------------------------------------------------
-- The quotation itself.
--
-- Named column by column rather than "anything but notes", so that adding a
-- column later is a decision about whether it is part of the contract rather
-- than an accident either way.
-- ---------------------------------------------------------------------------

CREATE TRIGGER quote_frozen_once_accepted
BEFORE UPDATE ON quotes
WHEN OLD.accepted_at IS NOT NULL
 AND (NEW.client_id IS NOT OLD.client_id
   OR NEW.case_id IS NOT OLD.case_id
   OR NEW.inquiry_id IS NOT OLD.inquiry_id
   OR NEW.case_type IS NOT OLD.case_type
   OR NEW.description IS NOT OLD.description
   OR NEW.amount_cents IS NOT OLD.amount_cents
   OR NEW.gst_cents IS NOT OLD.gst_cents
   OR NEW.disbursements_cents IS NOT OLD.disbursements_cents
   OR NEW.currency IS NOT OLD.currency
   OR NEW.status IS NOT OLD.status
   OR NEW.issued_on IS NOT OLD.issued_on
   OR NEW.valid_until IS NOT OLD.valid_until
   OR NEW.validity_days IS NOT OLD.validity_days
   OR NEW.with_letter IS NOT OLD.with_letter
   OR NEW.stage_note IS NOT OLD.stage_note)
BEGIN
  SELECT RAISE(ABORT, 'This quotation has been accepted by the client and cannot be changed. Issue a new quotation instead.');
END;
