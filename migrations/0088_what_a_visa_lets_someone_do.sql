-- What a visa lets someone do, and for how long at a time.
--
-- **Asked for on 11 September 2026, in two parts.**
--
-- *"For a client: under immigration tab - we should be able to enter visa
-- conditions as well - not sure if this is needed but if AI is going to be
-- filling it in - why not."*
--
-- *"Need to be able to enter more visa details - validity - say 4 months from
-- each entry, and 6 month in any 12 months. - for example - but do not
-- complicate it as we often do not know when the person is entering the
-- country - so do not want to be flooded with alerts and warnings."*
--
-- Two columns on `clients`, both free text. The second sentence of the second
-- request is the whole design, so it is worth stating plainly what is being
-- deliberately not built.
--
-- ## Why these are text and not dates
--
-- A visitor visa that permits four months per entry and six months in any
-- twelve is not a period the register can compute. It becomes a period only
-- when the person crosses a border, and the register does not know when they
-- did — INZ does, the client's passport stamps do, the register does not. To
-- turn "4 months from each entry" into a date the register would have to hold
-- an arrivals and departures history it has no source for, and would then be
-- wrong every time a client flew without telling anybody.
--
-- A wrong date is worse than no date here, because a date is what the alerts
-- read. The practice said exactly this: *"do not want to be flooded with
-- alerts and warnings."* So:
--
--   * Nothing in this migration is ever read by `modules/alerts`.
--   * Nothing here derives an expiry, and nothing here is derived from one.
--   * The visa's own expiry — `current_visa_expiry` — is untouched and remains
--     the only date the register watches on a visa. That one *is* printed on
--     the grant and *is* a deadline.
--
-- These two columns are what the grant letter says, written down where it can
-- be read while advising, and nothing more. If a stay limit ever needs to be
-- counted, what would have to exist first is a travel history — which is item
-- 0b in `docs/pipeline.md` and a separate decision.
--
-- ## Why conditions are one box and not a list
--
-- Conditions on a New Zealand visa are prose, and INZ writes them as prose:
-- "may only work for the employer named", "must not undertake study of more
-- than three months", "must hold a return ticket". They differ per grant, they
-- are quoted rather than counted, and the register has no use that needs them
-- taken apart. A table of condition rows would be a shape invented for no
-- reader.
--
-- Long, because grant letters are: 2,000 characters, the same ceiling the
-- general notes box uses.
--
-- ## Filling it in
--
-- The practice's reason for asking — *"if AI is going to be filling it in -
-- why not"* — is the one that makes both columns worth having: a visa approval
-- letter states the conditions and the stay limits in words, and reading a
-- letter into a file already knows how to put words into a box. Which is also
-- why neither column is constrained beyond its length: a CHECK on either would
-- reject the sentence INZ actually wrote.

ALTER TABLE clients ADD COLUMN current_visa_conditions TEXT;
ALTER TABLE clients ADD COLUMN current_visa_stay_limit TEXT;

-- The only rule either column carries: it may not be longer than a grant
-- letter's worth of words. In the database rather than in the form, because a
-- form is one way in and the reader that fills these in from a letter is
-- another — and a 40,000-character paste is how a page stops rendering.

CREATE TRIGGER clients_visa_conditions_are_not_a_document_insert
BEFORE INSERT ON clients
WHEN LENGTH(COALESCE(NEW.current_visa_conditions, '')) > 2000
BEGIN
  SELECT RAISE(ABORT, 'visa conditions must be 2000 characters or fewer');
END;

CREATE TRIGGER clients_visa_conditions_are_not_a_document_update
BEFORE UPDATE OF current_visa_conditions ON clients
WHEN LENGTH(COALESCE(NEW.current_visa_conditions, '')) > 2000
BEGIN
  SELECT RAISE(ABORT, 'visa conditions must be 2000 characters or fewer');
END;

CREATE TRIGGER clients_visa_stay_limit_is_a_line_insert
BEFORE INSERT ON clients
WHEN LENGTH(COALESCE(NEW.current_visa_stay_limit, '')) > 300
BEGIN
  SELECT RAISE(ABORT, 'the stay limit must be 300 characters or fewer');
END;

CREATE TRIGGER clients_visa_stay_limit_is_a_line_update
BEFORE UPDATE OF current_visa_stay_limit ON clients
WHEN LENGTH(COALESCE(NEW.current_visa_stay_limit, '')) > 300
BEGIN
  SELECT RAISE(ABORT, 'the stay limit must be 300 characters or fewer');
END;
