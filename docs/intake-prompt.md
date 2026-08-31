# Reading the practice folders

A prompt for a **separate** Claude Code session, pointed at the practice's own
files, that does two jobs at once:

1. **Extract** what the register can already hold, in a shape this repository can
   import.
2. **Report** what it found that the register has nowhere to put — so the
   register can grow towards the practice rather than the other way round.

This prompt has been through one real batch (23 clients, 24 matters, loaded
30 August 2026). The rules below that cite that batch are not hypothetical:
each one exists because the first run needed it.

---

## Before you run it

**Run it outside this repository.** Real client data never enters the repo — not
in tests, fixtures, seeds or commit messages. Make a working directory somewhere
else and run the session there:

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
  date of birth, passport number(s), INZ client number if known.
- `case-type-keys.txt` — the current case-type keys from Settings (the
  vocabulary is editable there, so a pasted list in this file goes stale;
  export it fresh each time).

**Say what the batch is.** Tell the session whether these folders are current
work, closed archive, or a mix — statuses land wrong otherwise.

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
- `cases.jsonl` — one per matter
- `findings.md` — everything below under **What to report**

### The register already holds clients

Before creating a person, check them against `existing-clients.txt` — by
passport number first, then INZ client number, then family name with date of
birth. A match is not a new client: set `"matches_existing": "<their ref>"` on
the object and still record everything you found, so the register's copy can be
checked and completed. Say in `findings.md` how many matched and on what.

The first batch found the same person appearing in two places under differently
ordered names; the passport number is what settled it. Names do not identify a
person here — documents do.

### The fields the register holds

**A client** (`clients.jsonl`) — `kind` is `individual` or `organisation`:

```
kind, given_names, family_name, preferred_name, full_name (organisations only),
email, phone, whatsapp, telegram_username, nationality, date_of_birth, address,
current_visa_type, current_visa_expiry, current_visa_expiry_rule,
english_test_type, english_test_score, english_test_date, nzbn, company_number,
notes
```

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
country, number, issued_on, expires_on, status (held | with_inz | expired | lost)
```

Passport numbers are recorded exactly as written. They identify people across
folders — see matching above.

**Certificates** — nest under the client as `certificates`:

```
kind (police | medical | chest_xray), subtype, country, reference,
issued_on, issued_on_source, submitted_on, notes
```

`issued_on_source` is one of:

- `document` — you read the date off the certificate itself;
- `filename` — the date exists only in the practice's file or folder name;
- `other` — anywhere else (a covering letter, a checklist, an email).

This is a standing decision of the practice (30 August 2026): a date that did
not come from the document itself must be verified by a person before it is
relied on, and the register flags it until someone does. So a filename date is
still worth extracting — just never dress it up as read from the document.

Do **not** compute a certificate expiry. The register works it out from the
issue date and whether it was submitted, using INZ's rule. If a folder states an
expiry that disagrees with that rule, put the stated expiry in `notes` and say
so — that disagreement is itself worth knowing about.

**A matter** (`cases.jsonl`):

```
client (how you are identifying the client — the same string you used for them
        in clients.jsonl), title, descriptor, case_type, status, priority,
inz_application_number, inz_client_number, lodged_at, decision_due_at,
decided_at, outcome, next_action, next_action_due, summary,
fee_quoted, fee_agreed, currency, opened_on, closed_on
```

Statuses, in order: `lead`, `engaged`, `gathering_documents`, `preparing`,
`ready_to_lodge`, `lodged`, `inz_rfi`, `ppi`, `interim_visa`,
`decision_pending`, `approved`, `declined`, `appeal`, `on_hold`, `withdrawn`,
`closed`. Map the folder's own words (`Granted`, `SUBMITTED`) to one of these,
and keep the original wording in `summary` or a note.

Use the keys in `case-type-keys.txt`. Do not force a matter into a type that
does not fit: invent a key, say what it means, and list every invented key in
`findings.md` — the practice decides what each becomes before the load. The
first batch invented two (an eligibility assessment that concluded no
application could be made, and a Privacy Act request), and both were mapped by
the practice, not by the extractor.

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
13. **Every matter has an owner.** The register refuses an ownerless matter,
    so `assigned_to` is required on every case. Where the folder does not say,
    use the practice's default owner rather than leaving it out — a matter
    that will not load helps nobody.
14. **A person the register cannot name is a note, not a record.** A client
    row needs a name. Where a folder shows a person with no name recorded —
    "the applicant's daughter, about eleven, in Viet Nam" — put what is known
    in a note on the matter and raise a task to get the name, rather than
    inventing a placeholder that later reads as a real person.
15. **Record the presence of sensitive material without interpreting it.**
    Redacted risk-alert pages, ministerial or privacy-release bundles: note
    that they exist and where, and read nothing into the redactions.

### What to report

`findings.md`, for the practice and for whoever maintains the register. It must
contain **no client data**: no names, no numbers, no dates that belong to a
person. Describe shapes, not values.

1. **The layout you found.** How the folders are organised, how consistently,
   and where the exceptions are — including any naming conventions beyond
   those listed in rule 9, so the list can grow.
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
   can map each one before the load.

### How to work

Do a first pass over a sample of about twenty files and write `findings.md`
before extracting anything. Show the practice your reading of the layout and let
them correct it. Extract the whole tree only once that reading is agreed.

Do not modify, move, rename or delete anything in the folders you are reading.

---

## What happens next

`clients.jsonl` and `cases.jsonl` go into the register through an import run
that reuses the register's own code paths, so every database rule applies to
the arriving rows. The run is rehearsed on a scratch copy of the live database
and verified — row counts, matching, provenance flags — before the identical
SQL touches production. That machinery exists from the first batch; each new
batch reuses it, it does not get rewritten.

Questions the extraction raises — invented case types, contradictions, matters
with no visible outcome — go to the practice as one list *before* the load, and
the practice's answers are what the loader implements. The first batch settled
several standing answers this way (dates from filenames must be verified;
identify people by passport; a misfiled document becomes a client), which are
now baked into the rules above.

`findings.md` section 3 is a list of columns the register does not yet have,
ordered by how much they are missed, in a form that can be read without
exposing a single client. That is what we work from when we decide what to
build next: the practice's actual paperwork, rather than a guess about it.
