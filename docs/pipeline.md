# Pipeline

Everything asked for, noticed or proposed that is **not yet done**. Kept here so
it survives a new session, and so nothing quietly falls off the end.

The rule for this file: an item leaves only when it has shipped, or when the
practice says to drop it. If it is dropped, say so and why — do not delete the
line.

Last reviewed: 4 September 2026.

---

## Asked for, not yet built

### 0. Shrink a PDF on the way in
**Asked 8 September 2026:** *"in the pipeline — we will need to add a PDF reducer
into the app — automatic. We already built it, it will need to be copied. Make
sure this is in the pipeline."*

Not written from scratch: the practice has one already, built elsewhere, and it
is to be brought across.

Why it matters here rather than being a nicety. The register now keeps the files
it is given — the intake reader stores what it read (1.6.0), matters and clients
carry documents, and knowledge-base articles carry the circulars they are about.
Scans arriving from clients and from INZ are the large ones: a phone photograph
of a passport page is routinely several megabytes, and a scanned decision letter
larger. Every one of those is stored at full size today, sent at full size when
it is forwarded, and counted against the 25 MB single-upload ceiling in
`core/files.ts`.

**Where it would go.** `putFile` in `core/files.ts` is the single point every
stored file passes through — both file tables' routes call it, deliberately, so
that the safety rules could not drift apart. A reducer belongs there and nowhere
else, for the same reason.

**What has to be decided before it is built**, none of it guessable from here:

- **What the existing one is** — a library, a service, a Worker of its own — and
  whether it runs inside a Cloudflare Worker at all. The CPU ceiling on a request
  is the thing to check first; a reduction that cannot finish in a request has to
  happen after the upload, not during it.
- **Whether the original is kept.** For a scan the practice took, probably not.
  For a document a client or INZ sent, the original is evidence, and a register
  that silently replaced it with a smaller copy would have destroyed the thing it
  exists to hold. The likely answer is: reduce what the practice produces, keep
  what arrives — but that is the practice's decision, not one to infer.
- **Whether it touches what is already stored**, or only what arrives next. A
  sweep over existing documents is a data change on live client files and would
  be rehearsed like any other.

### 1. Filtering the dashboard cards
**Asked 4 September 2026:** *"did we not discuss that i need to be able to adjust
these or filter these? the Needs you today and the Deadlines, or are they
adjustable in the settings? or can i suppress them by archiving?"*

Sorting was built (0.97.0) — every column heading sorts. **Filtering was not.**
The answer to the three parts of the question:

- **Archiving does suppress them**, and it is the biggest lever available today.
  43 clients are waiting in Clients → **Finished with?**, and archiving them
  silences 50 expiry alerts. Most of the "Current visa — …" lines dated 2025 on
  the dashboard are those clients.
- **Some are already settings**: how far back the unbilled-work alert looks, the
  certificate-expiry warning window, the quiet-matter threshold, the INZ
  acknowledgement window. Settings → Alerts.
- **Filtering by kind is not built.** The card shows everything at once. The
  natural shape is the calendar's: the legend *is* the filter, one link per
  kind, and the choice carried in the address so it survives a reload.

**Also unresolved in the same screenshot:** several lines read *"worked out from
an issue date never confirmed against the certificate"*, which is a data-quality
flag rather than a deadline, and arguably belongs somewhere other than "Needs
you today".

### 2. The nine client fields
Researched in another session, checked against the live register on 4 September
2026, and scoped. Not built. In the order they are worth doing:

1. **`nz_arrival_date`** — the highest-value item by a distance. Migration 0041
   lets the register record *"this visa expires N months after first arrival"*
   when a grant letter names no date. **69 clients carry such a rule, 66 of them
   say "after first arrival", and 64 still have no expiry date at all** — the
   register knows the formula and cannot compute it because it does not hold the
   arrival date. One caveat: one live rule says *"6 months after **each**
   arrival"*, so the field should be named for first arrival and that one matter
   stays manual.
2. **The small four** — `country_of_birth` (validated against the real country
   list, as passport country already is), town of birth as free text,
   `marital_status` as an editable vocabulary, and the interpreter field. On the
   last two: make it **the interpreter's language, not a yes/no** — knowing one
   is needed without knowing which language means ringing the client to ask; and
   **`currently_in_nz` needs an "as at" date**, or it will sit there looking
   authoritative eighteen months out of date.
3. **`previous_names`** — a table of its own, not a column. More than one per
   person (married name, a passport spelling, an INZ record spelling), and a
   comma-separated box cannot be searched one at a time. Same shape as
   `client_passports` and `client_certificates`: the name, what kind it is,
   where it was seen.
4. **Move `inz_client_number` from the matter to the client**, and **allow
   mononyms**. Both need rehearsing on a copy first. The INZ number is a fact
   about the person and the CSV export already quietly agrees — it gathers the
   numbers up from the matters into one client-level column. But **86 matters
   carry a number across 66 clients, and two of those clients have two different
   numbers**, so it is not a clean lift: those two need a human decision.
   Mononyms are a one-line change to make the family name optional and a wide
   audit of everywhere that assumes a person has one — display name, sorting,
   search, CSV, the AI brief. **Two individuals already have an empty family
   name**, and sorting already copes.

**Two of the nine were pushed back on and the answer stands unless the practice
says otherwise:** `middle_names` is not worth adding, because the column is
`given_names` (plural) which is exactly what INZ asks for, and a second box would
give one fact two homes; and `interpreter_required` as a yes/no is less useful
than the language.

**One correction to the research**, recorded so it is not repeated: it cited
migration 0049 as noting names *"spelled three ways across documents"*. It does
not — 0049 is about how matters are named. That phrase is in a competitor
research note about an institute's name. The previous-names point stands on its
own (it is asked on every INZ form and drives police certificates); it simply is
not evidenced by our own migration.

### 3. ~~Collapse Fees into Quotes and Invoices~~ — done, 1.1.0
Money now lives in quotes and invoices and nowhere else. `fee_items` and
`fee_shares` are dropped; the Fees module, its nav entry and `POST
/quotes/:id/to-fees` are gone; the split lives on the invoice behind a control
that opens when wanted; and an invoice can be raised without a quote.

**Left deliberately undone:** the practice's 3 quotes and 6 quote lines were not
deleted. They cost nothing to keep and they are real work somebody wrote — the
standing rule is never to trade records for tidiness. Nothing depends on their
going.

**Still open in this corner:**

- **Accounting integration** is the stated direction, not a task yet. `invoices`
  already carries `xero_invoice_id`, `xero_pushed_at` and `xero_error`, and an
  issued invoice is frozen by trigger, which is the property a pushed invoice
  needs. Nothing is wired.
- **A quote still cannot be raised against an inquiry that later becomes a
  client** without relinking by hand. Noticed, not urgent.

### 4. Automated backups — the largest single risk
There is none. `docs/operations.md` says so in bold, and the register has held
real client files since 30 August 2026. This must be closed before another
practice's files are held here at all (see the tenancy decision in CLAUDE.md).

### 5. ~~Dead code and stale tooling~~ — done, 1.1.1
- `sealField` / `unsealField` removed from `src/core/crypto.ts`, dead since
  0.69.0 when the practice decided passport numbers are stored as written. The
  `FIELD_KEY` secret is now referenced by nothing; it can be removed from the
  deployment when convenient, and is harmless where it is.
- **`scripts/seed-demo.mjs` had rotted in four ways**, none of them noticed
  because nothing ever ran it: a dropped `clients.nationality` column, country
  names where migration 0055 requires ISO codes, no `assigned_to` on a matter
  (which a trigger has long refused), and writes to `fee_items` / `fee_shares`.
  Fixed, and now **run by a test** against every migration with foreign keys and
  triggers on.
- `scripts/seed-demo-remove.sql` named the two dropped tables. Running it turned
  up a real fault nobody had hit: `invoice_items` lacked the `demo_` exemption
  that `invoices` and `invoice_payments` both carry, so demonstration data could
  not be removed once an invoice was issued. Fixed in migration 0062.

**Still open here:** six stale branches on the remote. Deleting them needs the
practice's own GitHub session; the token here is refused (403).

### 6. Data shapes worth a decision
- **`cases.outcome` holds two shapes** — about 123 one-word verdicts and 10
  free-text paragraphs. The application will overwrite the paragraphs. Reported,
  not actioned: it wants a migration, not a convention.
- **17 matters have an outcome and no decision date**, a state the model permits
  and the alerts logic then cannot classify (hence the `status_unknown` kind).
- **Nine matters are approved or declined with no decision date.** Since 1.0.0
  the database prevents new ones; these nine are deliberately left blank rather
  than stamped with today, and are named on the Alerts page for the practice to
  fill in.

### 7. ~~CI is fragile to npm being down~~ — done, 1.0.2 — was item 8
Four CI runs failed on 3–4 September because `npm audit` could not reach
`registry.npmjs.org`, while the same commit passed on a parallel run each time.
The gate is unchanged — a high or critical advisory still stops the build — but
an unreachable registry is now retried three times and then reported loudly as
*did not run*, rather than as a failure. The reading of npm's answer is in
`scripts/audit-gate.mjs` and is tested against the shapes npm actually produces,
including the one it printed for hours that night.

### 9. The top bar is close to full on a phone
Nine sections take two rows at 360px and three at 320px, and the bar is sticky,
so at a common phone width it holds about 155px of a 844px screen. Two rows is
the price of a navigation that is all there, and it is the right trade today.
The next section added is the one that makes it three rows on an ordinary
phone — measure before adding it, and if it does, the answer is probably to
move something into a group rather than to hide the run behind a menu again.

Also noticed while measuring: the top bar takes three rows on a phone before
the navigation starts, because the wordmark, the account controls and the
search box cannot share one. Nothing is wrong with it; it is just where the
height goes if it ever needs finding.

### 10. Two tables hold files, and one day they should be one
`documents` (client, matter, inquiry, quote) and `kb_documents` (knowledge
articles), because `documents` restricts what a file may hang off and that
restriction cannot be widened on D1 without risking the file notes that point at
existing documents. Migration 0063 sets out the whole of it.

What would let them merge: D1 allowing a table rebuild with foreign keys off, or
`entries` losing its foreign key to `documents`. Neither is worth chasing on its
own — the duplication is a table and three short routes, and the part that
matters for safety (how a file is named, stored and served back) is already
shared in `src/core/files.ts`. Revisit if a third thing needs to carry files.

Related and unfixed: an article deleted through the database takes its file rows
with it, but nothing removes the objects from R2. No route deletes an article
today, so there are no orphans yet.

### 10a. Two tables hold tags, for the same reason

`case_tags` (migration 0007) and `client_tags` (migration 0072) are the same
join written twice against one shared `tags` list. One `entity_tags` table keyed
on `(entity_type, entity_id)` is the better shape — it is the pattern
`documents` and `entries` already use — and a third taggable thing would make it
three parallel tables.

It was not folded into the client-tags change on purpose: `case_tags` works and
carries 192 live links, and `docs/spec/rebuilding.md` argues that consolidations
are done deliberately, one at a time, each with its own migration and rehearsal,
rather than smuggled in beside a feature. What would let it happen: an hour, a
rehearsal on a production snapshot, and nothing else in flight on tags.

### 11. The shipped defaults name this practice
`practice.terms_url` defaults to `https://www.immigration.kiwi/terms` — this
practice's own site. Right for them, wrong for the second practice, who would
be shipping their clients somebody else's terms until they noticed.

The same is true of anything in `core/practice.ts` that carries a real value
rather than an empty one. Not urgent — nobody else has a database yet — but it
belongs on the list of things to settle before one does, alongside the naming in
`docs/skills/README.md`. The fix is probably that these default to empty and the
quote simply omits the sentence, which it already does correctly when the
setting is blank (there is a test).

### 12. The letter of engagement, the rest of it

The frame is built and live (1.5.0): **Settings → Letter of engagement** holds
the words every letter says, and **Quotes → Letter clauses** holds the headed
sections, each limitable to certain matter types. Both are empty — the register
ships no wording for a contract between a lawyer and a client.

The practice settled the shape on 8 September 2026, and it is what makes the
rest small: **the letter states no parties, no scope and no fees.** Those are
the quotation's, and the letter refers to it. What is left to build, in order:

1. **The mandatory choice**, at composition: does this quotation go out with a
   letter? `quotes.with_letter` exists and is deliberately nullable — NULL means
   nobody has decided, so a letter is never omitted by oversight nor sent by one.
2. **The letter itself**, rendered from the settings and the clauses, referring
   to the quotation rather than repeating it.
3. **Frozen at issue.** A contract must not change when a setting does. The
   whole letter is rendered once, stored, and every later view reads the stored
   copy. A PDF goes into `documents`, so it sits on the file beside everything
   else.
4. **Acceptance without paper.** A link in the email, a page with no login, and
   a deliberate act: the client types a five-character code from the same email
   and their full name, then presses Accept. Recorded: the name, the moment, the
   address they came from, and a fingerprint of the exact document they saw. A
   confirmation goes to the practice and to the client, and both are kept as
   file notes.

   The code is in the same email as the link, so it is **not** a second factor
   and must not be described as one. Its job is to make acceptance a deliberate
   act rather than a mis-click, which is what an electronic signature has to
   show. Said plainly to the practice when it was proposed, and kept anyway on
   that basis.
5. **Acceptance creates the work**: the matters, and the parties as client
   records. **No invoices** — the practice's explicit instruction, because a
   stage falling due in six months should not sit on the books from today.

Not being built: variations. A scope change is a new quotation, or an invoice,
or an email that lands on the file as a note. The practice's decision.

### 13. Which edition of the terms a client actually accepted

**Raised 8 September 2026, deferred by the practice the same day:** *"will decide
it later — not a major now."* Recorded because the reasoning will not survive
otherwise.

The letter incorporates the practice's Standard Terms of Engagement by reference
to `https://www.immigration.kiwi/terms`. That page holds the current edition as a
PDF with a hashed filename, so republishing the terms replaces what the address
resolves to. A client who accepted in September and a dispute in two years would
be looking at different words.

The practice's own instinct when it was raised: keep a copy, *"in the knowledge
base potentially"* — which is the right shape. An article holding the current
edition as a file, each issued letter recording which edition it went out with,
and the acceptance record naming that document. `kb_documents` already does the
storage.

It is not urgent while the terms are stable. It becomes urgent the first time
they are republished, and by then the letters already sent cannot be told which
edition they meant.

### 14. ~~Tags on clients~~ — done, 1.11.0

Migration 0072 added `client_tags`, sharing the one tag list with matters. What
is left of it is the consolidation, recorded with the file tables in item 10a.

### 15. Somebody within the practice is not a client

**Raised 8 September 2026, unanswered.** The principal is on the register as
`CL-0255`, status Lead, which puts him in the same bucket as somebody who
enquired last week and never came back — and into the three-lead count on the
dashboard.

A client record can only be Lead, Client, Inactive or Archived. Nothing marks a
person as *the practice*, or as an agency the practice works with rather than
acts for. The likely shape is a fifth status shown in the client list but left
out of the places that treat a row as work: lead-chasing, client counts,
dormancy and expiry alerts, the bulk export.

Two questions were put and neither has been answered: whether this is just the
principal or staff and regular associates generally, and whether such a person
should still be a party on a matter (probably yes, and free either way).
`clients.status` carries a CHECK, so it needs a migration, and roughly forty
queries say "active" or "not archived" and each needs a decision.

### 16. Two-factor authentication is switched off

**Flagged 8 September 2026, not acted on.** The support is built. Neither of the
practice's two owner logins has it enabled, on a register holding live client
files and now answering on a public address.

Nothing to build. It is a decision and five minutes.

### 8. Reading across from other sessions
The **App field comparison review** session produced the nine fields above. Its
own audit ended with no repository changes and a mail-DNS fix. Nothing else has
been pulled from it.

---

## Done recently, for context

Kept short — the full record is in `CHANGELOG.md`.

- **Not a release, 6 September** — `docs/skills/case-to-register/` for the
  practice's own Claude project: one conversation about a matter becomes a
  handover the Assistant's intake can read. It replaces `docs/case-note-prompt.md`,
  which carried its own drifting copy of the case-type list. The two vocabularies
  it copies that live in Settings (case types, visa types, flag kinds) still have
  nothing checking them; the two that live in code (statuses, party roles) are
  pinned by `test/skilldocs.test.ts`.
- **1.2.0** — a knowledge base article can carry files; "General practice note"
  as a kind; file downloads keep their own security policy; the specification
  documents held against the schema by a test.
- **1.1.2** — the phone navigation shows every section again; the bar's stated
  height re-measured at every breakpoint; the Invoices pages stop highlighting
  Quotes.
- **1.0.1** — one word for one thing: file notes. "File note" as a document
  category.
- **1.0.0** — a decided matter carries its date, enforced by the database; the
  Key details panel says which way it went, how long it took, and drops rows
  that say nothing.
- **0.99.3** — column widths that were silently ignored in eleven of seventeen
  tables; a tick-box column is now the width of a tick box.
- **0.99.2** — themes apply on press, no Save.
- **0.99.1** — calendar controls: Week · Month · Year · Today.
- **0.99.0** — Finished with?: find and archive the clients the practice is done
  with. 43 waiting, 50 alerts silenced.

**Waiting to be done by hand**, because the register will not and should not do
them by itself:

- **Merge `CL-0259` into `CL-0257`** — two records for LAND MEAT NEW ZEALAND
  LIMITED, created forty minutes apart on 8 September 2026 before the assistant
  could match a company at all (fixed in 1.8.0). Which to keep is a judgement:
  CL-0257 carries the NZBN and the contact, CL-0259 carries whatever the second
  reading attached to it. Nothing in the register merges two clients.
- **Turn off `clientregister.workers.dev`**, once nothing important still points
  at it. The custom domain has been the address in outbound links since 1.3.1;
  the workers.dev name is deliberately kept as the way back in if the domain
  breaks, and is one switch (`workers_dev` in `wrangler.jsonc`) whenever the
  practice decides two doors is one too many.
- ~~The practice's own letter-of-engagement wording~~ — done 8 September 2026,
  see the hand changes below. **It has not been read back by the practice**, and
  it is a contract: three passages were adapted, and the whole of it is theirs
  to correct in Settings and Quotes → Letter clauses.

**Production data changes made by hand**, each rehearsed on a copy first and
recorded here because they are not in any migration:

- 8 September 2026 — the practice's letter-of-engagement wording entered for
  them, at their request: *"can you please populate it from what you have read
  in my LoE?? no time right now."* Seven settings and five clauses, transcribed
  from the Partner RV letter they supplied — **transcribed, not composed**.
  Three passages were adapted, because the quotation now carries what the letter
  used to restate: the covering letter points at the quotation instead of
  listing the parties and the work; the fee clause says the rates are stated in
  the quotation instead of repeating the figures; and the acknowledgements refer
  to accepting the quotation rather than signing a page. The clause about how
  INZ assesses a partnership is limited to `vv_partner sv_partner wv_partner
  rv_partner`, which are the practice's real case-type keys — the first draft
  guessed `rv_partnership` and `rv_dependent_child`, neither of which exists.
  Rehearsed on a scratch database and the letter rendered from it before it ran.
  Audit row `aud_loewording_20260908`. **Not yet read back by the practice.**
- 8 September 2026 — `consult@thelawfirm.nz` changed from Specialist (`adviser`)
  to Owner. The practice asked for it: that login is the principal lawyer and is
  not meant to be limited. As a Specialist it could not open Settings, read the
  audit log, archive a record, or manage users. Both of the principal's logins
  are now Owner, deliberately — kept separate so each keeps its own audit trail.
  One row; no client data touched. Audit row `aud_ownerrole_20260908`.
- 8 September 2026 — `practice.terms_url` changed from the PDF at
  `www.immigration.kiwi/_files/ugd/796b4b_09e26…pdf` to
  `https://www.immigration.kiwi/terms`, which is where the practice's Letter of
  Engagement sends clients. One setting row; no client data touched. Audit row
  `aud_termsurl_20260908`. The shipped default was changed to match in 1.2.2, so
  a fresh database starts on the right one.
- 4 September 2026 — all 150 of Tai's matters reassigned to Taymuraz Zaseev
  (he now holds 194; Tai holds none). **Clients and tasks were not moved** —
  175 clients and 89 open tasks remain with Tai. Audit row `aud_reassign_20260904`.
- 4 September 2026 — the fee price list rebuilt to mirror the case types, subtype
  by subtype: 74 items, one per case type in the practice's own wording and
  order, plus Initial consultation, Professional time and five disbursements.
  Immigration New Zealand fee and levy is **one line, one amount**, as
  instructed.
- 4 September 2026 — "File note" added to the practice's document categories
  (their list is customised, so the shipped default does not reach it).
