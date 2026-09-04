# A prompt for turning a Claude conversation into a file note

**What this is for.** The practice works cases with Claude — sometimes at length,
so that a conversation ends up knowing a great deal about a matter. This is the
prompt that gets that knowledge out in a shape the Client Register can use:
either to open a new matter, or to correct and extend one it already holds.

**How to use it.** At the end of a working conversation about a case, paste
everything between the two rules below. Nothing needs to be filled in first —
the prompt asks for what it needs. Then take the output to the register:

- **A new matter** → Tools → Assistant → *Open a matter*, and paste the whole
  output into "Or type or paste what you know". The register reads it, proposes
  a client and a matter, and you check every field before anything is saved.
- **An existing matter** → open the matter and paste the **File note** section
  into File notes. Anything under **Corrections** is typed into the fields
  yourself, because a note never edits a record.

**Why it is shaped like this.** The register's rule is that the AI proposes and
a person presses the button. This prompt is built to honour that: it produces
something to read and check, never something to apply. It is deliberately
agnostic — it carries everything Claude needs to know about the register inside
itself, so it works in a conversation with no access to anything.

---

You are helping an immigration-law practice in New Zealand record what this
conversation established, so it can go into their client register. The register
holds real client files, so the standard here is a professional file note: what
is known, how it is known, and what is not known.

**Produce three sections, in this order. Use the exact headings.**

## 1. File note

A note a lawyer would be content to find on the file in two years. Plain
sentences, no bullet-point shorthand, no headings inside it. Cover, in whatever
order reads naturally:

- what the matter is about, in a sentence;
- what was established in this conversation, and by what — a document seen, what
  the client said, what INZ wrote, or reasoning from instructions;
- what was advised, and what was agreed or decided;
- what happens next, and by when.

**Mark the standing of every fact as you go**, in the sentence itself, not in a
footnote. "Her passport expires 4 March 2028" and "she thinks her passport
expires some time in 2028" are different records, and the second must not be
written as the first. Where a date, a number or a name came from a document,
say which document. Where it came from the client, say so.

Never write a fact this conversation did not establish. If something important
is missing, that belongs in section 3, not invented here.

## 2. Register fields

Only the fields this conversation actually settled. **Omit any field you do not
know — do not write "unknown", "N/A" or an empty value**, because a blank in the
register means "nobody has asked yet" and a guess destroys that.

Write them as `field: value`, one per line, exactly these names:

**The person**
- `given_names` — all given names, in passport order
- `family_name` — leave out entirely if the person has only one name
- `preferred_name` — what they are actually called, if different
- `date_of_birth` — YYYY-MM-DD
- `email`
- `phone` — with country code if not New Zealand
- `nationality` — the country name, one per line if more than one
- `current_visa_type` — what they hold *now*, not what they are applying for
- `current_visa_expiry` — YYYY-MM-DD. If the grant says "N months after first
  arrival" and no date exists yet, put that wording in `visa_expiry_rule`
  instead and leave this out.
- `visa_expiry_rule` — the words, where there is a rule and no date

**The matter**
- `descriptor` — what this matter is about, in one line, as a person would say
  it. Not "SURNAME, Given — Work Visa". Something like "AEWV for a boner at
  AFFCO Manawatu, employer already accredited".
- `case_type` — one of the keys listed at the end of this prompt, or leave it
  out if none plainly fits
- `status` — one of: `lead`, `engaged`, `gathering_documents`, `preparing`,
  `ready_to_lodge`, `lodged`, `ppi`, `interim_visa`, `decision_pending`,
  `approved`, `declined`, `ipt_appeal`, `reconsideration`,
  `inz_investigation`, `on_hold`, `withdrawn`, `closed`
- `inz_client_number`, `inz_application_number`
- `lodged_at`, `decision_due_at`, `decided_at` — YYYY-MM-DD
- `summary` — two or three sentences of background, for someone picking the file
  up cold

**Other people on the matter** — for a partner, employer, sponsor or child, put
each under a `party:` line followed by their own fields:

```
party: supporting partner
  given_names: ...
  family_name: ...
  date_of_birth: ...
```

## 3. What is missing or uncertain

A short list, and this section is as valuable as the other two. Include:

- **facts the matter turns on that nobody has confirmed** — say what would
  confirm each one ("the visa expiry is from what the client remembers; the
  grant letter would settle it");
- **anything two sources disagree about**, with both versions and where each
  came from;
- **dates that were worked out rather than read** — say what they were worked
  out from;
- **anything the practice should ask the client**.

If there is nothing, write "Nothing outstanding." rather than omitting the
section.

---

**Rules that override anything else in this prompt.**

1. **Never invent, complete or tidy a fact.** Not a name, not a date, not a
   number, not a visa type. A gap belongs in section 3. This matters more than
   the output looking finished.
2. **Do not identify a person by name alone.** Two clients can share one, and
   one client can be spelled three ways. Where you say who someone is, say what
   makes them that person — a date of birth, a passport number, an INZ client
   number.
3. **Copy identifiers character for character.** Passport numbers, INZ numbers
   and file references are not to be normalised, spaced, hyphenated or
   case-corrected.
4. **Dates as YYYY-MM-DD**, always. A New Zealand document saying 04/09/2026
   means 4 September; an American one may not. If a date is ambiguous, say so in
   section 3 rather than choosing.
5. **Say what you were unsure of.** A note that admits its own gaps is worth
   more than one that reads cleanly and is wrong in one place nobody can find.
6. **Nothing here is applied automatically.** A person reads it and presses the
   button. Write for that person.

**The case types, as keys.** Use the key, not the label.

```
VISITOR      vv_general  vv_partner  vv_group  vv_business  vv_medical_treatment
             vv_guardian_of_student  vv_crew_seafarer  vv_other
STUDENT      sv_general  sv_partner  sv_dep_child  sv_exchange  sv_other
WORK         wv_aewv  wv_aewv_psv (peak seasonal)  wv_partner  wv_dep_child
             wv_post_study  wv_specific_purpose  wv_working_holiday  wv_seasonal
             wv_religious_worker  wv_talent_accredited_employer_legacy
             wv_long_term_skill_shortage_legacy  wv_other
RESIDENCE    rv_general  rv_permanent  rv_green_list_str  rv_green_list_wtr
             rv_smc  rv_rfw_talent  rv_rfw_religious_worker  rv_partner
             rv_parent  rv_dep_child  rv_refugee_family_support
             rv_active_investor_plus  rv_entrepreneur
             rv_employees_of_relocating_business  rv_samoan_quota
             rv_pacific_access_category
             rv_settlement_refugee_protected_person  rv_other
REQUESTS     rq_section_61_request  rq_ministerial_intervention
             rq_reconsideration_temporary_visa_decline  rq_privacy_act_request
             rq_status_of_person_request  rq_immigration_act_request_s_378
APPEALS      app_ipt_residence_appeal  app_ipt_deportation_appeal
RESPONSES    reply_ppi_response  reply_deportation_liability_response
             reply_deportation_order_response
VARIATIONS   voc_variation_work  voc_variation_study
             voc_variation_residence_travel_conditions
TRANSFERS    trnsf_transfer_to_new_passport
             trnsf_replacement_of_lost_damaged_visa
CITIZENSHIP  cz_citizenship_grant  cz_citizenship_confirmation
EMPLOYER     emp_employer_accreditation  emp_job_check
             emp_accreditation_renewal
OTHER        ot_advice_only  ot_second_opinion  ot_other
```

---

## Notes for the practice

- **The case-type list above is a copy.** It is the practice's own list as at
  4 September 2026. If a type is added under Settings → Vocabularies, add it
  here too, or the prompt will keep proposing the nearest old one.
- **The register never takes this straight in.** The intake tool reads it,
  proposes, and shows you every field to check. Nothing is written until you
  press the button — see the standing rule in `CLAUDE.md`.
- **Section 3 is the part to read first.** It is where a matter goes wrong
  quietly: a date somebody worked out from a filename, two documents that
  disagree, a fact everybody assumed. The register already keeps a warning for
  exactly this (a certificate date "worked out from an issue date never
  confirmed against the certificate"), and section 3 is where those come from.
- **This is not the batch-loading prompt.** For reading a folder of files into
  the register in bulk, use `docs/intake-prompt.md`, which is a different job
  with different rules.
