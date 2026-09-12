-- A value from one of the practice's lists has to be on the list.
--
-- **Found on 12 September 2026.** The practice spotted two raw codes on a
-- page. Reading their live register against its own lists then found **35
-- client records holding the *label* of a visa or an English test instead of
-- its key** — `Work Visa - Accredited Employer Work Visa` where every other row
-- holds `wv_aewv`. They arrived in a bulk import on 1 September.
--
-- Nothing *displayed* wrong, because the register shows an unrecognised value
-- as itself rather than pretending it is nothing. What was wrong is worse and
-- quieter: the dropdown offers keys only, so those records rendered **blank**,
-- and saving one would have erased the client's visa type without a word.
--
-- The practice's own conclusion: *"the larger problem here is - any bulk data
-- MUST be checked before it is populated. Right? one of the selling points is
-- that we can extract data from the practices files and prepopulate the app
-- very quickly."*
--
-- Then the check that mattered: **no path validated.** Not the client form
-- (`f.optional('current_visa_type', { max: 120 })` — any string), not the
-- intake assistant, not the AI document reader, not an import, not the D1
-- console. The `<select>` only *offers* the right options; nothing refused a
-- wrong one. Three columns happened to be checked in a route and thirteen were
-- not, which is the ordinary fate of a rule kept in handlers.
--
-- ## Why this reverses what migration 0084 wrote down
--
-- 0084 said, of these very columns: *"the database cannot check these. The list
-- lives in `settings`, and a trigger that read it would be a rule that changes
-- when somebody edits a text box — which is not a rule."*
--
-- That is a good argument and it is the wrong way round. A rule that changes
-- when an administrator edits their own list is exactly the rule wanted here:
-- the whole point of a vocabulary is that the practice owns it. What 0084 was
-- protecting against is a *different* hazard — that removing a line from a list
-- would strand the records already filed under it — and that hazard is answered
-- directly below, by checking only when the value is actually changing.
--
-- So the guarantee moves to the one place every path crosses. A `CHECK` still
-- cannot do it, for 0084's reason: a fixed list in the schema would stop the
-- practice adding a visa type without a deployment. A trigger reading the
-- practice's own list can.
--
-- ## The four rules this guard is built on
--
-- **1. Only when the value is actually changing.** `BEFORE UPDATE OF <col>`
-- fires even when a column is set to what it already held, so every trigger
-- below carries `WHEN NEW.col IS NOT OLD.col` — `IS NOT`, which is null-safe,
-- rather than `<>`, which is not. If an administrator later removes a term that
-- existing rows use, those rows stay readable **and saveable**; deleting one
-- line from a list must never strand a client file. It also means this
-- migration needs no data correction of its own to be safe to apply: the 35
-- rows stay exactly as they are until somebody chooses a different value, and
-- Settings → Self-check lists them.
--
-- **2. Empty and NULL are always allowed.** "Not recorded" is a legitimate
-- state everywhere in this register, and an alert that cannot be cleared
-- honestly is an alert people learn to ignore.
--
-- **And whitespace is empty**, which was not in the first draft of this and was
-- found by `test/alertsql.test.ts`, which has held a client whose visa type is
-- three spaces since the alerts were written. A blank typed as spaces is still
-- a blank, and turning it into an error would be a rule about typing rather
-- than about the register.
--
-- **3. A list the database does not know about allows everything.** Each
-- trigger asks *"do I know this list?"* before it asks *"is this value on it?"*
-- — `EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = …)`. Get this
-- the other way round and a register whose lists the database cannot see
-- refuses every value in every guarded column, which is a register nobody can
-- type into. It is written so the failure is permissive, not fatal.
--
-- **4. The message names the column, the list and the value.** An administrator
-- reading an abort has to know what to do about it. D1 was checked on a
-- throwaway database before this was written: `RAISE(ABORT, 'text ' || NEW.col)`
-- is accepted there and the value reaches the caller.
--
-- ## Where the database gets the list — and what happens when nobody has saved one
--
-- A vocabulary is a *setting*. `readSettings` falls back to the code's
-- `defaults` when the row is absent, so on a register where nobody has pressed
-- Save on Lists and dropdowns **there is no row at all**. A trigger that read
-- `settings` alone would then know nothing — and by rule 3 would allow
-- everything, on exactly the register where a bulk import is most likely: a
-- fresh one, being loaded for the first time.
--
-- Three answers were weighed:
--
--   * **Seed `settings` with the defaults.** Rejected. `docs/issues.md` issue
--     15 is precisely that a *stored* list stops receiving improvements to the
--     register's own, and there is no merge for it yet. Seeding would inflict
--     that on every register, including ones that never customised anything.
--   * **Allow everything when unset.** Rejected as the whole answer, for the
--     reason above, though it remains the behaviour of last resort.
--   * **Give the database its own copy of the defaults.** Taken.
--     `vocabulary_defaults` below holds what `VOCABULARIES` in
--     `src/core/vocabulary.ts` declares, and `vocabulary_terms` reads the
--     practice's saved list when there is one and falls back to that table when
--     there is not — the same order `vocabulary()` uses in the code, so the
--     database and the dropdown agree about what is on offer.
--
-- The cost of the third is that the copy can drift from the code. That is paid
-- for by `test/vocabguard.test.ts`, which parses both and fails when the *keys*
-- differ. Keys, not bytes: relabelling `wv_aewv` is free and needs no
-- migration, while adding, removing or renaming a key needs one — which it
-- needed anyway, because it is a change to what the database will accept.
--
-- ## Why the parsed answer is kept rather than worked out each time
--
-- The first version of this parsed the lists inside every trigger. It was
-- correct and it cost **1.6 milliseconds a row**, measured on a rehearsal
-- database — which is sixteen seconds added to a ten-thousand-row import, on
-- the very operation this exists to make safe.
--
-- So `vocabulary_terms` is a table, written only by the six triggers that
-- follow a list changing, and every guard is an index lookup. The same
-- rehearsal then measured a hundred guarded updates at under two milliseconds
-- in total. The parse still exists, in `vocabulary_parsed`, and still has one
-- owner; it just runs when somebody presses Save rather than on every write.
--
-- ## How a line is matched, and which way it errs
--
-- `parseVocabulary` lowercases a key and turns every run of non-alphanumeric
-- characters into an underscore. SQL has no regular expressions, so the view
-- below compares both sides with tabs, carriage returns, spaces, underscores,
-- dots and hyphens removed. That is deliberately a shade **more permissive**
-- than the parser: `wv aewv` is accepted where the list says `wv_aewv`.
--
-- The permissiveness is the safe direction and it is the direction chosen on
-- purpose. Being too strict means refusing a value the practice's own dropdown
-- offers — migration 0064's fault, where a list in the code and a list the
-- database would accept drifted apart and file notes were silently broken for a
-- week. Being too loose means a near-miss like `wvaewv` gets stored and then
-- displays as itself, which the self-check reports and nobody loses a record
-- over. A key written with a character outside that set is refused with a
-- message saying so; see `docs/issues.md`.
--
-- Carriage returns are stripped because the practice's stored lists have them:
-- issue 15 notes `vocab.education_levels` was saved from a browser textarea
-- with CRLF endings. A parser that split on newlines alone would leave `\r` on
-- the end of every key and match nothing.
--
-- ## The self-check
--
-- Asked for as an import dry-run: *"A self-check page — the register reading
-- its own data against its own lists and reporting anything that doesn't match.
-- That's your import dry-run: load, look at the report, fix, before anyone
-- relies on it."*
--
-- `vocabulary_mismatches` is that report, and it is a view rather than sixteen
-- queries in a page so that the guard and the report cannot disagree about what
-- counts as a mismatch. It is read-only by construction: it reports, it never
-- fixes. With the guard in place it should normally be empty, which is the
-- point — an empty report is how a load is proved clean.
--
-- ## What is not guarded, and why
--
-- **`engagement_clauses.case_types`** holds a space-separated *list* of case
-- type keys rather than one value, so membership is not the question to ask of
-- it. Recorded in `docs/issues.md`.
--
-- **`entries.kind`** is guarded, with four kinds always allowed: `system`,
-- `email_in` and `email_out`, which are what the register writes about itself
-- and are nobody's to rename, and `note`, which is what every note form falls
-- back to when a submitted kind is not on the list. Without that fourth
-- exemption an administrator who removed "Note" from their list would make file
-- notes unwritable.
--
-- *What would let this be removed:* nothing yet. It replaces a rule that was
-- kept in three routes out of sixteen.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. The register's own default lists, where the database can read them.
--
-- Generated from `VOCABULARIES` in `src/core/vocabulary.ts`. Held in step by
-- `test/vocabguard.test.ts`, which compares the keys rather than the bytes.
-- ---------------------------------------------------------------------------

CREATE TABLE vocabulary_defaults (
  setting_key TEXT PRIMARY KEY,
  terms       TEXT NOT NULL
);

INSERT INTO vocabulary_defaults (setting_key, terms) VALUES
  ('vocab.case_types', 'vv_general | VV. General
vv_partner | VV. Partner
vv_group | VV. Group
vv_business | VV. Business
vv_medical_treatment | VV. Medical Treatment
vv_guardian_of_student | VV. Guardian of Student
vv_crew_seafarer | VV. Crew / Seafarer
vv_other | VV. Other

sv_general | SV. General
sv_partner | SV. Partner
sv_dep_child | SV. Dep Child
sv_exchange | SV. Exchange
sv_other | SV. Other

wv_aewv | WV. AEWV
wv_partner | WV. Partner WV
wv_dep_child | WV. Dep Child
wv_post_study | WV. Post-Study
wv_specific_purpose | WV. Specific Purpose
wv_working_holiday | WV. Working Holiday
wv_seasonal | WV. Seasonal
wv_religious_worker | WV. Religious Worker
wv_talent_accredited_employer_legacy | WV. Talent Accredited Employer (legacy)
wv_long_term_skill_shortage_legacy | WV. Long Term Skill Shortage (legacy)
wv_other | WV. Other

rv_general | RV. General
rv_permanent | RV. Permanent
rv_green_list_str | RV. Green List - StR
rv_green_list_wtr | RV. Green List - WtR
rv_smc | RV. SMC
rv_rfw_talent | RV. RfW - Talent
rv_rfw_religious_worker | RV. RfW - Religious Worker
rv_partnership | RV. Partner RV
rv_parent | RV. Parent
rv_dep_child | RV. Dep Child
rv_refugee_family_support | RV. Refugee Family Support
rv_active_investor_plus | RV. Active Investor Plus
rv_entrepreneur | RV. Entrepreneur
rv_employees_of_relocating_business | RV. Employees of Relocating Business
rv_samoan_quota | RV. Samoan Quota
rv_pacific_access_category | RV. Pacific Access Category
rv_settlement_refugee_protected_person | RV. Settlement (Refugee / Protected Person)
rv_other | RV. Other

rq_section_61_request | RQ. S.61
rq_ministerial_intervention | RQ. Ministerial Intervention
rq_reconsideration_temporary_visa_decline | RQ. Recon
rq_privacy_act_request | RQ. Privacy Act Request
rq_status_of_person_request | RQ. Status of Person Request
rq_immigration_act_request_s_378 | RQ. Immigration Act Request (s 378)

app_ipt_residence_appeal | APP. IPT Residence Appeal
app_ipt_deportation_appeal | APP. IPT Deportation Appeal

reply_ppi_response | REPLY. PPI Response
reply_deportation_liability_response | REPLY. Deportation Liability Response
reply_deportation_order_response | REPLY. Deportation Order Response

voc_variation_work | VOC. Variation - Work
voc_variation_study | VOC. Variation - Study
voc_variation_residence_travel_conditions | VOC. Variation - Residence Travel Conditions

trnsf_transfer_to_new_passport | TRNSF. Transfer to New Passport
trnsf_replacement_of_lost_damaged_visa | TRNSF. Replacement of Lost / Damaged Visa

cz_citizenship_grant | CZ. Citizenship - Grant
cz_citizenship_confirmation | CZ. Citizenship - Confirmation

emp_employer_accreditation | EMP. Employer Accreditation
emp_job_check | EMP. JC
emp_accreditation_renewal | EMP. Accreditation Renewal

ot_advice_only | OT. Advice Only
ot_second_opinion | OT. Second Opinion
ot_other | OT. Other'),
  ('vocab.visa_types', 'vv_visitor | VV. Visitor
vv_partner | VV. Partner
vv_guardian | VV. Guardian of Student
vv_medical | VV. Medical Treatment

sv_student | SV. Student
sv_partner | SV. Partner of Student
sv_dep_child | SV. Dep Child

wv_aewv | WV. AEWV
wv_partner | WV. Partner
wv_dep_child | WV. Dep Child
wv_post_study | WV. Post-Study
wv_specific_purpose | WV. Specific Purpose
wv_working_holiday | WV. Working Holiday
wv_seasonal | WV. Seasonal (RSE)
wv_religious_worker | WV. Religious Worker
wv_talent_accredited | WV. Talent Accredited Employer (legacy)
wv_lt_skill_shortage | WV. Long Term Skill Shortage (legacy)
wv_other | WV. Other

rv_resident | RV. Resident
rv_permanent | RV. Permanent Resident

other_interim | Interim visa
other_limited | Limited visa
other_transit | Transit visa
other_nzeta | NZeTA / visa waiver
other_citizen_nz | New Zealand citizen
other_citizen_au | Australian citizen or permanent resident

none_offshore | None — offshore
none_unlawful | None — unlawful in New Zealand
none_expired | None — visa expired, onshore

unknown | Not established yet'),
  ('vocab.titles', 'mr | Mr
mrs | Mrs
ms | Ms
miss | Miss
mx | Mx
dr | Dr
prof | Professor'),
  ('vocab.genders', 'male | Male
female | Female
gender_diverse | Gender diverse'),
  ('vocab.relationship_statuses', 'single | Single
married | Married
civil_union | Civil union
de_facto | De facto
engaged | Engaged
separated | Separated
divorced | Divorced
widowed | Widowed'),
  ('vocab.english_tests', 'ielts | IELTS (General or Academic)
pte | PTE Academic
toefl | TOEFL iBT
cambridge | Cambridge C1 Advanced / C2 Proficiency
oet | OET
nzcel | NZCEL
exempt_nationality | Exempt — recognised country
exempt_study | Exempt — prior study in English
exempt_work | Exempt — prior skilled work in English
other | Other evidence'),
  ('vocab.doc_categories', 'identity | Identity
health | Health
character | Character
english | English
relationship | Relationship
employment | Employment
financial | Financial
inz | INZ correspondence
engagement | Engagement & fees
file_note | File note
brief | Brief
other | Other'),
  ('vocab.flag_kinds', 'safety | Safety
character | Character or conviction
border | Border alert
health | Health
immigration | Immigration history
contact | How to make contact
money | Money
other | Other'),
  ('vocab.note_kinds', 'note | Note
status_query | Status query
consult | Consult
call | Phone call
meeting | Meeting
message | Message
file | Document'),
  ('vocab.employment_kinds', 'employed | Employed
self_employed | Self-employed
unemployed | Unemployed
studying | Studying
caring | Caring for family
volunteer | Voluntary work
other | Other'),
  ('vocab.education_levels', 'nzqcf_1 | 1 — Certificate
nzqcf_2 | 2 — Certificate
nzqcf_3 | 3 — Certificate
nzqcf_4 | 4 — Certificate
nzqcf_5 | 5 — Certificate or Diploma
nzqcf_6 | 6 — Certificate or Diploma
nzqcf_7 | 7 — Bachelor’s degree, Diploma, Graduate Certificate or Diploma
nzqcf_8 | 8 — Bachelor Honours, Postgraduate Certificate or Diploma
nzqcf_9 | 9 — Master’s degree
nzqcf_10 | 10 — Doctoral degree

secondary | Secondary school (no framework level)
overseas_unassessed | Overseas — level not assessed
other | Other'),
  ('vocab.education_outcomes', 'completed | Completed
incomplete | Not completed
in_progress | Still studying'),
  ('vocab.travel_purposes', 'family | Family
holiday | Holiday
business | Business
work | Work
study | Study
transit | Transit
other | Other'),
  ('vocab.travel_modes', 'air | Air
sea | Sea
land | Land');

-- ---------------------------------------------------------------------------
-- 2. The lists, parsed, as the database sees them.
--
-- SQL has no regular expressions, so the parse is a recursive walk down the
-- lines of the stored text. That is cheap to run once and far too dear to run
-- on every write — measured at 1.6 ms a row, which is sixteen seconds added to
-- a ten-thousand-row import — so the answer below is kept in a table and the
-- view is only consulted when a list actually changes.
-- ---------------------------------------------------------------------------

CREATE VIEW vocabulary_parsed AS
WITH RECURSIVE
  -- Two sources per list: what the practice saved, and what the register ships.
  -- Source 1 is the practice's; source 2 the default.
  source(setting_key, source, rest) AS (
    SELECT d.setting_key, 1, s.value || CHAR(10)
      FROM vocabulary_defaults d JOIN settings s ON s.key = d.setting_key
    UNION ALL
    SELECT d.setting_key, 2, d.terms || CHAR(10)
      FROM vocabulary_defaults d
  ),
  -- One row per line. The trailing newline above is what ends the walk.
  walk(setting_key, source, rest, line) AS (
    SELECT setting_key, source, rest, NULL FROM source
    UNION ALL
    SELECT setting_key, source,
           SUBSTR(rest, INSTR(rest, CHAR(10)) + 1),
           SUBSTR(rest, 1, INSTR(rest, CHAR(10)) - 1)
      FROM walk
     WHERE rest <> ''
  ),
  term(setting_key, source, term_key) AS (
    SELECT setting_key, source,
           LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
             CASE WHEN INSTR(line, '|') > 0
             THEN SUBSTR(line, 1, INSTR(line, '|') - 1) ELSE line END,
             CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', ''))
      FROM walk
     WHERE line IS NOT NULL
       AND TRIM(REPLACE(line, CHAR(13), '')) <> ''
       AND SUBSTR(TRIM(REPLACE(line, CHAR(13), '')), 1, 1) <> '#'
  )
SELECT setting_key, source, term_key FROM term WHERE term_key <> '';

-- The list as it actually stands: what the practice saved when they have saved
-- one, and the register's default when they have not. The same order
-- `vocabulary()` uses in the code, so the database and the dropdown agree.
CREATE VIEW vocabulary_effective AS
SELECT DISTINCT t.setting_key, t.term_key
  FROM vocabulary_parsed t
 WHERE t.source = 1
    OR NOT EXISTS (SELECT 1 FROM vocabulary_parsed u
                    WHERE u.setting_key = t.setting_key AND u.source = 1);

-- ---------------------------------------------------------------------------
-- 3. That answer, kept. Every guard below reads this table and nothing else.
--
-- Derived, with one owner: the six triggers under it are the only things that
-- ever write it, and they rewrite one list at a time whenever that list
-- changes. `test/vocabguard.test.ts` compares the table against the view and
-- fails if they have come apart.
-- ---------------------------------------------------------------------------

CREATE TABLE vocabulary_terms (
  setting_key TEXT NOT NULL,
  term_key    TEXT NOT NULL,
  PRIMARY KEY (setting_key, term_key)
);

INSERT INTO vocabulary_terms (setting_key, term_key)
  SELECT setting_key, term_key FROM vocabulary_effective;

-- A practice saving a list, changing one, or clearing it back to the default.
CREATE TRIGGER vocabulary_terms_follow_a_saved_list_insert
AFTER INSERT ON settings
WHEN NEW.key IN (SELECT setting_key FROM vocabulary_defaults)
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = NEW.key;
  INSERT INTO vocabulary_terms (setting_key, term_key)
    SELECT setting_key, term_key FROM vocabulary_effective WHERE setting_key = NEW.key;
END;

CREATE TRIGGER vocabulary_terms_follow_a_saved_list_update
AFTER UPDATE OF value ON settings
WHEN NEW.key IN (SELECT setting_key FROM vocabulary_defaults)
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = NEW.key;
  INSERT INTO vocabulary_terms (setting_key, term_key)
    SELECT setting_key, term_key FROM vocabulary_effective WHERE setting_key = NEW.key;
END;

-- Deleting the row does not remove the list; it hands it back to the default.
CREATE TRIGGER vocabulary_terms_follow_a_saved_list_delete
AFTER DELETE ON settings
WHEN OLD.key IN (SELECT setting_key FROM vocabulary_defaults)
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = OLD.key;
  INSERT INTO vocabulary_terms (setting_key, term_key)
    SELECT setting_key, term_key FROM vocabulary_effective WHERE setting_key = OLD.key;
END;

-- And the same three for the register's own defaults, so a later migration that
-- adds a visa type has nothing to remember.
CREATE TRIGGER vocabulary_terms_follow_the_defaults_insert
AFTER INSERT ON vocabulary_defaults
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = NEW.setting_key;
  INSERT INTO vocabulary_terms (setting_key, term_key)
    SELECT setting_key, term_key FROM vocabulary_effective WHERE setting_key = NEW.setting_key;
END;

CREATE TRIGGER vocabulary_terms_follow_the_defaults_update
AFTER UPDATE OF terms ON vocabulary_defaults
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = NEW.setting_key;
  INSERT INTO vocabulary_terms (setting_key, term_key)
    SELECT setting_key, term_key FROM vocabulary_effective WHERE setting_key = NEW.setting_key;
END;

CREATE TRIGGER vocabulary_terms_follow_the_defaults_delete
AFTER DELETE ON vocabulary_defaults
BEGIN
  DELETE FROM vocabulary_terms WHERE setting_key = OLD.setting_key;
END;

-- ---------------------------------------------------------------------------
-- 4. The self-check: every stored value that is not on its list.
-- ---------------------------------------------------------------------------

CREATE VIEW vocabulary_mismatches AS
SELECT 'clients' AS table_name, 'current_visa_type' AS column_name,
       'vocab.visa_types' AS setting_key, current_visa_type AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM clients
 WHERE TRIM(COALESCE(current_visa_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.visa_types')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.visa_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      clients.current_visa_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY current_visa_type
UNION ALL
SELECT 'clients' AS table_name, 'english_test_type' AS column_name,
       'vocab.english_tests' AS setting_key, english_test_type AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM clients
 WHERE TRIM(COALESCE(english_test_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.english_tests')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.english_tests'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      clients.english_test_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY english_test_type
UNION ALL
SELECT 'clients' AS table_name, 'title' AS column_name,
       'vocab.titles' AS setting_key, title AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM clients
 WHERE TRIM(COALESCE(title, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.titles')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.titles'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      clients.title,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY title
UNION ALL
SELECT 'clients' AS table_name, 'gender' AS column_name,
       'vocab.genders' AS setting_key, gender AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM clients
 WHERE TRIM(COALESCE(gender, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.genders')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.genders'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      clients.gender,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY gender
UNION ALL
SELECT 'clients' AS table_name, 'relationship_status' AS column_name,
       'vocab.relationship_statuses' AS setting_key, relationship_status AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM clients
 WHERE TRIM(COALESCE(relationship_status, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.relationship_statuses')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.relationship_statuses'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      clients.relationship_status,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY relationship_status
UNION ALL
SELECT 'cases' AS table_name, 'case_type' AS column_name,
       'vocab.case_types' AS setting_key, case_type AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM cases
 WHERE TRIM(COALESCE(case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      cases.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY case_type
UNION ALL
SELECT 'quotes' AS table_name, 'case_type' AS column_name,
       'vocab.case_types' AS setting_key, case_type AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM quotes
 WHERE TRIM(COALESCE(case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      quotes.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY case_type
UNION ALL
SELECT 'quote_items' AS table_name, 'case_type' AS column_name,
       'vocab.case_types' AS setting_key, case_type AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM quote_items
 WHERE TRIM(COALESCE(case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      quote_items.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY case_type
UNION ALL
SELECT 'documents' AS table_name, 'category' AS column_name,
       'vocab.doc_categories' AS setting_key, category AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM documents
 WHERE TRIM(COALESCE(category, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.doc_categories')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.doc_categories'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      documents.category,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY category
UNION ALL
SELECT 'flags' AS table_name, 'kind' AS column_name,
       'vocab.flag_kinds' AS setting_key, kind AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM flags
 WHERE TRIM(COALESCE(kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.flag_kinds')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.flag_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      flags.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY kind
UNION ALL
SELECT 'entries' AS table_name, 'kind' AS column_name,
       'vocab.note_kinds' AS setting_key, kind AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM entries
 WHERE TRIM(COALESCE(kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND entries.kind NOT IN ('system', 'email_in', 'email_out', 'note')
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.note_kinds')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.note_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      entries.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY kind
UNION ALL
SELECT 'client_employment' AS table_name, 'kind' AS column_name,
       'vocab.employment_kinds' AS setting_key, kind AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM client_employment
 WHERE TRIM(COALESCE(kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.employment_kinds')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.employment_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      client_employment.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY kind
UNION ALL
SELECT 'client_education' AS table_name, 'level' AS column_name,
       'vocab.education_levels' AS setting_key, level AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM client_education
 WHERE TRIM(COALESCE(level, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_levels')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_levels'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      client_education.level,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY level
UNION ALL
SELECT 'client_education' AS table_name, 'completed' AS column_name,
       'vocab.education_outcomes' AS setting_key, completed AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM client_education
 WHERE TRIM(COALESCE(completed, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_outcomes')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_outcomes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      client_education.completed,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY completed
UNION ALL
SELECT 'client_travel' AS table_name, 'purpose' AS column_name,
       'vocab.travel_purposes' AS setting_key, purpose AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM client_travel
 WHERE TRIM(COALESCE(purpose, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_purposes')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_purposes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      client_travel.purpose,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY purpose
UNION ALL
SELECT 'client_travel' AS table_name, 'mode' AS column_name,
       'vocab.travel_modes' AS setting_key, mode AS value,
       COUNT(*) AS rows_affected, SUBSTR(GROUP_CONCAT(id), 1, 200) AS example_ids
  FROM client_travel
 WHERE TRIM(COALESCE(mode, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
   AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_modes')
   AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_modes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      client_travel.mode,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
 GROUP BY mode;

-- ---------------------------------------------------------------------------
-- 5. The guard itself.
-- ---------------------------------------------------------------------------

CREATE TRIGGER clients_current_visa_type_is_on_its_list_insert
BEFORE INSERT ON clients
WHEN TRIM(COALESCE(NEW.current_visa_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.visa_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.visa_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.current_visa_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.current_visa_type is not on the practice''s list of visa types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.current_visa_type);
END;

CREATE TRIGGER clients_current_visa_type_is_on_its_list_update
BEFORE UPDATE OF current_visa_type ON clients
WHEN NEW.current_visa_type IS NOT OLD.current_visa_type
 AND TRIM(COALESCE(NEW.current_visa_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.visa_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.visa_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.current_visa_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.current_visa_type is not on the practice''s list of visa types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.current_visa_type);
END;

CREATE TRIGGER clients_english_test_type_is_on_its_list_insert
BEFORE INSERT ON clients
WHEN TRIM(COALESCE(NEW.english_test_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.english_tests')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.english_tests'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.english_test_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.english_test_type is not on the practice''s list of English tests — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.english_test_type);
END;

CREATE TRIGGER clients_english_test_type_is_on_its_list_update
BEFORE UPDATE OF english_test_type ON clients
WHEN NEW.english_test_type IS NOT OLD.english_test_type
 AND TRIM(COALESCE(NEW.english_test_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.english_tests')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.english_tests'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.english_test_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.english_test_type is not on the practice''s list of English tests — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.english_test_type);
END;

CREATE TRIGGER clients_title_is_on_its_list_insert
BEFORE INSERT ON clients
WHEN TRIM(COALESCE(NEW.title, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.titles')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.titles'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.title,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.title is not on the practice''s list of titles — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.title);
END;

CREATE TRIGGER clients_title_is_on_its_list_update
BEFORE UPDATE OF title ON clients
WHEN NEW.title IS NOT OLD.title
 AND TRIM(COALESCE(NEW.title, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.titles')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.titles'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.title,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.title is not on the practice''s list of titles — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.title);
END;

CREATE TRIGGER clients_gender_is_on_its_list_insert
BEFORE INSERT ON clients
WHEN TRIM(COALESCE(NEW.gender, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.genders')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.genders'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.gender,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.gender is not on the practice''s list of genders — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.gender);
END;

CREATE TRIGGER clients_gender_is_on_its_list_update
BEFORE UPDATE OF gender ON clients
WHEN NEW.gender IS NOT OLD.gender
 AND TRIM(COALESCE(NEW.gender, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.genders')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.genders'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.gender,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.gender is not on the practice''s list of genders — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.gender);
END;

CREATE TRIGGER clients_relationship_status_is_on_its_list_insert
BEFORE INSERT ON clients
WHEN TRIM(COALESCE(NEW.relationship_status, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.relationship_statuses')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.relationship_statuses'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.relationship_status,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.relationship_status is not on the practice''s list of relationship statuses — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.relationship_status);
END;

CREATE TRIGGER clients_relationship_status_is_on_its_list_update
BEFORE UPDATE OF relationship_status ON clients
WHEN NEW.relationship_status IS NOT OLD.relationship_status
 AND TRIM(COALESCE(NEW.relationship_status, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.relationship_statuses')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.relationship_statuses'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.relationship_status,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'clients.relationship_status is not on the practice''s list of relationship statuses — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.relationship_status);
END;

CREATE TRIGGER cases_case_type_is_on_its_list_insert
BEFORE INSERT ON cases
WHEN TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'cases.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER cases_case_type_is_on_its_list_update
BEFORE UPDATE OF case_type ON cases
WHEN NEW.case_type IS NOT OLD.case_type
 AND TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'cases.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER quotes_case_type_is_on_its_list_insert
BEFORE INSERT ON quotes
WHEN TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'quotes.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER quotes_case_type_is_on_its_list_update
BEFORE UPDATE OF case_type ON quotes
WHEN NEW.case_type IS NOT OLD.case_type
 AND TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'quotes.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER quote_items_case_type_is_on_its_list_insert
BEFORE INSERT ON quote_items
WHEN TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'quote_items.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER quote_items_case_type_is_on_its_list_update
BEFORE UPDATE OF case_type ON quote_items
WHEN NEW.case_type IS NOT OLD.case_type
 AND TRIM(COALESCE(NEW.case_type, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.case_types')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.case_types'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.case_type,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'quote_items.case_type is not on the practice''s list of case types — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.case_type);
END;

CREATE TRIGGER documents_category_is_on_its_list_insert
BEFORE INSERT ON documents
WHEN TRIM(COALESCE(NEW.category, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.doc_categories')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.doc_categories'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.category,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'documents.category is not on the practice''s list of document categories — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.category);
END;

CREATE TRIGGER documents_category_is_on_its_list_update
BEFORE UPDATE OF category ON documents
WHEN NEW.category IS NOT OLD.category
 AND TRIM(COALESCE(NEW.category, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.doc_categories')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.doc_categories'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.category,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'documents.category is not on the practice''s list of document categories — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.category);
END;

CREATE TRIGGER flags_kind_is_on_its_list_insert
BEFORE INSERT ON flags
WHEN TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.flag_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.flag_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'flags.kind is not on the practice''s list of warning kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER flags_kind_is_on_its_list_update
BEFORE UPDATE OF kind ON flags
WHEN NEW.kind IS NOT OLD.kind
 AND TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.flag_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.flag_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'flags.kind is not on the practice''s list of warning kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER entries_kind_is_on_its_list_insert
BEFORE INSERT ON entries
WHEN TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND NEW.kind NOT IN ('system', 'email_in', 'email_out', 'note')
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.note_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.note_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'entries.kind is not on the practice''s list of file note kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER entries_kind_is_on_its_list_update
BEFORE UPDATE OF kind ON entries
WHEN NEW.kind IS NOT OLD.kind
 AND TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND NEW.kind NOT IN ('system', 'email_in', 'email_out', 'note')
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.note_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.note_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'entries.kind is not on the practice''s list of file note kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER client_employment_kind_is_on_its_list_insert
BEFORE INSERT ON client_employment
WHEN TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.employment_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.employment_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_employment.kind is not on the practice''s list of employment kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER client_employment_kind_is_on_its_list_update
BEFORE UPDATE OF kind ON client_employment
WHEN NEW.kind IS NOT OLD.kind
 AND TRIM(COALESCE(NEW.kind, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.employment_kinds')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.employment_kinds'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.kind,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_employment.kind is not on the practice''s list of employment kinds — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.kind);
END;

CREATE TRIGGER client_education_level_is_on_its_list_insert
BEFORE INSERT ON client_education
WHEN TRIM(COALESCE(NEW.level, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_levels')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_levels'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.level,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_education.level is not on the practice''s list of education levels — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.level);
END;

CREATE TRIGGER client_education_level_is_on_its_list_update
BEFORE UPDATE OF level ON client_education
WHEN NEW.level IS NOT OLD.level
 AND TRIM(COALESCE(NEW.level, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_levels')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_levels'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.level,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_education.level is not on the practice''s list of education levels — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.level);
END;

CREATE TRIGGER client_education_completed_is_on_its_list_insert
BEFORE INSERT ON client_education
WHEN TRIM(COALESCE(NEW.completed, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_outcomes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_outcomes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.completed,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_education.completed is not on the practice''s list of education outcomes — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.completed);
END;

CREATE TRIGGER client_education_completed_is_on_its_list_update
BEFORE UPDATE OF completed ON client_education
WHEN NEW.completed IS NOT OLD.completed
 AND TRIM(COALESCE(NEW.completed, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.education_outcomes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.education_outcomes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.completed,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_education.completed is not on the practice''s list of education outcomes — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.completed);
END;

CREATE TRIGGER client_travel_purpose_is_on_its_list_insert
BEFORE INSERT ON client_travel
WHEN TRIM(COALESCE(NEW.purpose, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_purposes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_purposes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.purpose,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_travel.purpose is not on the practice''s list of travel purposes — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.purpose);
END;

CREATE TRIGGER client_travel_purpose_is_on_its_list_update
BEFORE UPDATE OF purpose ON client_travel
WHEN NEW.purpose IS NOT OLD.purpose
 AND TRIM(COALESCE(NEW.purpose, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_purposes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_purposes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.purpose,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_travel.purpose is not on the practice''s list of travel purposes — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.purpose);
END;

CREATE TRIGGER client_travel_mode_is_on_its_list_insert
BEFORE INSERT ON client_travel
WHEN TRIM(COALESCE(NEW.mode, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_modes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_modes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.mode,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_travel.mode is not on the practice''s list of modes of travel — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.mode);
END;

CREATE TRIGGER client_travel_mode_is_on_its_list_update
BEFORE UPDATE OF mode ON client_travel
WHEN NEW.mode IS NOT OLD.mode
 AND TRIM(COALESCE(NEW.mode, ''), ' ' || CHAR(9) || CHAR(10) || CHAR(13)) <> ''
 AND EXISTS (SELECT 1 FROM vocabulary_terms WHERE setting_key = 'vocab.travel_modes')
 AND NOT EXISTS (SELECT 1 FROM vocabulary_terms
                  WHERE setting_key = 'vocab.travel_modes'
                    AND term_key = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      NEW.mode,
                      CHAR(9), ''), CHAR(13), ''), ' ', ''), '_', ''), '-', ''), '.', '')))
BEGIN
  SELECT RAISE(ABORT, 'client_travel.mode is not on the practice''s list of modes of travel — add it under Settings, Lists and dropdowns, or store a key from it. Value: ' || NEW.mode);
END;
