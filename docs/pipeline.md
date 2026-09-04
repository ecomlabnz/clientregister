# Pipeline

Everything asked for, noticed or proposed that is **not yet done**. Kept here so
it survives a new session, and so nothing quietly falls off the end.

The rule for this file: an item leaves only when it has shipped, or when the
practice says to drop it. If it is dropped, say so and why — do not delete the
line.

Last reviewed: 4 September 2026.

---

## Asked for, not yet built

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

### 3. Collapse Fees into Quotes and Invoices
**Asked 4 September 2026:** *"why do we need fees section at all?? should there
just be quotes and invoices - both being able to be entered independently and the
quotes can be converted into invoices - invoices can be part paid??? why
complicate things??"*, then *"we should have a powerful quotation system and
powerful invoicing - both may later be connecting to accounting systems for push
and integration"*.

**Decided by the practice, and it clears the way completely:**

- **Splits belong to invoicing**, not to the matter: *"fee splits can be
  implemented in invoicing I believe"*.
- **The split is a button, not a permanent fixture**: *"the bill split should be
  a button that opens the options — I can simply issue an invoice for already
  split amounts if I choose to… good if they are available but not always
  visible - can be activated if and where needed"*.
- **Nothing needs migrating.** *"delete any split info - i want to avoid
  migration - the tables must be built efficiently - so no real financials were
  entered yet - those that have - can be deleted"*. That covers all of it: 3 fee
  lines, 42 fee shares, 3 quotes, 6 quote lines. Invoices and payments were
  already empty.

**Done so far (1.0.3):** an invoice can be **raised on its own**, which was the
concrete gap — until now the only way to bill anything was to write a quote and
convert it. Part payments needed nothing built: `invoice_payments` already
exists, append-only and signed, with a date, method and reference.

**Still to do:**

1. Clear the financial tables, on the practice's instruction above.
2. Remove the Fees module and `POST /quotes/:id/to-fees`; drop `fee_items` and
   `fee_shares`.
3. Rebuild the split on the invoice, behind a control that is shown when wanted
   rather than always.
4. Repoint the unbilled-work alert from "finished with no fee line" to "finished
   and never invoiced". Its measured design stands — a 90-day look-back and a
   14-day grace turned 135 candidates into 6.
5. Accounting integration is the stated direction, not a task yet. `invoices`
   already carries `xero_invoice_id`, `xero_pushed_at` and `xero_error`, and is
   frozen by trigger once issued, which is the property a pushed invoice needs.

**One thing to carry into the rebuild:** `invoices.description` is `TEXT NOT
NULL` with no `CHECK`, so an empty string is a legal invoice description. The
application refuses one in two places; the database does not. In a rebuilt table
that belongs in the constraint.

### 4. Automated backups — the largest single risk
There is none. `docs/operations.md` says so in bold, and the register has held
real client files since 30 August 2026. This must be closed before another
practice's files are held here at all (see the tenancy decision in CLAUDE.md).

### 5. Dead code and stale tooling
- `sealField` / `unsealField` in `src/core/crypto.ts`, left from the passport
  encryption removed in 0.69.0. Nothing calls them.
- `scripts/seed-demo.mjs` references `clients.nationality`, a column dropped in
  favour of `client_nationalities`. It will fail on a fresh copy.
- Six stale branches on the remote. Deleting them needs the practice's own
  GitHub session; the token here is refused (403).

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

### 8. Reading across from other sessions
The **App field comparison review** session produced the nine fields above. Its
own audit ended with no repository changes and a mail-DNS fix. Nothing else has
been pulled from it.

---

## Done recently, for context

Kept short — the full record is in `CHANGELOG.md`.

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

**Production data changes made by hand**, each rehearsed on a copy first and
recorded here because they are not in any migration:

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
