# Reading the practice folders

A prompt for a **separate** Claude Code session, pointed at the practice's own
files, that does two jobs at once:

1. **Extract** what the register can already hold, in a shape this repository can
   import.
2. **Report** what it found that the register has nowhere to put — so the
   register can grow towards the practice rather than the other way round.

This prompt has been through three real batches: 23 clients and 24 matters on
30 August 2026, a second on 31 August, and 170 clients with 148 matters on
1 September. Nothing below is hypothetical. Each rule exists because a run
needed it, and several exist because a run was refused mid-load without one.

**This is the only intake document.** There was briefly a second — a brief for
one particular batch — and the two drifted apart within a day, disagreeing about
how to identify a person. One document, edited per batch, is the arrangement.

---

## This batch

Edit this section for each run; everything below it is standing.

| | |
|---|---|
| **The folders** | `<PATH>` |
| **Tag** | `Bankside` — the practice's own files, worked without the business partners |
| **What it is** | `<current work \| closed archive \| mixed — say which>` |
| **Batches 04 and 05** | 04 is the current work; 05 is the archive, about 25 GB. Do 04 first and finish it before 05 begins, so the archive's identity matching runs against a register that already holds the current clients |

Everything currently in the register is tagged `omc`. Nothing in these batches
is.

**No counts live in this document.** An earlier version opened with how many
clients and matters the register held and what the next reference was. Every one
of those figures is owned by the fresh exports and by the loader, the extractor
has no use for the next reference at all, and a snapshot in a standing document
is exactly the staleness that killed the separate brief this one replaced. What
the register holds comes from `existing-clients.txt`, exported the day you run.

---

## Before you run it

**Run it outside this repository.** Real client data never enters the repo — not
in tests, fixtures, seeds, commit messages or example text. This was breached
twice on 1 September, once by using a client's name as a worked example in a code
comment. Make a working directory somewhere else and run the session there:

```
mkdir -p ~/register-intake && cd ~/register-intake
claude
```

Point it at a copy of the folders, not the originals, and keep the copy off any
synced drive you would not want an extraction log on.

**Bring the register's current state.** The register is live, so every batch
after the first is an increment, not a fresh start. Before running, export two
small lists from the register and put them in the working directory:

- `existing-clients.txt` — one line per client: ref, family name, given names,
  date of birth, INZ client number if known. **No passport numbers.** They stay
  out of bulk exports by a standing rule of the practice, and they are not
  needed here — see **Identity** below, where a passport number is corroboration
  and never the key.
- `case-type-keys.txt` — the current case-type keys from Settings (the
  vocabulary is editable there, so a pasted list in this file goes stale;
  export it fresh each time).

**Do a handful first.** Run it over five or six files, read the output line by
line against the originals, and only then let it walk the whole tree. An
extraction you have not spot-checked is a guess with a schema.

---

## The prompt

Copy everything between the rules.

---

You are reading the file folders of a New Zealand immigration practice so they
can be loaded into the practice's own register. Work carefully; this is client
material and the practice will rely on what you produce.

**The folders are at:** `<PATH>`
**The register already holds:** `existing-clients.txt` (in this directory)
**The register's case-type keys:** `case-type-keys.txt` (in this directory)
**This batch is:** `<current work | closed archive | mixed — say which>`

### What to do

Walk the tree. Work out what each folder is — one client, one matter, a mix, or
something else entirely. Do not assume a layout; report the one you find.

For each **person or organisation** you can identify, and each **matter**, pull
out the fields listed below. Then write three files into the working directory
(never into the folders you are reading):

- `clients.jsonl` — one JSON object per line, one per person or organisation
- `cases.jsonl` — one per matter, **ordered by `opened_on`, oldest first**
- `findings.md` — everything below under **What to report**

### What to read, and what to leave alone

The practice's instruction, 1 September 2026. Reading everything is not
thoroughness — it is how a large archive takes a fortnight and produces the same
answer.

**Start with the PREVIEW.** Almost every client folder holds a PDF whose name
begins `PREVIEW`. It is a snapshot of the application as it stood before
lodgement, produced so the client could read it and confirm it was accurate. It
is therefore the single richest document in the folder: full name as lodged,
date of birth, passport, nationality, address, the visa applied for, and the
answers to INZ's questions — all in one place, and all checked by the client.

Where a PREVIEW exists it is the source for the client's details, and the other
documents fill in what it does not say: when the matter was opened, when it was
lodged, and how it ended. Where there is no PREVIEW, work from the forms and
correspondence.

**Four cautions, and the first is the one this instruction creates.**

**A date read off a PREVIEW is `unverified`, never `verified`.** This section
steers you away from the certificate scans and towards the PREVIEW, so the
natural mistake is to record a PREVIEW-sourced certificate date as though it had
been read off the certificate itself. It has not: a PREVIEW is a form somebody
filled in, and the register computes legal deadlines from certificate issue
dates. Expect the count of unverified dates to grow, by design, and say so in
`findings.md`. See rule 4.

**A folder may hold several PREVIEWs.** One per application, and `v1`/`v2` of
each — batch 02 had a same-day v2 correcting transposed names. The **newest
version of the relevant application's PREVIEW** governs, and the client's
details come from the newest one of all. Where two disagree, say so, per rule 8.

**A PREVIEW does not mean the application was lodged.** It is produced *before*
lodging, so an abandoned application has one too. Status comes from receipts,
grants and correspondence — never from a PREVIEW existing.

**A PREVIEW is a snapshot before lodgement**, so where the issued visa or an INZ
letter disagrees with it, the later document is what happened. Record both and
flag it, per rule 8.

| Read | Why |
|---|---|
| The `PREVIEW` PDF | The application as lodged, confirmed by the client. Start here. |
| Submissions and cover letters | What the matter was actually about, in the practice's own words |
| The issued visa | The grant: type, conditions, dates. This is the outcome. |
| Engagement letters, authorities, INZ receipts | What dates the matter |
| Correspondence and file notes | Refusals, PPI letters, what went wrong |

**Do not read extraneous PDFs and pictures.** Scanned bundles, photographs,
identity documents already summarised in the PREVIEW, duplicated email
attachments, payslips, bank statements, employer packs. They will be most of the
bytes and almost none of the information, and the register has nowhere to put
them.

**Say what you skipped** in `findings.md` — folder and rough size — so the
practice knows what was passed over and can ask for a second look.

### Identity: when two records are the same person

The practice's decision, 1 September 2026. It replaced an earlier rule that
identified people by passport number, which was wrong in both directions.

> Two records are the same client only when the **full name agrees** and the
> **dates of birth do not disagree**. A differing date of birth is decisive —
> that is a different person, whatever else matches. A passport number is
> **corroboration and never the key**: the same person renews a passport and may
> hold a second nationality's, so two numbers do not make two people, and a
> number read off the wrong page does not make one.

Three answers, and only the first acts without asking:

| | |
|---|---|
| `same` | names agree, both dates present and equal → join them |
| `different` | names disagree, or the dates disagree → never join |
| `unknown` | names agree, one date missing → **stop and ask a person** |

Applied mechanically to batch 03 this rejected two proposed joins that were
wrong and found two that had been missed. What it means for you:

1. **Always report a date of birth where the folder gives one**, and say which
   document it came from. Without it the loader cannot confirm identity and has
   to stop and ask. Batch 03 produced seven such questions.

2. **`matches_existing` is a proposal, not a finding.** The loader checks every
   one against the register by name and date of birth, in both directions.
   Propose freely; give the evidence.

3. **Write names consistently.** Batch 03 wrote the same person as
   `GARCIA, Maria Luisa` in one folder and `Garcia, Maria Luisa` in another, and
   the first version of the loader treated them as two people. Give
   `family_name` and `given_names` as separate fields, always, and never rely on
   a full name being parsed.

4. **The same person in two folders is one record.** Merge them yourself where
   the folder makes it obvious, and say in `why` that you did.

5. **A person named in two folders under two names is a question, not a merge.**
   Record both spellings and flag it.

### Every matter needs its year

This is the thing batch 03 got wrong, and it cost the most to fix.

Batch 03 gave **every** matter a 2026 reference, because the loader asked the
2026 counter for a number. Ninety-one of the 148 had been opened in 2023, 2024
or 2025. A reference that says 26 for a matter opened in 2024 is wrong in the one
place a reference is meant to be right, and correcting it afterwards cost a
renumbering, a note on ninety-one files, and a permanent retirement of the
vacated numbers. **A retired reference is never reused.**

So report, for every matter, the date the practice opened it, and say where that
date came from:

```json
{
  "opened_on": "2024-11-05",
  "opened_on_provenance": "engagement_letter",
  "lodged_at": "2024-12-14",
  "decided_at": "2025-03-02"
}
```

| `opened_on_provenance` | Means |
|---|---|
| `engagement_letter` | a letter of engagement, retainer or authority, dated |
| `first_document` | the earliest dated document showing the practice at work on it — **not** the client's own passport or birth certificate |
| `folder_name` | the folder itself carries the date |
| `inz_receipt` | INZ's acknowledgement of lodgement |
| `inferred` | worked out from surrounding dates — say how in a note |
| `unknown` | **nothing in the folder shows when the practice started work on it** |

**Where nothing else dates a matter, take its year from the earliest document
that shows the practice was working on it** — the practice's decision,
1 September 2026, recorded as `first_document`.

That is not a guess. It is evidence, it is labelled as evidence, and anybody can
check it against the document later. A guess would be writing 2024 because the
matter *feels* old.

**Which document counts:** an engagement letter, an authority, correspondence, a
completed form, a file note, an invoice. **Not** the earliest dated thing of any
kind. A folder often holds a passport issued in 2019 or a birth certificate from
1994; those date the client, not the work, and taking a year from one would put a
matter years before the practice had heard of it. Where the only dated things are
the client's own documents, that is `unknown`.

**`unknown` is a real answer**, and it means: nothing here shows when the practice
started. A matter there keeps a current-year number, and that is honest — "we do
not know" is not 2025.

Where the folder gives a year but not a full date, give `"opened_on": "2024"`
rather than inventing a month and day.

**Order `cases.jsonl` by `opened_on`, oldest first**, so the loader can walk it in
order and allocate `CASE-24-001`, `CASE-24-002` and so on without sorting.
**Matters with no year sort last**, all together at the end: they take
current-year numbers, so they belong after everything that has a year of its
own. Put a
count per year at the top of `findings.md`:

```
Matters by year opened: 2021 — 4 | 2022 — 11 | 2023 — 26 | 2024 — 38
                        2025 — 51 | 2026 — 9 | unknown — 17
```

### The register already holds clients

Before creating a person, check them against `existing-clients.txt`, by the
identity rule above. A match is not a new client: set
`"matches_existing": "<their ref>"` on the object and still record everything you
found, so the register's copy can be checked and completed. Say in `findings.md`
how many matched and on what — counts, not names.

**Matching a person completes their record; it does not skip their folder.**
Their matters are extracted and loaded exactly as anybody else's. "A match is not
a new client" is about the *client* row, and nothing else — do not read it as
permission to drop the folder's matters on the ground that the practice already
knows the person. Only a **provably identical application** merges rather than
creating: the same INZ application number, or the practice confirming it. Where
you suspect two records are one matter but cannot prove it, create both and say
so.

Record the passport numbers you read from the folders as usual. The loader
checks each against what the register already holds and skips a document already
recorded — five of seven passports in batch 03 were the same document the
register held, and the sixth attempt to insert one stopped the load dead. Report
the **passport number** always; it is what makes that check possible. It
corroborates identity; it does not decide it.

### The fields the register holds

**A client** (`clients.jsonl`) — `kind` is `individual` or `organisation`:

```
kind, given_names, family_name, preferred_name, full_name (organisations only),
email, phone, whatsapp, telegram_username, nationalities, date_of_birth, address,
current_visa_type, current_visa_expiry, current_visa_expiry_rule,
english_test_type, english_test_score, english_test_date, nzbn, company_number,
notes
```

**`nationalities` is a list, not a value.** This changed on 31 August 2026. A
person may hold more than one, and dual nationality decides whether they need a
visa at all, which police certificates are required, and which passport an
application is made on. Write country names, in the order the documents name
them — `["Vietnam", "New Zealand"]` — and put the one the practice would name
first, first. A document saying "dual Vietnamese/New Zealand citizen" is naming
two: return both. One nationality is still a list of one.

**Countries are written as plain English names, everywhere.** Nationality, a
passport's `country`, a certificate's `country` — write `Vietnam`,
`New Zealand`, `Russian Federation`, in the document's own words, and let the
loader map them. Since migration 0055 the register stores all three as ISO
country codes with a trigger behind them, so `NZ`, `N.Z.` and `New Zealand`
cannot end up as three different countries — but that mapping is the loader's
job, not yours. Do not send a code.

**A country that no longer exists goes in a note, never in a country field.**
"Soviet Union" as a place of birth was a real case in batch 02. It is true, it
matters, and there is no code for it: record it in the note and leave the
country null rather than picking a successor state on the client's behalf.

**`current_visa_type` and `current_visa_expiry` apply to everybody**, not only
to the person the matter is for. A supporting partner is on a visa too, and
what visa they hold is often the point of the application. Record them for
every person the documents say holds one.

`current_visa_expiry_rule` is for an expiry the documents state as a rule
rather than a date — "36 months after first arrival in New Zealand" appeared in
the first batch. Record the rule in the document's words and leave the date
null; the register holds the rule until the date is known. Never turn a rule
into a date yourself.

**Employers and agents are organisations.** An employer named on a work-visa
application, or an agency the practice received the file from, is recorded as
an `organisation` client, with its NZBN if a document states one. The first
batch produced four of these.

**Passports** — a person may hold several; nest them under the client as
`passports`:

```
country, number, issued_on, expires_on, status (held | replaced | lost | cancelled)
```

Those four are the register's own words and the only ones it accepts — batch 02
sent `expired`, and the database refused it. A fifth word does not become a
fifth status; it stops the load. **An out-of-date passport is still
`held`**: the expiry date carries that fact, and `replaced` means a newer
passport has taken over from it. `cancelled` is a passport an authority has
cancelled.

Passport numbers are recorded exactly as written. They **corroborate** identity
and never decide it — see **Identity** above. Report every one you read: the
loader checks each against what the register already holds, and that check is
what stops a duplicate document killing a load.

**Certificates** — nest under the client as `certificates`:

```
kind (police | medical | chest_xray), subtype, country, reference,
issued_on, issued_on_provenance, submitted_on, notes
```

`issued_on_provenance` says where the issue date came from, and it is one of
exactly these four — the register's own words, and the only ones it accepts:

- `verified` — you read the date off the certificate itself;
- `from_filename` — the date exists only in the practice's file or folder name;
- `from_ocr` — a machine read it off a scan and no person has confirmed it;
- `unverified` — anywhere else, or you cannot tell.

This is a standing decision of the practice (30 August 2026): a police
certificate's expiry is *worked out* from its issue date, so a date nobody read
off the paper must never look like one somebody did. Anything but `verified` is
flagged in the register until a person checks it. A filename date is still worth
extracting — just never dress it up as read from the document.

Do **not** compute a certificate expiry. The register works it out from the
issue date and whether it was submitted, using INZ's rule. If a folder states an
expiry that disagrees with that rule, put the stated expiry in `notes` and say
so — that disagreement is itself worth knowing about.

**A matter** (`cases.jsonl`):

```
client (how you are identifying the client — the same string you used for them
        in clients.jsonl), descriptor, case_type, status, priority,
inz_application_number, inz_client_number, lodged_at, decision_due_at,
decided_at, outcome, next_action, next_action_due, summary,
opened_on, opened_on_provenance, closed_on
```

`opened_on` and `opened_on_provenance` are not optional — see **Every matter
needs its year** above. They decide the matter's reference, and a reference
cannot be corrected afterwards without retiring a number.

No fee fields. The practice enters fees by hand, by its own decision — see rule
12 — and a spec that lists ledger columns invites them to be filled in. A fee
you find in a folder still travels, as a note: the nested `fees` list below.

**`descriptor` is the matter's name, and there is no `title`.** This changed on
31 August 2026 and it is the field the first two batches got wrong, so read
this twice.

A matter is already shown beside its reference, its client and its type — three
columns that say who and what kind. The descriptor is the one thing they cannot
say: **what this particular matter is about.** "Fresh application, chef's role
with her current employer." "Partner of an AEWV holder, de facto basis."
"Reply to a PPI letter about the relationship evidence."

Do **not** write "OKONKWO, Chidi Amaka - Accredited Employer Work Visa". That is
the client column and the type column read back, and producing it for every
matter is exactly what made the earlier batches unreadable. If the only thing
you can honestly say is the client and the type, the folder has told you
nothing — say so in `findings.md` rather than filling the field with the two
facts already recorded elsewhere.

Keep it to one line, under 160 characters, and take it from what the folder
actually shows — the role and the employer, the ground of the request, which
application this is among several for the same person.

Statuses, in order: `lead`, `engaged`, `gathering_documents`, `preparing`,
`ready_to_lodge`, `lodged`, `ppi`, `interim_visa`, `decision_pending`,
`approved`, `declined`, `ipt_appeal`, `reconsideration`, `inz_investigation`,
`on_hold`, `withdrawn`, `closed`. Map the folder's own words (`Granted`,
`SUBMITTED`) to one of these, and keep the original wording in `summary` or a
note.

Two of these changed on 31 August 2026: `inz_rfi` is gone — a request for
further information and a PPI letter are both `ppi`, "PPI / RFI letter
received", and which kind it was belongs in the note recording the letter. And
`appeal` split into `ipt_appeal` (with the Tribunal) and `reconsideration`
(asking INZ again, or a s.61 request), because they are different places with
different clocks.

Use the keys in `case-type-keys.txt`. Where nothing fits, use `ot_other` and say
plainly in `findings.md` what the work actually was. Do not invent a key unless
the work is a recurring kind the register should learn — and then say what it
means, and list every invented key, because the practice decides what each
becomes before the load. Batch 01 invented two and both were mapped by the
practice; batch 03 invented two that had to be unpicked.

**Also collect, nested under the matter:**

- `parties` — anyone else on the file, with their role: partner, employer,
  dependent child, sponsor, agent, interpreter, lawyer, adviser. Counsel on the
  file who is not the practice's own assigned person goes down as lawyer or
  adviser.
- `notes` — dated file notes, each `{ occurred_at, body }`, in the words they
  were written in
- `tasks` — anything outstanding, each `{ title, details, due_at }`
- `documents` — filename, what it is, and the date on it. **Record documents;
  never copy them.** The practice's decision (31 August 2026): the intake does
  not carry files into the register — a file arrives there only when a person
  uploads or links it.
- `fees` — every invoice, receipt and fee mention, see below

**Fees** (`fees` under the matter) — the practice tracks what is owed in the
register, so collect every money document, not just a total:

```
kind (professional | disbursement | third_party), description, amount,
currency, gst (included | excluded | not_stated), invoice_number, dated,
paid (paid | unpaid | not_stated), paid_source, source
```

`paid_source` says where the paid/unpaid claim comes from — an actual receipt,
a folder name marked PAID, or a statement in correspondence. The first batch
found invoices existing in two renumbered versions, an invoice dated six weeks
before the grant it describes, and one INZ fee covering two matters in a single
figure. Do not reconcile any of that: record each document as it stands and
flag the contradiction. A fee the documents cannot settle becomes a task for
the practice, not a number in a ledger.

### Rules

1. **Never invent a value.** A field you cannot establish is `null`. The
   practice will be correcting this by hand; a blank costs a minute, a wrong
   date costs a matter.
2. **Cite everything.** Every object carries `"source"`: the file it came from
   and, for a PDF, the page. Anything that cannot be checked against a document
   will not be trusted, and should not be.
3. **Say how sure you are.** Every object carries `"confidence"`: `high`,
   `medium` or `low`, and a one-line `"why"` for anything not `high`.
4. **Dates as `YYYY-MM-DD`, and say where each date came from.** New Zealand
   documents write day-first; American forms write month-first. Where a date is
   ambiguous (`03/04/2024`) and the document does not settle it, use `null` and
   flag it. A date read from a filename or folder name rather than a document
   is usable but must say so; this applies to any dated field, not only
   certificates — when the only source is a name, note it.

   For a certificate the register stores this as `issued_on_provenance`, and it
   takes exactly one of four values. Use these words, so the loader does not
   have to guess what a fifth one meant:

   - `verified` — read off the certificate itself, by eye.
   - `from_ocr` — read off a scan by machine (see rule 5).
   - `from_filename` — taken from a file or folder name, never confirmed.
   - `unverified` — source unknown, or otherwise not confirmed.

   The register computes police and medical expiry from the issue date, and
   shows a caveat everywhere a date is anything but `verified`. That caveat is
   the whole point: a wrong date that looks confident is worse than a blank,
   because a blank prompts somebody to check.
5. **OCR is allowed, and must say it was OCR.** The second batch machine-read
   12 certificate dates off scans with no text layer, which is better evidence
   than a filename and worse than a person's eye. Never record an OCR reading
   as `verified`. Where the scan is poor enough that the reading is a guess,
   use `null` and raise a task rather than recording a number the register will
   then compute a legal deadline from.
6. **Names as written.** Record given names and family name separately, exactly
   as the passport or application form has them. Do not restyle, transliterate
   or reorder — the register does its own capitalisation. Where an application
   reverses the names against the passport, record both and flag it: the first
   batch found one, and it became a letter to INZ.
7. **Money in dollars, with the currency named.** Say whether a figure includes
   GST, and if the document does not say, record that it does not say.
8. **Do not resolve contradictions.** Where two documents disagree — two
   spellings, two birthdates, two addresses, two versions of an invoice —
   record both and flag it. That disagreement is a finding, and often the most
   useful one in the folder.
9. **Do not summarise a file note into nothing.** A note is the record of what
   was said at the time. Carry it across in its own words.
10. **The folder names are the practice's own status lines.** Read them as
    deliberate records, at `medium` confidence, citing the folder name as the
    source. Conventions the first batch established:
    - a leading `z ` on a sub-folder marks it superseded or parked;
    - `v1`, `v2` mark versions — the unprefixed highest version is current;
    - `PAID`, `INZ fee not paid yet` and similar are fee status;
    - `NEED TRANSL` marks a document awaiting translation (make it a task);
    - dates and reminders in names (`18y.o.inMar26`) are working notes — carry
    them, source them to the name, never promote them to document-read facts.
11. **A document about a different person is a client, not clutter.** A file
    belonging to someone else sitting in this client's folder — a copied
    precedent, a misfiled letter — gets three things: a note on this matter
    saying it is there, a client stub for the person it belongs to (matched
    against `existing-clients.txt` first), and a task to complete their record
    from the original. The first batch found one such letter, and it was a real
    client.
12. **Fees are facts on the timeline, not fee records.** The practice enters
    fees by hand. Where a folder shows an amount — an invoice, a receipt, a
    fee written in a name — record it as a note on the matter saying what the
    document said, and create no fee, invoice or quote row. The second batch
    carried 35 fee facts across this way and it is the settled arrangement.
13. **The owner is the loader's to supply, not yours.** The register refuses an
    ownerless matter — that is a database trigger, not a form check — but you
    have no way of knowing the practice's user accounts, so do not invent one
    and do not leave a name you guessed at. Record `assigned_to` only when a
    folder actually names who is running the matter, in the words it uses; the
    loader maps that to a user, and supplies the practice's default owner for
    every matter that does not name one.
14. **A person the register cannot name is a note, not a record.** A client
    row needs a name. Where a folder shows a person with no name recorded —
    "the applicant's daughter, about eleven, in Viet Nam" — put what is known
    in a note on the matter and raise a task to get the name, rather than
    inventing a placeholder that later reads as a real person.
15. **Record the presence of sensitive material without interpreting it.**
    Redacted risk-alert pages, ministerial or privacy-release bundles: note
    that they exist and where, and read nothing into the redactions.

### Warnings

A note beginning `Warning` becomes a warning standing on the person's file,
citing the matter it was read off. Batch 03 produced 25 this way and the
convention works. Keep it:

```
Warning: the applicant is paid $31.15 against a visa condition of $31.20.
Warning - previous refusal: Australian subclass 500 refused 14 March 2024,
per his own account in the engagement note.
```

**These figures are invented and were checked against the register before being
written here.** The first version of this document used a real wage figure and a
real refusal, copied out of production file notes. No name was attached, and it
was still a breach: a distinctive figure identifies a file the long way round.
Invent your examples, and check them.

Two things make a warning worth having:

- **State the fact, with its date and figure.** "Previously refused a visa" is a
  sentence nobody reads twice. "Visitor visa refused 10 July 2025" is one they
  act on.
- **Put it on the matter it came from**, not on a general note. The citation is
  what lets somebody check it a year later.

A warning is not the same as a declined matter: the loader already raises one for
every matter recorded as `declined`. Yours are for what the structure does not
say — a character issue, a condition breach, a name discrepancy, a deportation
liability, an adverse INZ history.

### What batch 03 got wrong, so you do not

**A file uplift is not a matter.** It is a note on the matters uplifted. Same for
an identity certification. Record them as notes and say which matter they belong
to.

**An INZ investigation is not a kind of work.** It is a *status* a matter is in,
whatever the application underneath was. Use the `inz_investigation` status; do
not invent a case type for it.

**There are no class actions.** A folder that looks like one is a document
written to help other people, not a matter. Do not load it; report it.

**Do not invent a case type where `ot_other` will do.** If nothing in
`case-type-keys.txt` fits, use `ot_other` and say plainly in `findings.md` what
the work actually was. Two invented types in batch 03 had to be unpicked.

### If this batch is a closed archive

**Every matter is closed, and raises no alert and no task. Warnings only, where a
warning is warranted.** The practice's instruction, 1 September 2026. An archive
is history: a file finished in 2022 must not appear on tomorrow morning's Alerts
page or put a task in anybody's list.

Three rules follow, each checked against the register's own alert queries rather
than assumed:

1. **Every matter carries a finished status** — `approved`, `declined`,
   `withdrawn` or `closed`. Never a working status. Every deadline, gone-quiet
   and no-room-to-act alert is gated on those, so one archive matter left open
   puts a 2022 file on tomorrow's list.

2. **A matter recorded as `approved` or `declined` must carry its decision
   date.** This is the one alert a *closed* matter can still raise: the register
   flags "does not add up" when a matter says approved or declined and has no
   `decided_at`, whatever its status, because that combination is usually a
   half-finished edit. **If the folder gives no decision date, use `closed` and
   say in the note how it ended.** The register already carries matters in
   exactly that position from an earlier batch, and each one is a standing alert
   until somebody dates it by hand.

   And never give a decision date earlier than the lodgement date. That is the
   same alert, and in an archive it usually means two dates read off different
   documents.

3. **Create no tasks and no follow-ups.** Not one. If something in an archived
   folder genuinely needs doing, it is not an archive matter — report it and the
   practice will open it as a current file.

**Archive clients are `archived`** unless they are already in the register as a
current client, in which case they stay `active` and the current matter is why.
Passport, visa and certificate expiry alerts are raised per *client*, not per
matter, and the query skips archived clients — so an archive client loaded
`active` with a passport that expired in 2021 puts an expiry alert on the
practice's page.

### If the batch is very large

Twenty-five gigabytes is not a normal batch with more folders in it. It fails
differently, and it fails late, after hours of reading.

**1. Survey before you read.** The first pass produces no extraction at all:
walk the tree and write `inventory.md` — how many top-level folders, how deep,
total size, the biggest twenty folders and what they are, and a count of the
file types. The practice needs to see that before committing to the read, and so
do you: it is what says whether this is 300 matters or 3,000.

**2. Work in slices, and finish each one.** Produce a complete
`clients.jsonl`, `cases.jsonl` and `findings.md` per slice. A slice that is
finished is loaded and done; a single 3,000-matter extraction that stops
two-thirds through leaves nothing usable and nothing to resume from.

**How big is a slice?** Two things bind it, and neither is a number you can know
in advance:

- **A slice must extract in one sitting**, without the session running out of
  room. Document-heavy folders fill it faster than thin ones.
- **A slice must load as one set of files.** Batch 03's 148 matters produced a
  764 KB SQL file that D1 refused whole and had to be split into seven.

So: **at most 150 matters, and fewer where the folders are heavy.** 150 is a
ceiling taken from the one batch that has been through this, not a target to aim
at. Split by top-level folder or by year, whichever the tree makes natural.

Name the files so the slice is obvious (`05a-clients.jsonl`), and give **each
slice its own id prefix** in the loader (`cli_b05a_0001`), so re-running one
cannot touch another's rows.

**3. Extract ahead if you like; load strictly in order.** The same person will
appear in more than one slice, and the temptation is to make the whole job
serial to catch it. That is not necessary, because the loader already does the
catching: `matches_existing` is a proposal, and the loader re-checks every
identity against the register in both directions at load time. So a person slice
B calls new, who in fact arrived with slice A, is caught when B loads — provided
**the loads run in slice order**.

Extraction may therefore run ahead, or in parallel, as convenient. What the
extraction must not do is reason across slices: you cannot see the register from
there, so do not try. Report your proposals and let the load decide.

**The one thing that genuinely gates a load:** an identity the rule returns
`unknown` for needs the practice's answer before that slice loads. Put those in
`findings.md` as a list, early, so the answers can be got while you extract the
next slice.

**4. Do not read what you do not need**, per **What to read** above, and say what
you skipped.

**And the honest possibility:** if the survey shows the archive is mostly
material with no matter behind it — old drafts, precedents, copies of things
already loaded — say so. Not everything in 25 GB belongs in a client register,
and finding that out in the first pass is a good result, not a failure.

### What to report

`findings.md`, for the practice and for whoever maintains the register. It must
contain **no client data**: no names, no numbers, no dates that belong to a
person. Describe shapes, not values.

1. **The layout you found.** How the folders are organised, how consistently,
   and where the exceptions are — including any naming conventions beyond
   those listed in rule 10, so the list can grow.
2. **Counts.** How many clients, matters, notes, documents; how many clients
   matched the register and on what; how many of each field you could fill,
   and how many you had to leave null; how many dates came from filenames
   rather than documents.
3. **What has no home in the register.** The important half. For each kind of
   information you kept finding that none of the fields above would hold:
   - what it is, in the practice's own words
   - roughly how often it appeared, and in what kind of folder
   - what shape it has — a date, a reference, a free note, a repeating list, a
     yes/no, a document
   - what question it answers that the register currently cannot
   - whether it belongs to a person, a matter, a document, or the practice
   - an **invented** example of the shape, never a real one

   Rank these by how often they appeared and how badly their absence would hurt.
4. **What the register asks for that the folders do not have.** Equally useful:
   a field nobody ever records is a field to reconsider.
5. **Anything that looked wrong.** Dates that contradict each other, a
   certificate expiry that disagrees with INZ's rule, a matter with no visible
   outcome, an invoice in two versions, a document that appears in two folders.
   Describe the pattern and how many times it occurred; name no client.
6. **What you could not read.** Scans without text, formats you could not open,
   folders you skipped and why.
7. **Every case-type key you invented**, with what it means, so the practice
   can map each one before the load, and everything you had to force into
   `ot_other`.
8. **The per-year table** of matters opened, first thing in the file.
9. **Every `opened_on_provenance: unknown`**, with the matter and what you
   looked at. If that number is large, the practice may prefer to date them by
   hand rather than lose the year. Also count how many took their year from
   `first_document` rather than a dated engagement — that is the practice's
   measure of how much of the numbering rests on inference.
10. **Every client with no date of birth**, because each one is a question the
    practice has to answer before the load can join them to an existing file.
11. **What you skipped and why** — folder and rough size — so the practice can
    ask for a second look at any of it.

### How to work

Do a first pass over a sample of about twenty files and write `findings.md`
before extracting anything. Show the practice your reading of the layout and let
them correct it. Extract the whole tree only once that reading is agreed.

Do not modify, move, rename or delete anything in the folders you are reading.

Do not write to the register. You produce files; a separate session rehearses
them on a scratch database and loads them.

### What not to do

- **Do not guess a date of birth or a nationality.** `unknown` is a finding; a
  guess is a fault that survives. A year taken from the earliest working
  document is not a guess — it is evidence, and it is labelled as such. A year
  taken from a feeling about the folder is a guess.
- **Do not merge two people because their names match.** Names match. Dates of
  birth decide.
- **Do not put real client data anywhere except the extraction files.** Not in
  `findings.md` examples, not in commit messages, not in notes to yourself. Use
  a reference — `CL-9001`, `matter 14` — or an invented name. A bare reference
  is the right way to point at a client without naming them; a reference *plus*
  facts about that client is naming them the long way round.

---

## What happens next

`clients.jsonl` and `cases.jsonl` go into the register through a load that is
rehearsed on a scratch database **seeded from what production actually holds,
table for table** — not a convenient subset. Batch 03's rehearsal carried users,
counters, clients and cases but no passports, so every way the incoming batch
could collide with existing data was invisible to it, and the load stopped
halfway through against production on a constraint the rehearsal had no rows to
violate. The rehearsed SQL, not a re-derivation of it, is what runs against
production.

Questions the extraction raises — invented case types, contradictions, matters
with no visible outcome, identities the rule returns `unknown` for — go to the
practice as one list *before* the load, and the practice's answers are what the
loader implements. Several standing answers were settled this way and are now in
the rules above: dates from filenames must say so; a misfiled document becomes a
client; identity is name and date of birth, never the passport number.

`findings.md` section 3 is a list of columns the register does not yet have,
ordered by how much they are missed, in a form that can be read without exposing
a single client. That is what we work from when we decide what to build next: the
practice's actual paperwork rather than a guess about it. It is half the point of
the exercise — batch 03's report is why warnings, the `inz_investigation` status
and the `Brief` document category exist.

## What the register can hold now that it could not for batch 03

- **A warning on a client or matter**, with a life (standing, or 30/90/180/365
  days), citing the matter it came from, and editable afterwards.
- **`inz_investigation`** as a case status.
- **`Brief`** as a document category.
- **A matter's own description**, separate from its title.
- **Any number of nationalities and passports** per client.
- **Police and medical certificates**, with provenance on the issue date.
- **Matters numbered by the year they were opened**, each year with its own
  counter.
- Knowledge-base articles numbered by year — `KB-26-001`.
