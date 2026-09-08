-- The quote catalogue stops keeping its own copy of the case types.
--
-- **Asked 8 September 2026:** *"the field From the catalogue — where does it
-- feed from? from visa types where the cases types are generated from? if no
-- why no? quotation is for precisely visa types or case types we are working on
-- so why not?"* And then: *"these two lists may create confusion — should they
-- not be the same? and include all elements from one another?"*
--
-- It fed from `service_items`, which is a different table from the case-type
-- vocabulary, and somebody had copied the vocabulary into it once. Measured on
-- the live register before this ran:
--
--   * 69 case types, 74 catalogue rows;
--   * 67 of those rows have the same name as a case type;
--   * **2 case types have no catalogue row at all** — "VV. Parent Grandparent"
--     and "WV. AEWV Global Workforce Seasonal". The copy had already drifted,
--     within about a week of being made;
--   * **none of the 74 rows carries a price.** So the 67 copies contributed a
--     name the register already had, and nothing else.
--
-- The first of those two missing types is not a coincidence: it is the very
-- work the practice was quoting when they asked the question, and the reason
-- they were typing its name in by hand.
--
-- ## The bug the copy was causing
--
-- The letter of engagement chooses its clauses from the kinds of work on the
-- quotation, and the quotation's lines carried `service_item_id` — an id like
-- `svc_t_vv_partner`. `engagement_clauses.case_types` holds the vocabulary's
-- own keys: `vv_partner`. They never matched, so a quotation not attached to a
-- matter got no work-specific clauses at all, silently. None of the five live
-- quotations is attached to a matter.
--
-- ## What is one list, and what is not
--
-- Not both directions. **Every case type is quotable**, so the case-type
-- vocabulary now feeds the catalogue directly and a type added under Settings →
-- Vocabulary is quotable the same minute. **Not everything quotable is a case
-- type**: the seven rows that stay are two fee items (Initial consultation,
-- Professional time) and five disbursements (Courier and postage, Immigration
-- New Zealand fee and levy, Medical and x-ray, Police certificate,
-- Translation). Merging those back the other way would offer "Police
-- certificate" as a kind of matter, which it is not.
--
-- So: `service_items` keeps the things that are only ever charged for, the
-- vocabulary keeps the kinds of work, and the quote line says which of the two
-- it came from.

-- What kind of work a line is for, as the vocabulary's own key. Separate from
-- `service_item_id` rather than sharing it, because they are different things:
-- one names a priced item in a catalogue, the other names a kind of work. The
-- letter's clauses are chosen from this.
ALTER TABLE quote_items ADD COLUMN case_type TEXT;

-- Carry the five live lines across *before* the rows they point at are deleted:
-- `service_item_id` is ON DELETE SET NULL, so deleting first would lose them.
UPDATE quote_items
   SET case_type = substr(service_item_id, 7)
 WHERE service_item_id LIKE 'svc\_t\_%' ESCAPE '\';

INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id, meta_json)
SELECT 'aud_cat74', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'migration 0074',
       'quotes.catalogue_deduplicated', 'service_item', NULL,
       json_object(
         'copied_rows_removed', (SELECT COUNT(*) FROM service_items WHERE id LIKE 'svc\_t\_%' ESCAPE '\'),
         'rows_kept', (SELECT COUNT(*) FROM service_items WHERE id NOT LIKE 'svc\_t\_%' ESCAPE '\'),
         'quote_lines_carried_across', (SELECT COUNT(*) FROM quote_items WHERE case_type IS NOT NULL))
 WHERE EXISTS (SELECT 1 FROM service_items WHERE id LIKE 'svc\_t\_%' ESCAPE '\');

-- And now the copies go. Every one was a name and nothing else; the name is in
-- the vocabulary, which is where the practice edits it.
DELETE FROM service_items WHERE id LIKE 'svc\_t\_%' ESCAPE '\';

-- Read the other way as often as it is written: "which quotations covered
-- partnership work" is what the letter's clause matching asks on every print.
CREATE INDEX idx_quote_items_case_type ON quote_items (case_type);
