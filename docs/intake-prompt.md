# Reading the practice folders

A prompt for a **separate** Claude Code session, pointed at the practice's own
files, that does two jobs at once:

1. **Extract** what the register can already hold, in a shape this repository can
   import.
2. **Report** what it found that the register has nowhere to put — so the
   register can grow towards the practice rather than the other way round.

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

### What to do

Walk the tree. Work out what each folder is — one client, one matter, a mix, or
something else entirely. Do not assume a layout; report the one you find.

For each **person or organisation** you can identify, and each **matter**, pull
out the fields listed below. Then write three files into the working directory
(never into the folders you are reading):

- `clients.jsonl` — one JSON object per line, one per person or organisation
- `cases.jsonl` — one per matter
- `findings.md` — everything below under **What to report**

### The fields the register holds

**A client** (`clients.jsonl`) — `kind` is `individual` or `organisation`:

```
kind, given_names, family_name, preferred_name, full_name (organisations only),
email, phone, whatsapp, telegram_username, nationality, date_of_birth, address,
current_visa_type, current_visa_expiry, english_test_type, english_test_score,
english_test_date, nzbn, company_number, notes
```

**Passports** — a person may hold several; nest them under the client as
`passports`:

```
country, number, issued_on, expires_on, status (held | with_inz | expired | lost)
```

**Certificates** — nest under the client as `certificates`:

```
kind (police | medical | chest_xray), subtype, country, reference,
issued_on, submitted_on, notes
```

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
`closed`.

Case types are configurable in the register, so use a short descriptive key —
`wv_aewv`, `rv_partner`, `s61`, `ppi_response`, `appeal_ipt` and so on — and
list every key you used in `findings.md`. Do not force a matter into a type that
does not fit; invent a key and say what it means.

**Also collect, nested under the matter:**

- `parties` — anyone else on the file, with their role (partner, employer,
  dependent child, sponsor, agent, interpreter)
- `notes` — dated file notes, each `{ occurred_at, body }`, in the words they
  were written in
- `tasks` — anything outstanding, each `{ title, details, due_at }`
- `documents` — filename, what it is, and the date on it

### Rules

1. **Never invent a value.** A field you cannot establish is `null`. A date you
   are inferring rather than reading is `null` with a note. The practice will be
   correcting this by hand; a blank costs a minute, a wrong date costs a matter.
2. **Cite everything.** Every object carries `"source"`: the file it came from
   and, for a PDF, the page. Anything that cannot be checked against a document
   will not be trusted, and should not be.
3. **Say how sure you are.** Every object carries `"confidence"`: `high`,
   `medium` or `low`, and a one-line `"why"` for anything not `high`.
4. **Dates as `YYYY-MM-DD`.** New Zealand documents write day-first; American
   forms write month-first. Where a date is ambiguous (`03/04/2024`) and the
   document does not settle it, use `null` and flag it. Do not guess.
5. **Names as written.** Record given names and family name separately, exactly
   as the passport or application form has them. Do not restyle, transliterate
   or reorder — the register does its own capitalisation.
6. **Money in dollars, with the currency named.** Say whether a figure includes
   GST, and if the document does not say, record that it does not say.
7. **Do not resolve contradictions.** Where two documents disagree — two
   spellings, two birthdates, two addresses — record both and flag it. That
   disagreement is a finding, and often the most useful one in the folder.
8. **Do not summarise a file note into nothing.** A note is the record of what
   was said at the time. Carry it across in its own words.

### What to report

`findings.md`, for the practice and for whoever maintains the register. It must
contain **no client data**: no names, no numbers, no dates that belong to a
person. Describe shapes, not values.

1. **The layout you found.** How the folders are organised, how consistently,
   and where the exceptions are.
2. **Counts.** How many clients, matters, notes, documents; how many of each
   field you could fill, and how many you had to leave null.
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
   outcome, a document that appears in two folders. Describe the pattern and how
   many times it occurred; name no client.
6. **What you could not read.** Scans without text, formats you could not open,
   folders you skipped and why.

### How to work

Do a first pass over a sample of about twenty files and write `findings.md`
before extracting anything. Show the practice your reading of the layout and let
them correct it. Extract the whole tree only once that reading is agreed.

Do not modify, move, rename or delete anything in the folders you are reading.

---

## What happens next

`clients.jsonl` and `cases.jsonl` go into the register through a one-off import
script — written against the shape above once we have seen a real one, and
rehearsed against a copy of the database before it touches the live one.

`findings.md` is the interesting file. Section 3 is a list of columns the
register does not yet have, ordered by how much they are missed, in a form that
can be read without exposing a single client. That is what we work from when we
decide what to build next: the practice's actual paperwork, rather than a guess
about it.
