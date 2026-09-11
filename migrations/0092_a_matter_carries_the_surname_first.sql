-- A matter carries the surname first.
--
-- **Asked for on 12 September 2026**, looking at the matter picker on a new
-- quotation: *"it is just impossible to search through this! we need a better
-- system, also - can we make sure that this such places the surnames are
-- before the names?"* Seventy open matters in one dropdown, every one of them
-- reading "Bao Long VUONG", so the list sorted by "Anh" and there was no way
-- to run an eye down it looking for a surname.
--
-- From now on a matter is named "RV. Partner — VUONG, Bao Long". This
-- migration brings the ones already in the register into line with the ones
-- written from today.
--
-- ## What changes, and what does not
--
-- **Only the half after the em dash.** The type still comes first, because
-- that is the practice's own decision — *"I like the case naming where the
-- visa type precedes the name — it allows me to sort the cases by visa type"*
-- — and sorting by name must still group by kind of work.
--
-- `clients.full_name` is not touched. It is the display name, "Given FAMILY",
-- natural order, and it is right for correspondence. A *file label* is the
-- other way round. Those are two different jobs and the register now does
-- both, rather than using one name for both.
--
-- Companies are left exactly as they are. "ACME PACKING LIMITED" has no surname
-- to bring to the front, and turning it around would invent one.
--
-- ## Why the string is cut rather than recomposed
--
-- The name a matter carries is composed from the case-type vocabulary, which
-- lives in a settings row holding "key | Label" lines. SQL cannot read that,
-- and a migration that tried would be parsing a text blob to rebuild a label
-- it is not changing. So the type half is kept verbatim — whatever it says now
-- it still says afterwards — and only the name half is rewritten from the
-- client record.
--
-- ## Measured against the register before writing this
--
--   199 matters, every one of them containing exactly one " — ".
--   None contains two, so cutting at the first is cutting at the only one.
--   189 belong to a person with a surname on file and are rewritten here.
--   10 do not: 9 companies and 1 person whose surname is not recorded. Those
--   keep the name they have, which is the same fallback `formalName` uses.
--   13 quotations, 7 of them named this way; the other 6 predate the
--   convention and are left alone by the same guard.
--
-- Rehearsed on a scratch database built from these migrations, and the
-- computed result checked against every one of the 199 live rows before this
-- ran against them.
--
-- ## Not touched: invoices
--
-- An invoice's description is typed by hand — *"What this is for"* — and is
-- not composed from anything. There is nothing here to bring into line.

UPDATE cases
   SET title = substr(title, 1, instr(title, ' — ') + 2) || (
         SELECT CASE
                  WHEN COALESCE(c.given_names, '') = '' THEN c.family_name
                  ELSE c.family_name || ', ' || c.given_names
                END
           FROM clients c WHERE c.id = cases.client_id)
 WHERE instr(title, ' — ') > 0
   AND EXISTS (
         SELECT 1 FROM clients c
          WHERE c.id = cases.client_id
            AND c.kind = 'individual'
            AND COALESCE(c.family_name, '') <> '');

-- A quotation is named the same way, by the same code, so it is brought into
-- line by the same rule. Nothing a client has been sent changes: the page a
-- client opens shows the practice's name, the quotation's reference and the
-- client's own name in natural order — never this label, which is the
-- register's own.
--
-- **Except one that has been accepted.** Migration 0079 froze an accepted
-- quotation column by column, `description` among them, because at that point
-- it is a contract. This migration does not argue with that: it would be
-- refused outright — found by rehearsing it, not by reading it — and it should
-- be. An accepted quotation keeps the name it was accepted under.

UPDATE quotes
   SET description = substr(description, 1, instr(description, ' — ') + 2) || (
         SELECT CASE
                  WHEN COALESCE(c.given_names, '') = '' THEN c.family_name
                  ELSE c.family_name || ', ' || c.given_names
                END
           FROM clients c WHERE c.id = quotes.client_id)
 WHERE instr(description, ' — ') > 0
   AND accepted_at IS NULL
   AND EXISTS (
         SELECT 1 FROM clients c
          WHERE c.id = quotes.client_id
            AND c.kind = 'individual'
            AND COALESCE(c.family_name, '') <> '');
