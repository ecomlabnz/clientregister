# The mistakes ledger

**Every fault this register has actually suffered, and the rule that now prevents
it.** If you are rebuilding it, this is the document to read first. The other
three tell you *what* to build; this one tells you what will go wrong while you
build it.

Nothing here is hypothetical. Each entry cost real time, and several were found
only because the register held real client files at the time.

A pattern runs through almost all of them, and it is worth stating before the
list: **the fault was rarely in the code that broke. It was in a check that could
not have caught it.** A rehearsal seeded with the wrong data. A test that never
ran the SQL. A guard on the visible half of a form. Fix the check, not just the
code.

---

## Loading data into a live register

### 1. A rehearsal is only as good as what it is seeded with

**What happened.** A batch of 148 matters was rehearsed on a scratch database
seeded from production — but the snapshot carried only users, counters, clients
and cases. Production also held 43 passports, 55 certificates and 41
nationalities. Every way the incoming batch could *collide with existing data*
was invisible to the rehearsal. The load then stopped halfway through against
production, on a constraint the rehearsal had no rows to violate.

**The rule.** A scratch database must be seeded from **what production actually
holds**, table for table — not a convenient subset. If a table is omitted, say
why in the seeding script, because the omission is a blind spot.

### 2. Write inserts that do not depend on knowing the target's state

**What happened.** The load inserted a passport for a client the register already
held. Five of seven were the *same document already on file*; the sixth violated
"one primary passport per client" and killed the run.

**The rule.** An insert onto a record that already exists asks the database, not
the loader:

```sql
INSERT INTO client_passports (...)
SELECT 'pas_x', c.id, ..., 
       CASE WHEN EXISTS (SELECT 1 FROM client_passports p
                          WHERE p.client_id = c.id AND p.is_primary = 1)
            THEN 0 ELSE 1 END, ...
  FROM clients c
 WHERE c.ref = 'CL-9001'
   AND NOT EXISTS (SELECT 1 FROM client_passports p
                    WHERE p.client_id = c.id AND p.number = '...');
```

Correct whatever production holds. This is stronger than fixing the rehearsal,
and both are worth having.

### 3. Make the load re-runnable, and prove it

**What happened.** Two loads stopped part way. Working out what had landed took
longer than the load itself.

**The rule.** Every row a load writes carries a batch prefix in its id
(`cli_b03_0001`). The load *begins* by deleting anything with that prefix, so it
can simply be run again. Prove it: **run it twice against a scratch database and
diff the result against running it once.** They must be identical.

The exception the database enforces: **a file note cannot be deleted, by
anybody.** Notes are therefore written `INSERT OR IGNORE` on fixed ids — a re-run
adds nothing and removes nothing. Check which of your tables refuse deletion
before writing a reset.

### 4. Never key a person on their name

**What happened.** Six people appeared twice in one extraction. The loader keyed
its lookup table on the name, so passports and nationalities attached to whichever
record was written last. Two of the six differed only in capitalisation
(`GARCIA` vs `Garcia`) and were missed entirely by the first fix.

**The rule.** The practice's identity test:

> Two records are the same client only when the **full name agrees** and the
> **dates of birth do not disagree**. A differing date of birth is decisive. A
> passport number is corroboration and never the key: the same person renews a
> passport and may hold a second nationality's.

Three answers — `same`, `different`, `unknown` — and only the first acts without
asking. `unknown` stops and asks a person. Applying this rule mechanically to a
batch rejected two proposed joins that were wrong and found two that had been
missed.

### 5. Split on identifiers before you split on size

**What happened.** A 764 KB SQL file was refused by D1's import twice. Split into
seven parts, the splitter tracked quoted strings but not comments — an apostrophe
inside a `--` comment ("the register's own structure") flipped its quote state
and glued two statements together.

**The rule.** A SQL splitter must understand comments *and* strings, because both
can contain the other's delimiters. And: **diff the resulting database row for
row against the unsplit load** before running either. That comparison caught this;
reading the SQL did not.

### 6. Reference numbers carry meaning — get them right the first time

**What happened.** Every matter in a batch took a 2026 reference because the
loader asked the 2026 counter. Ninety-four had been opened in 2023, 2024 or 2025.
Correcting it afterwards cost a renumbering, a note on every moved file, and a
permanent retirement of the vacated numbers.

**The rule.** A reference that encodes a year must be allocated from the year the
thing actually happened. Ask the extraction for the opening date **and where that
date came from**, and let "unknown" be a real answer — a matter nothing dates
honestly keeps the current year.

**And never reuse a retired reference.** If a matter moves from `CASE-26-901` to
`CASE-25-901`, its file records the old number. Reusing `CASE-26-901` later means
one file saying it *was* that number and another that *is*. Gaps in a sequence
cost nothing; a number meaning two things costs a great deal.

---

## Building the application

### 7. A required field must never sit inside a block that can be hidden

**What happened.** "Create client" did nothing at all — no error, no page change.
`family_name` carried the HTML `required` attribute and lived in the *individual*
half of a form; choosing "company" hid that half. The browser refuses to submit a
form with an invalid required control it cannot display, and reports it only to
the console: `An invalid form control with name='family_name' is not focusable`.

**The rule.** Stated as a test that reads both halves of the form source and
fails if either contains a required field. Server-side validation is where the
rule belongs; the browser's attribute is a convenience that here actively blocked
a legitimate save. Belt and braces: the script *disables* controls in the half
that does not apply, so they are neither validated nor submitted.

### 8. One phrase against one column is not a search

**What happened.** Searching a client by name only worked if you typed the words
in the order the register stores them. Names are held as written on a passport —
given names first — so the order a lawyer writes a name, and the order the
immigration service writes it, matched nothing. A single word worked, which is
what made it look like a data problem rather than a code one.

**The rule.** Split the query into words; require **every** word to appear;
let each word match **any** column. Order stops mattering, and a family name and
a reference can match together.

Three things fell out of fixing it, all worth knowing:

- **The fix reproduced the bug.** The first placeholder was still bound to the
  whole phrase; ANDed with the rest it made every multi-word search match
  nothing.
- **It was on seven pages, not one.** Each list had been written separately with
  the same shape. Six had to be found by hand after the seventh was reported.
  There is now a test that reads the source for the shape of the bug.
- **A stray parenthesis took a whole page down.** Eleven queries run in parallel
  there, so one bad query breaks all of them — and nothing in the suite
  *executed* the SQL.

### 9. Test that the query runs, not just that the function returns

**What happened.** As above: a malformed query shipped because every test mocked
the database.

**The rule.** For any function that builds SQL, run it against the real migrated
schema — for one word, several words, and words containing wildcards — and assert
that every query is accepted and binds a value for every placeholder it writes.

### 10. The number of rows on a page is not the number of values in a statement

**What happened.** Choosing "250" on a list returned "Something went wrong". The
page fetched the tags for the rows it was about to show by passing one bound
value per row into an `IN (...)`. D1 refuses a statement carrying more than a
hundred bound values, and the refusal is an error rather than a short answer.

It only appeared once the register held enough records to fill a page that size —
at 45 matters the page never asked for more than 45.

**The rule.** Any `IN (...)` built from a caller-supplied list runs in chunks
(ninety, leaving headroom below the hundred allowed). Lists built from fixed
vocabularies are safe and were checked and left alone. Test at a size past the
limit, against a wrapper that refuses too many bindings exactly as the real
database does, and **assert the last row comes back** — the tail is what broken
chunking loses.

### 11. Markup passed as a string is escaped, and looks like a bug to the user

**What happened.** Three pages passed a function returning markup into a subtitle
typed as `string`. The heading rendered as `<span class="stamp">29 Aug 2026…` on
screen.

**The rule.** Where a slot can reasonably take markup, type it to accept both,
and keep a test that plain text is *still* escaped.

### 12. A permission check belongs in middleware

Two routes added late — editing and deleting a warning — needed the same
permission as raising one. Registering the guard as middleware rather than inside
each handler means a route added later cannot forget. Mutation-tested: removing
the guard must fail a test.

---

### 13. A route can be defined and never registered

**What happened.** Saving an edited fee line returned "Not found", as did
changing a fee's status and deleting one. The three routes were *defined* but
never registered: the handler above them was missing its closing `});`, so all
three sat **inside that handler's callback** rather than beside it. They would
only have registered if somebody posted to the route above.

Valid JavaScript, so it compiled. Valid TypeScript, so it type-checked. No test
touched those three routes, so the suite stayed green. The application drew the
form perfectly and then posted into nothing.

**The rule.** A test asks the built router what it actually holds and compares it
against what each module's source declares, module by module, accounting for the
prefix each mounts under. It cannot be fooled by nesting, because a nested route
never reaches the router.

**How it was diagnosed**, because the method generalises: routing was ruled out
by probing Hono in isolation, CSRF by the status code (a rejection is 403, not
404), and the handler's own lookup by a `console.log` inside it — which never
printed. That silence is what pointed at registration rather than at the query.
Then `app.routes` showed four fee routes where the source declares seven.

**This is the second fault of this shape.** The first was a route *shadowed* by
one registered before it (`/fees/shares` after `/fees/:feeId`), fixed by
ordering. Both are invisible to the compiler and to any test that does not
interrogate the router. If you build this, write that test early.

### 19. A change made by hand writes no audit row

**What happened.** A client file was removed from the register at the practice's
instruction, with `DELETE FROM clients WHERE id = ...` run directly against
production. The application has no route that deletes a client, so there was no
other way to do it — and direct SQL writes nothing to the audit log. The record
left the register and *nothing anywhere said so*. It was found weeks later by
counting: the reference sequence had a gap the audit log could not explain.

A register whose whole purpose is to know where a file went had lost one
silently.

**The rule.** Two halves, and both are needed:

- **Any change made by hand writes its own audit row**, in the same session,
  saying what changed, why, on whose instruction, and that it was done by hand.
  Write it even when the row has to be written after the fact — say so in the
  row.
- **Reconcile the count.** Every reference the counter has issued is either on a
  record or explained. A gap with no explanation is the alarm.

This is the third occurrence of a related shape: the audit trail depends on the
handler that happened to make the change. **The durable fix is a database
trigger** — `AFTER DELETE ON clients` writing the audit row itself, so no route,
no load and no hand-run statement can remove a record quietly. Invariants belong
in the database; so does the record that they were exercised.

### 20. A test can pin a broken arrangement and keep it broken

On a phone the top bar was a single strip that scrolled sideways, and the two
menus in it — Money and Tools — were flattened into that strip with
`display: contents`, so their items would sit in the run like any other link.

Neither half worked. The strip carried no scrollbar (deliberately) and no
fading edge, so on a 390px screen the run simply stopped after *Cases* and the
six sections past the right-hand edge gave no sign they existed. And the
flattening never worked at all: `display: contents` removes an element's own
box, but a browser draws **nothing inside a closed `<details>`** whatever its
display says, so Quotes, Invoices, Knowledge and the Assistant were not merely
off the edge — they were never rendered. The practice found it the only way it
could be found: *"Where are the invoices and quotes? Cannot see them on my
phone."*

There were two tests over this. One asserted the stylesheet contained
`.nav-group { display: contents; }` and `.nav-group > summary { display: none;
}`. The other asserted the phone block contained `flex-wrap: nowrap` and
`overflow-x: auto`. Both passed for months. Both were describing the CSS back
to itself.

This is the source-reading fault from *The shape of a good check* in its purest
form, with an extra turn: the tests did not merely fail to prove the behaviour,
they **froze the broken arrangement in place**, because changing it would fail
them. A test that names an implementation makes that implementation the thing
under protection.

**The rule.** A test over the appearance of a page pins the *property*, not the
declarations that produce it — "every section in the bar is on the screen at
390px", not "`.topnav` says `flex-wrap: wrap`". Where the property can only be
seen in a browser, the browser is where it gets checked, and what goes in the
test file is the nearest honest invariant plus a note saying what was measured
and when. Two examples now live in `test/nav.test.ts`: the bar's stated height
may never *fall* as the screen narrows (a wrapping bar can only grow), and a
page may only mark its own module's section as the current one.

### 21. A stated number about a measured thing goes stale in silence

`--topbar-h` says how far down the page the top bar reaches, and sticky table
headings hang off it. It was measured once, correctly. Then the bar gained a
row at one breakpoint, and a second row at another, and the variable was not
touched — so by 4 September 2026 every one of its four figures was wrong, and
on a phone a sticky column heading was sitting 27px behind the bar. Nothing
failed; it just looked slightly wrong to anyone scrolling a long table on a
phone, which is not the sort of thing that gets reported.

**The rule.** Where a constant restates a measurement, the comment beside it
says what was measured and when — and the test, which cannot measure, pins the
*shape* the numbers must have rather than the numbers themselves.

### 22. A middleware that sets a header overwrites a route that meant something by it

Two routes hand back a file that came from outside the register — a client's
document, and now an article's attachment. Both set the tightest content
security policy there is on the response, `default-src 'none'; sandbox`,
because what they are serving is not a page of ours and must not behave like
one.

Neither of them was. `securityHeaders` runs on every response and set the
*page* policy — which permits same-origin script — unconditionally, after the
handler had finished. So the one directive that existed for those two responses
in particular was the one thing being removed from them, silently, and the code
that set it read as though it worked.

The rest of the hardening held: `nosniff`, and anything not on the short
render-in-place list served as `application/octet-stream` with a download
disposition. So this was a wall behind a wall, not an open door. It was still
not doing what it said.

**The rule.** A middleware that applies a default applies it *as a default*:
`if (!h.has(...))`. Where a handler has already spoken about a header, it knew
something the middleware does not. And the test for a header set by a route
asserts it *through* the middleware stack, not on the handler's own response —
this one passed for months because nothing had ever looked at the two file
downloads from outside.

### 23. "Cannot drift" is a claim until something checks it

`docs/spec/README.md` says three of the four specification documents are
generated from the code and cannot drift from it. Two of them had. `data-model.md`
described `fee_items` and `fee_shares` — dropped a release earlier — and had
never heard of `invoice_shares`, added in the same release. `invariants.md` said
the database refuses 39 things when it refuses 51, and listed a uniqueness rule
on a table that no longer existed.

The cause is not laziness, it is a half-truth in the arrangement:
`scripts/spec-schema.mjs` extracts the schema to JSON, and a person writes the
Markdown from it. That is the right way round — the prose in those documents is
worth more than a generator would produce — but it makes "generated" a
description of where the facts came from, not of how they stay current.

**The rule.** Where a document states a fact about the code, a test holds it
against the code. `test/spec.test.ts` does that for the two that drifted: every
table in the schema has a section, no section describes a table that is gone,
every refusal is quoted in the database's own words with the right *when*, and
the counts in the prose are the counts. What is deliberately not checked is the
writing, which is the part worth having.

### 24. An error message that names no cause is read as any cause

The assistant failed on a case handover and said, in full: *"model returned no
structured output"*. The practice read it as having run out of quota. It was
not that — the model had been cut off part-way through its answer because the
register only allowed it 4,000 word-pieces for a summary that can run to 8,000
characters, on a model that also spends part of that allowance reasoning.

Four different failures shared that one sentence, and they want opposite
responses: send less, wait a minute, top up the account, try again later. The
person best placed to act had nothing to act on, so they guessed — which is what
anybody does with an error that rules nothing out.

The provider had said which it was, in `stop_reason`, on every response. Nobody
was reading it.

**The rule.** Every failure a person can see names its own cause in a sentence
they can act on, and carries the raw text on the end for whoever has to find out
why it says that. Not a code, not the provider's JSON — those are for the second
reader, not the first. Where the provider already distinguishes causes
(`stop_reason`, HTTP status), the application distinguishes them too; passing
four failures through as one is throwing away information that was handed over.

And the smaller half, worth its own line: **a limit the application sets is a
limit the application must justify.** 4,000 was chosen once and never measured
against the thing it had to hold.

### 25. A guessed date in a list of deadlines is read as a deadline

The register calculated certificate expiries from issue dates, and recorded
honestly whether the issue date had been read off the certificate or inferred
from a filename. A row built on an inferred date said so, in its own detail
line — and then sat in "Needs you today" beside real expiries, sorted by date,
looking exactly like something that had gone past.

Measured on 7 September 2026, every certificate alert overdue in the live
register was one of these: five police, three medical, not one confirmed. The
practice pasted them back and asked for them to be suppressed.

Suppressing was the wrong answer and so was leaving them. A date that was worked
out cannot support the claim the list makes about every row in it. It supports a
different claim — *nobody has checked this* — which is real work with a different
urgency and no due date at all.

**The rule.** Where a value's provenance is recorded, the provenance decides
which list it belongs in, not just what the row says about itself. A caveat
printed inside a row does not change what the row's position claims. If it
cannot be acted on the way its neighbours can, it is a different kind of thing
and gets its own heading.

### 26. One idea in two places, and only one of them grows

The kinds a file note can be lived in two lists: `ENTRY_KINDS` in
`src/domain.ts`, which the forms offer, and a CHECK constraint written in
migration 0002, which the database will accept. Nothing held them together.

On 1 September 2026 "Preliminary consultation" was added to the first list. It
was on three forms for a week and it never once worked — every attempt to save
one was refused by the constraint. The error was a database error, so it read as
a fault rather than as a missing value, and nobody reported it. It was found on
8 September only because the practice asked for the list to change again and the
database was attacked directly to see what it would accept.

Two things went wrong, and the second is the more useful one:

- **The lists could disagree**, and disagreeing was silent until somebody used
  the new value.
- **Nothing exercised the new value.** The test that guarded this list asserted
  `ENTRY_KINDS` contained `prelim_consult` — reading the list to check the list
  said what the list said. It passed every day for a week while the value it
  named was unwritable.

**The rule.** Where a value must be accepted by something else — a database
constraint, another service, a file format — the test writes one and reads it
back. A list checked against itself proves nothing. And when a list is
configuration rather than a rule about the shape of the world, the constraint
is the wrong place for it: `entries.kind` no longer has one (migration 0064),
for the same reason `kb_articles.kind` never did.

### 27. A sentence on a page is not checked by anything

"Open a matter from what you already have" carried this, in bold, beside the
upload box:

> **The file is not kept.** It is read and dropped, because there is nowhere to
> keep it until R2 is switched on.

R2 was switched on on 29 August 2026. Five documents had been stored through it
since, by two other features. The sentence stayed true-sounding and false for ten
days, and the practice found it by *reading the page* — not by losing a document,
which is luck rather than a safety net.

The interesting part is not that a comment went stale. It is what the stale
sentence was doing: it was **load-bearing**. Somebody had read it, believed the
constraint was real, and built the feature around it — the file was genuinely
being dropped, on the strength of a reason that had expired. A wrong sentence in
prose becomes a wrong decision in code the next time anybody trusts it.

Three faults in this register have now had the same shape: a number nobody
re-measured (21), a set of documents that "cannot drift" (23), and this. All
three were statements about the world, written once, in a place nothing
re-checks.

**The rule.** A statement about the state of the system, shown to a user, is
derived from the system or it is not shown. The notice now reads
`Boolean(env.DOCS)` and says whichever is true — which cannot go stale, because
there is no longer a sentence to go stale. Where a claim genuinely cannot be
derived, it carries the date it was checked, so a reader can weigh it.

### 28. A fixture tidier than the data it stands for

Migration 0066 rebuilt every matter's name from the practice's case-type
vocabulary — a settings row holding "key | Label" lines — and read it with
SQLite's `trim()`.

**SQLite's `trim()` strips spaces. Only spaces.** The settings row was saved from
a browser, so its lines end CRLF, and every label came out with a carriage
return still attached: 190 of the 194 names became `RV. Partner\r — NGUYEN, ANH
TAN`.

Six tests guarded that migration, including one that checked no raw key was
printed and one that compared a digest of every row before and after. All six
passed, because the fixture they seeded the vocabulary with used Unix line
endings. The fixture agreed with the code instead of with the register.

Nothing else showed it either: a carriage return is whitespace in HTML and
collapses, so every page looked right. It was in the CSV export, in a search for
the label, and would have been in the letter of engagement. It was found hours
later by querying the live register for it while reading the same vocabulary for
something unrelated.

Note what the fault was *not*: the application's own parser was never wrong —
JavaScript's `.trim()` removes a carriage return — so this is also fault 26
again, one rule with two implementations, and the SQL one drifting.

**The rule.** A fixture stands in for production data, so it carries production's
mess: the line endings the file actually has, the punctuation the names actually
contain, the empty column that is empty in real life. Where the shape of the real
data can be measured, measure it and seed to that shape. A test whose input is
cleaner than reality is testing the code against itself.

### 29. A module mounted after a guard on `/` is behind a sign-in it never asked for

**What happened.** The page a client opens to read their fee quote redirected
them to a login screen. Its own routes required nothing; the fault was position.
The dashboard mounts at `/` and puts `requireAuth` on `*`, which in Hono means
every path in the application — so anything registered after it is behind a
sign-in whatever it says about itself. Every unit test passed, because a unit
test mounts one module alone. It showed up only by opening the link in a browser
with no session, which is a thing nobody does by accident.

**The rule.** Mounting order is part of the access-control design, not a detail
of the registry. A page reachable without a session is mounted above anything
that guards `*` from the root, and a test asserts that ordering by name — because
the next module added at `/` breaks it again in exactly the same silent way. When
a route's behaviour depends on what else is mounted, no test that mounts it alone
can see the fault: open it the way the person opens it.

### 30. A permission answers "may you edit these at all", never "is this one still yours to edit"

**What happened.** A client accepted a fee quotation, and the practice then
deleted a line off it. The only guard anywhere was `quote:write`. That permission
is about the user; it says nothing about the state of the document, and there is
no state a permission can express. So an accepted quotation — a contract, with a
recorded acceptance — could have its fees, its schedule, its parties and its
status changed by anybody entitled to edit a draft.

**The rule.** Where a record becomes a fact about the world — accepted, lodged,
issued, paid — the freeze belongs in the database as refusals on every table that
composes it, not in the handler that happened to be looked at. Ten refusals were
needed here, because a quotation is four tables and a permission check was
guarding one screen. The test for such a rule attacks the tables directly: the
whole point is that it holds when a second screen forgets.

### 31. A branch of rewritten history goes stale the moment work continues

**What happened.** A branch carrying the repository's history with nine client
names removed was prepared, then left while four releases landed on `main`.
Force-pushing it days later would have been a fast-forward in appearance and a
deletion in fact: it was cut before those releases and did not contain them. The
whole client-acceptance system would have gone.

**The rule.** A rewritten history is a snapshot, and a snapshot of a moving branch
is out of date immediately. Before any force-push that replaces history, compare
the **tree** of the replacement against the tree of what it replaces — not the
commit count, not the dates. Identical trees mean the same code with different
history, which is the only safe case. Anything else is a deletion, whatever it is
called.

### 32. A print rule on `body` cannot reach an element that sets its own size

**What happened.** The practice asked for a more compact fee quote, the print
stylesheet was set to 8.5pt on `body`, and the PDF came out at 10.3pt. The
document element sets its own `font-size`, which is more specific than the
inherited one, so the rule never applied. Nothing in the code looked wrong.

**The rule.** A visual change is not made until it has been measured on the
artefact that matters — here, generating the PDF and reading the type size out of
it. "I set the value" and "the value took effect" are different claims, and CSS
specificity is exactly the kind of thing that separates them silently. The same
applies to the print canvas colour, which is painted by the root element and
cannot be reached by a rule on `body` at all.

### 33. A release shipped without the page ever being rendered

**What happened.** A header change went out that left an invoice showing
"Invoice" as a small heading with the contact lines unlabelled. Tests passed; the
change was correct in the sense that it did what the diff said. Nobody had looked
at the resulting page.

**The rule.** A change to how something looks is not finished until that thing has
been rendered and looked at. Tests hold rules; they do not hold appearance, and
they are not meant to. If the change is visual, produce the artefact — page, PDF,
screenshot — before shipping it.

### 34. A generated document that nobody regenerates is a written one

**What happened.** Three specification documents carried the sentence *"generated
from the code and cannot drift from it"*. The front page said 195 routes; the
routes document said 178. Both had been produced from the code once, and edited
by hand since.

**The rule.** "Generated" is a property of a command that exists and is run, not
of how a file was first produced. Either there is one command that rewrites the
file — `npm run spec` — and a test that fails when what is on disk is not what the
command would write, or the document is hand-written and should say so. A file
that claims to be derived and is not is worse than one that never claimed it,
because it is trusted.

### 35. A fallback that says nothing is a leak

**What happened.** Every link sent to a client — fee quotes, letters of
engagement, document lists — is built on the practice's public web address. That
setting was blank, so the register fell back to the address the request arrived
on, which in production is its own `workers.dev` name. Clients had been receiving
it for weeks. The fallback is correct behaviour and is what makes a fresh
deployment work; the fault was that it happened in silence.

**The rule.** A fallback that changes what an outsider sees announces itself at
the point of use, not in a settings page nobody has open. The screen that is
about to send the link says which address the client will see. Note also what
could *not* be fixed here: a link only works at an address that routes to the
application, so writing a domain into the setting without pointing that domain at
the register would replace an ugly link with a dead one. Half a fix that breaks
the working half is not a fix.

### 36. A pattern that matches a tag also matches a longer tag

**What happened.** Reading the practice's own checklists out of Word files,
`<w:t[^>]*>` was used to find text runs. It also matches `<w:tab w:val="num"/>`,
so everything between a tab and the next closing tag was captured as text —
producing checklist items containing raw XML. Caught by reading the output; three
documents extracted earlier had to be re-checked to prove they were unaffected.

**The rule.** When matching a named thing in a structured format, anchor the end
of the name: `<w:t(?:\s[^>]*)?>`, not `<w:t[^>]*>`. And when a parser is found to
be wrong, re-run everything it has already produced and prove the earlier output
is clean, rather than assuming the bug is new.

### 37. Moving a function can take its neighbour with it

**What happened.** A helper was moved out of a module into a core file by slicing
from its doc comment to the end of its body. The slice began at the previous
function's doc comment and removed that function too. The typechecker caught it
immediately.

**The rule.** This one is in the ledger not because it was costly but because it
was free — the typechecker made a silent structural mistake loud. Run the
typechecker after any edit that moves code between files, before running anything
else. And prefer an edit that names what it is replacing over one that computes a
range.

### 38. An identifier typed from memory is not an identifier

**What happened.** A merge was attempted with an expected-head SHA whose first
seven characters were right and whose remainder was invented. The API refused it
as "head branch was modified", which reads as somebody else having pushed. Time
was spent looking for a push that had not happened.

**The rule.** Identifiers are copied from the tool that produced them, never
recalled. When a call is refused on the basis of one, check the identifier before
checking the world.


### 39. A dropdown is not searchable, and grows past the point of being usable

**What happened.** The matter box on a new quotation held every open matter —
seventy of them — in a `<select>`. The practice: *"it is just impossible to
search through this!"* The client box beside it held two hundred and forty-five.

A `<select>` cannot be searched. Pressing a key matches the **first character**
of the option's text, and every line here began with the visa type, so pressing
N looked for a matter whose type started with N. The list was also sorted by
whatever came first in the client's name, which for most of this caseload is not
the surname — so it could not usefully be scrolled either.

Neither list was ever designed; both were fine at twenty rows and nobody looked
again at two hundred.

**The rule.** **A list that can outgrow a screen is typed into, not scrolled.**
`findBox` in `ui/components.ts` — a text input with a `<datalist>`, which is
plain HTML and needs no script — with `core/options.ts` turning what was typed
back into a record, and **refusing rather than guessing** when what was typed
fits more than one.

Two things this cost, both of them written down where they happen rather than
left to be found: the form now posts the visible line instead of an id, so the
line has to be resolved server-side against the same list the form offered; and
the field accepts the id as well, because a preset link carries one.

**The related rule.** A label is sorted by the thing somebody looks for. Names
in any label — matters, quotations, pickers — read `FAMILY, Given`; the client's
own record still reads `Given FAMILY`, which is the order a letter is addressed
in. Two jobs, two orders, one place composing each.

---

---

## Working practices that caught things

### 14. Commit to the branch, not to `main`

**What happened.** A commit was made on local `main` instead of the working
branch, so a push to the branch moved nothing and the work sat unpushed. `main`
takes changes only through a pull request, so pushing it directly would have been
refused anyway.

**The rule.** Check the branch before committing. A stop-hook that reports
unpushed commits caught this; it is worth having.

### 15. Mutation-test every guard

Remove or invert the guard; the test must fail. Applied throughout this register.
It has repeatedly shown a test to be vacuous — including one where two empty
strings were compared and 17 records were reported as agreeing when nothing had
been checked at all.

### 16. Check the browser, with scripting on **and** off

Several rules here are only visible in a browser: a hidden required control, a
radio made full-width by a global rule, a heading rendering as tags. And a
feature claiming to work without scripting must be *tested* without scripting —
one did not, and the fix changed which path the record type is chosen on.

### 17. Reproduce before fixing

Every fault above was reproduced first, and in two cases the reproduction changed
the diagnosis entirely. The browser console named the invalid field; the server
log named "too many SQL variables". Neither was guessable from the code.

### 18. Real client data never enters the repository

**What happened.** A client's real name was used as a worked example while fixing
the search — in code comments, three test files, the changelog, the Help page and
two commit messages. A second client's name had been in the codebase since a much
earlier commit.

**And it happened again the same day, in a different shape.** A worked example of
a warning — "the applicant is paid $27.76 against a visa condition of $27.80" —
was copied out of a production file note into a document in this repository. No
name was attached, which is exactly why it got through: it did not *look* like
client data. Both figures appear once each in the register. A distinctive number
identifies a file the long way round, and so does a distinctive fact.

**The rule.** No real name, passport number, date of birth, **figure or fact
about a matter** in the repository — not in tests, fixtures, seeds, commit
messages or example text. Invent your examples, and **check them against the
register before using them**. The check is the part that works: a name gets
checked because it looks like client data, and a wage rate does not, so check
anything you did not make up yourself.

**A reference is the exception, and it is worth stating**, because the first
version of this rule banned references too and was wrong. `CL-0082` on its own
discloses nothing, and pointing at a client by reference is precisely how you
write about a real record *without* naming somebody — the intake brief tells the
extraction to do exactly that. What is not allowed is a reference **carrying
facts about that client**: "`CASE-26-051`, approved on 31 August" names a matter
and then says what happened on it, which is naming the client the long way round.

So: a bare reference, yes. A reference with a story attached, no.

In an *example*, one more distinction, because the obvious rule gets it wrong.
Where the example stands in for **a particular record** — a snippet showing the
shape of a query, a placeholder in a form — use a number outside the range the
register has issued (`CL-9001`), so nobody has to work out whether it points at
somebody. But where the example demonstrates the **format or the sequence**
itself, the real-looking number is the correct one: "the loader allocates
`CASE-24-001`, `CASE-24-002` and so on" is about how counting works, and
`CASE-24-901` would misrepresent it. The test is what the number is doing in the
sentence, not whether it happens to exist.

Commit messages are the part that cannot easily be undone: a protected branch
will refuse the force-push needed to rewrite them.

**And it happened again, on 8 September 2026, at nine times the size — with this
rule already written down.** Six live clients and three live companies were used
as worked examples across 25 files: test fixtures, migration comments 0069–0071,
`core/names.ts`, `core/casename.ts`, the Help page, the changelog, the progress
report and the commit messages. Every one of them looked invented. That is the
whole difficulty: a plausible name *is* what a real name looks like, and the
rule's own instruction — "check them against the register before using them" —
was skipped every single time, because at no point did it feel like a check
worth making.

It was found by an audit, not by anything in the register, which is the part
that had to change. **`test/norealnames.test.ts` now fails if any of the nine
appears anywhere outside itself.** That is narrow on purpose: a test cannot
reach the production database, so it cannot tell you whether tomorrow's invented
name belongs to somebody. It can only stop these nine coming back — the fault
repeating, rather than a new one.

The general form stays a human check, and it is one query, run before the name
is used rather than after: send the candidate to the register and ask whether it
matches. Do it in that direction. Pulling the client list out to compare against
is itself an extract of client data, and it is refused.

---

## The shape of a good check

Ranked by how often each one earned its keep here:

1. **Attack the database directly.** Not through the application — the
   application is one of several things that write.
2. **Break the guard and confirm the test fails.**
3. **Compare two independently built forms of the same result**, row for row.
4. **Run it twice** and require the same answer.
5. **Execute the SQL** rather than mocking it.
6. **Look at it in a browser**, at phone width, with scripting off.
7. **Say the numbers out loud before and after**, and reconcile every one.

**The one that keeps failing this list: a test that reads the source.** Three
times now a test has asserted that a handler's source *contains* something — a
function call, a permission, a string — and passed while the behaviour was
broken. The archive routes were the plainest case: the handler was changed to
call the re-check and then ignore what it said, so a client whose matter had
been reopened would have been archived, and every one of the five tests
guarding those routes still passed. A source match proves the words are in the
file, nothing more. Where a route can be mounted and posted to, post to it and
read the database afterwards; keep source-reading for the few things that
genuinely are about the text (a forbidden import, a secret in a file).
