---
name: case-to-register
description: Turn a working conversation about one immigration matter into a handover the Client Register can read — a detailed summary, the client and matter fields, everyone involved, the flags, and what is still unknown. Use when the practice says "prepare this for the register", "write this up for the register", "register handover", or is about to open a matter from a conversation.
---

# Preparing a case for the Client Register

**One conversation, one matter.** By the time this runs, this chat usually knows
more about the matter than any single document does. The job here is to get that
out in one piece, in a shape the register will read correctly, without inventing
anything to fill a gap.

**The register is live and holds real client files.** A confident wrong date does
more damage than an admitted blank, because a blank means "nobody has asked yet"
and a wrong date means "somebody checked". That distinction is the whole
discipline of this skill.

---

## What happens to what you write

The practice pastes your output into **Assistant → Open a matter** in the Client
Register. The register reads it, proposes a client record and a matter with the
boxes filled in, and shows the practice a form. **Nothing is saved until a person
presses the button.** You are writing for that form and for the person checking
it — not for a database.

Three consequences, and they shape everything below:

1. **Write the register's own keys, and write them alone.** The form pre-fills a
   dropdown only when it gets a value matching one of its keys exactly.
   `wv_aewv` fills the box; `AEWV` leaves it empty, and so does
   `wv_aewv (WV. AEWV)` — the whole of what follows the colon is compared. So:
   the key, nothing else on the line. The person checking sees the plain label
   in the dropdown; they do not need it from you.
2. **The summary you write is kept twice** — as the matter's summary, which
   somebody may later edit, and as a **file note, which is permanent and cannot
   be altered**. Write it as a note you would be content to find on the file in
   two years.
3. **Some things the register will not take from text at all** — flags, passport
   numbers, fees. Those go in a separate section for a person to enter by hand.
   Say so plainly rather than burying them in prose.

---

## Before you write

Settle three things from the conversation. If any cannot be settled, that is a
line in **What is still unknown**, not a guess.

- **What kind of matter is this?** One key from the case-type list at the end.
  If two fit, choose the narrower and say why in one line. If none fits, leave
  it out.
- **Who is who?** Name every person the matter involves and give each a role
  key. The principal applicant is the person the matter is *for*, which is not
  always the person doing the talking.
- **What is dated, and what is only remembered?** A date read off a grant letter
  and a date the client thinks is about right are different records. Only the
  first goes in a date field.

---

## What to produce

Five sections, these exact headings, in this order.

---

### 1. Matter

```
descriptor: <one line, at most 200 characters>
case_type: <key alone>
status: <key alone>
inz_client_number: <as written, or omit>
inz_application_number: <as written, or omit>
lodged_on: YYYY-MM-DD (or omit)
decision_due_on: YYYY-MM-DD (or omit)
```

**`descriptor` is the most-read line in the register** — it is what the practice
sees in every list. Write what this matter is about the way a colleague would
say it: *"AEWV for a boner at WAIRAU VALLEY PACKERS Manawatu, employer already accredited"*, not
*"SURNAME, Given — Work Visa"*. The client's name and the matter type are
already in the columns beside it; do not repeat them.

**`status` is for the person, not the machine.** The register sets the status
box itself — *Lodged with INZ* if a lodgement date was found, *Engaged* if not —
so give the status you actually believe and expect whoever is checking to set it
from your line.

**`decision_due_on` is a date INZ or an instruction gave.** Never a date you
worked out from an average processing time. An invented deadline is worse than
none — it will raise a task and be trusted.

Omit any line you do not know. Do not write `unknown`, `N/A` or an empty value:
in this register a blank means "nobody has asked yet", and a placeholder
destroys that.

---

### 2. People

The applicant first, then everyone else, each as a block. Up to eight others;
if there are more, keep the ones on the matter and list the rest in the summary.

```
--- applicant ---
role: principal_applicant
given_names: <all given names, passport order>
family_name: <as the documents write it — keep the capitals if they use them>
preferred_name: <what they are actually called, if different>
date_of_birth: YYYY-MM-DD
email:
phone: <with country code if not New Zealand>
nationality: <country name; one line per nationality if more than one>
current_visa_type: <key alone — what they hold NOW, not what they seek>
current_visa_expiry: YYYY-MM-DD

--- party ---
role: supporting_partner
given_names: ...
```

- **`family_name`** — leave the line out entirely if the person has only one
  name. The register accepts that; a family name invented to fill the box does
  not come out again.
- **`nationality`** — the country name in full ("Viet Nam", "New Zealand"). One
  line each for dual nationality; the register resolves them and will show a
  blank rather than a wrong guess if it cannot.
- **`current_visa_type`** — what they hold today. A supporting partner's visa
  matters as much as the applicant's; give it if the conversation established
  it.
- **Never write a passport number.** The register deliberately does not read
  them from text. If one matters, name it in section 5 as something to enter by
  hand.
- **Occupation, and anything else not in the list above, goes in the Summary.**
  The form has boxes only for the fields listed here; anything else you put in a
  field line is read and then dropped. The Summary is kept in full, so that is
  where the rest of what is known belongs.
- **Every party is created as a person.** An employer or an institute has no
  organisation record here, so naming a company as a party creates a client
  record with the company's name on it. Better: name the organisation in the
  Summary, and give a party block only for a *person* there — the contact,
  the director — with role `employer` or `sponsor`.

---

### 3. Summary

**This is the file note, and it is the part worth most.** Continuous prose, no
bullets, no headings inside it. At most about 8,000 characters — roughly three
pages. Everything the conversation established about these people and this
matter, so that a colleague could read this instead of the file:

- what the matter is about and where it has got to;
- the relationship history, previous marriages and their dates, children and
  where they live, addresses, employment — whatever is relevant and established;
- what INZ has said, and when;
- any character, health or compliance matter that has come up;
- what was advised, what was agreed, and what happens next.

**Mark the standing of every fact in the sentence itself.** *"Her passport
expires 4 March 2028 (grant letter, seen 2 September)"* and *"she thinks her
passport expires some time in 2028"* are different records, and the second must
never be written as the first. Where a fact came from a document, name the
document. Where it came from the client, say so.

**Write nothing this conversation did not establish.** A gap belongs in section
4. This matters more than the note reading as though it is finished.

---

### 4. What is still unknown

A short list — at most twelve lines, because that is what the register shows
back as a warning. This section is as valuable as the summary; it is where a
matter goes wrong quietly.

- **Facts the matter turns on that nobody has confirmed**, each with what would
  confirm it: *"the visa expiry is from what the client remembers; the grant
  letter would settle it"*.
- **Anything two sources disagree about**, with both versions and where each
  came from.
- **Dates worked out rather than read**, saying what they were worked out from.
- **Anything the practice should ask the client.**

If there is genuinely nothing, write "Nothing outstanding." rather than dropping
the section.

---

### 5. To enter by hand

Things the register will not take from pasted text. Keep this short and
specific, because somebody is going to work through it with the file open.

**Flags** — a warning that shows on the client or the matter every time it is
opened. The register does not create these from text: they are added on the
client or case page. Propose one only where the conversation actually supports
it, as:

```
flag: <kind key> — <what somebody opening this file needs to know, in one or two sentences>
```

Flag kinds: `safety`, `character`, `health`, `immigration`, `contact`, `money`,
`other`. Use `safety` for anything about the physical safety of a person or of
whoever meets them; `contact` for how to make contact (an interpreter, a number
that must not be used, a time of day); `immigration` for a history that will
follow the file — a previous decline, a deportation liability, a section 61.

**Also list here**, where they apply: passport numbers and their expiry dates;
fees agreed or paid; documents the practice holds that should be uploaded;
tasks with a date that ought to be raised.

---

## Rules that override anything else here

1. **Never invent, complete or tidy a fact.** Not a name, not a date, not a
   number, not a visa type. A gap goes in section 4.
2. **Do not identify a person by name alone.** Two clients share a name and one
   client is spelled three ways. Where you say who somebody is, say what makes
   them that person — a date of birth, an INZ client number.
3. **Copy identifiers character for character.** INZ numbers and file references
   are not to be normalised, spaced, hyphenated or case-corrected.
4. **Dates as YYYY-MM-DD, always.** A New Zealand document saying 04/09/2026
   means 4 September; an American one may not. If a date is ambiguous, say so in
   section 4 rather than choosing.
5. **Nothing here is applied automatically.** A person reads it and presses the
   button. Write for that person.
6. **Do not give immigration advice in this output and do not draft
   correspondence.** This is a record of what is known, not a next step.

---

## How the practice uses it

1. Copy the whole output.
2. Register → **Tools → Assistant → Open a matter**.
3. Paste it into **"Or type or paste what you know"** (up to 40,000 characters).
   Source documents can be attached on the same page — up to 5 files, 8 MB each:
   Word, PDF, text, CSV, HTML, JSON, .eml, PNG, JPEG, GIF, WebP.
4. Press **Read it**, then check every box on the form that comes back. The
   register shows section 4 as a warning banner.
5. Press **Open the matter**. The register creates the client, the matter and
   the other parties, and keeps the summary as a permanent file note.
6. Work through **section 5** by hand: flags on the client or matter, passport
   details, fees, documents, tasks.

---

## After it is approved — record it back here

Once the matter exists, the practice pastes its references back into this chat,
and you record this block at the end of the conversation so the matter can be
found again:

```
REGISTER RECORD
client: CL-#### <full name>
matter: CASE-##-### <descriptor>
type: <case_type key>
status: <status key>
opened: YYYY-MM-DD
entered by hand: <flags raised, documents uploaded, anything from section 5>
still unknown: <what was carried over from section 4>
```

From then on, anything new in this conversation is an **update** to that matter,
not a new one. Say which matter it belongs to, and produce only the sections
that changed — a fresh Summary paragraph for a file note, plus any field that is
now known. The register never edits a file note; a correction is a new note that
says what it corrects.

---

## Reference lists

These are the practice's own lists as at 6 September 2026. They are editable in
the register under **Settings**, so if a list there changes, change it here too
or this skill will keep proposing the nearest old one.

### Case types — use the key

```
vv_general | VV. General
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
wv_aewv_psv | WV. AEWV Peak Seasonal
wv_partner | WV. Partner
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
rv_partner | RV. Partner
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
ot_other | OT. Other
```

### Roles on a matter

```
principal_applicant   | Principal applicant
secondary_applicant   | Secondary applicant
supporting_partner    | Supporting partner (the application turns on the relationship)
partner               | Partner (the applicant's partner, not part of the application)
dependent_child       | Dependent child
family_member         | Family member (any other relative, not applying)
employer              | Employer (the organisation itself)
director              | Director (the person who signs for a company)
sponsor               | Sponsor
agent                 | Agent or representative
lawyer                | Lawyer (not this practice — prior or opposing counsel)
adviser               | Adviser
other                 | Other party
```

### Matter status — where the file has got to

```
lead                 | Enquiry turned into a matter, not yet engaged
engaged              | Engaged, work not yet started
gathering_documents  | Collecting what is needed
preparing            | Preparing the application
ready_to_lodge       | Ready to lodge
lodged               | Lodged with INZ
ppi                  | PPI / RFI letter received
interim_visa         | Interim visa / awaiting decision
decision_pending     | Decision pending
approved             | Approved
declined             | Declined
ipt_appeal           | IPT appeal
reconsideration      | Reconsideration
inz_investigation    | Under INZ investigation
on_hold              | On hold
withdrawn            | Withdrawn
closed               | Closed
```

If the conversation says an application has been lodged, use `lodged` and give
`lodged_on`. If nothing has been lodged and the practice is engaged, `engaged`
is the honest default.

### Current visa — what a person holds now

```
vv_visitor | VV. Visitor
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

unknown | Not established yet
```

`none_offshore`, `none_unlawful` and `none_expired` are real answers and more
useful than a blank. `unknown` says the question has been asked and not settled,
which is different again from leaving the line out.

### Flag kinds

```
safety      | Safety
character   | Character or conviction
health      | Health
immigration | Immigration history
contact     | How to make contact
money       | Money
other       | Other
```

---

## A worked shape

Not a real matter — the shape only.

```
### 1. Matter
descriptor: AEWV for a boner at WAIRAU VALLEY PACKERS Manawatu, employer already accredited
case_type: wv_aewv
status: gathering_documents
inz_client_number: 12345678

### 2. People
--- applicant ---
role: principal_applicant
given_names: Hemi Rangi
family_name: TAWHAI
date_of_birth: 1991-04-02
phone: +64 21 555 0142
nationality: Samoa
current_visa_type: wv_aewv
current_visa_expiry: 2027-01-18

--- party ---
role: supporting_partner
given_names: Ana Lefau
family_name: TAWHAI
date_of_birth: 1993-11-30
nationality: New Zealand
current_visa_type: other_citizen_nz
```

Then the Summary in prose — where the employer, the role, the occupation and
everything else that has no box of its own belongs — then What is still unknown,
then To enter by hand.
