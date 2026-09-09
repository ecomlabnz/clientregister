-- The payment stages cannot add up to more than the quotation does.
--
-- **Asked for on 9 September 2026:** *"during the allocation of payments in the
-- payment stages — there is a hint as to how much has been allocated — make
-- sure that it also tells how much is left to allocate, and that it does not
-- allow for allocating more than the total fee from the fees and disbursements
-- section."*
--
-- The stages are the schedule a client is held to. If they come to more than
-- the quotation, the client has been asked to pay twice for part of the work,
-- in a document that is a contract. Until now the register only said so
-- afterwards, in a warning under the table — which is a note about a mistake
-- that has already been written down.
--
-- ## Why this is a trigger and not a check in the form
--
-- Four routes write `quote_stages`: adding one stage, saving the whole table,
-- drafting a schedule from the items, and laying down the practice's template.
-- A rule written into one of them holds until somebody writes a fifth. That is
-- the fault this register has already had four times, most recently on
-- 8 September when a rule about which client a quotation belongs to lived in a
-- form and a second form did not know about it.
--
-- ## What "the quotation" is, exactly
--
-- `amount_cents + gst_cents + disbursements_cents` on the quote row — the
-- figure printed as **Total payable**, GST included. The stages are compared on
-- `gross_cents`, which is also GST included, so the two sides are the same kind
-- of number. Comparing a net stage against a gross total would refuse schedules
-- that are perfectly correct.
--
-- Equality is allowed and is the normal case: a schedule that allocates the
-- whole quotation is the point.
--
-- ## The direction this does not guard, deliberately
--
-- Lowering a fee line so that the total drops *below* stages already written.
-- The trigger would have to sit on `quotes`, and it would refuse an ordinary
-- correction to an item until the schedule was taken apart first — turning a
-- typo into a half-hour of work. That direction is still reported, in the
-- warning under the schedule, which is the right instrument for "these two no
-- longer agree" as opposed to "this would be wrong the moment you wrote it".
--
-- ## A quotation with no items yet
--
-- Its total is nil, so any stage with an amount is refused. That is correct and
-- is the reason the message says which way round to work: the fees come first,
-- and the schedule divides them up. A stage of nil is always allowed, which is
-- what the practice's template lays down.

CREATE TRIGGER stages_cannot_promise_more_than_the_quote_insert
BEFORE INSERT ON quote_stages
WHEN NEW.gross_cents > 0
 AND (SELECT COALESCE(SUM(gross_cents), 0) FROM quote_stages WHERE quote_id = NEW.quote_id)
     + NEW.gross_cents
   > (SELECT amount_cents + gst_cents + disbursements_cents FROM quotes WHERE id = NEW.quote_id)
BEGIN
  SELECT RAISE(ABORT, 'The payment stages would come to more than the quotation does. A schedule divides up the fees and disbursements; it cannot add to them. Lower a stage, or add the work to the items first.');
END;

-- The same rule for a change to an existing stage, counting every other stage
-- on the quotation but not this one — otherwise raising a stage by a cent would
-- be measured as adding a whole second stage.
CREATE TRIGGER stages_cannot_promise_more_than_the_quote_update
BEFORE UPDATE OF amount_cents, gross_cents, net_cents, gst_cents, quote_id ON quote_stages
WHEN NEW.gross_cents > 0
 AND (SELECT COALESCE(SUM(gross_cents), 0) FROM quote_stages
       WHERE quote_id = NEW.quote_id AND id <> NEW.id)
     + NEW.gross_cents
   > (SELECT amount_cents + gst_cents + disbursements_cents FROM quotes WHERE id = NEW.quote_id)
BEGIN
  SELECT RAISE(ABORT, 'The payment stages would come to more than the quotation does. A schedule divides up the fees and disbursements; it cannot add to them. Lower a stage, or add the work to the items first.');
END;
