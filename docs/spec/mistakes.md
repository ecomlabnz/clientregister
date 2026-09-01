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
