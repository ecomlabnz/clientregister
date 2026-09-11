# A second practice

**Asked for on 12 September 2026:** *"lets pretend that i have a paying customer
who wants to trial the system. lets move to multy tenants or how we called it?
where we have say two deployed workers, existing one + trial one with the test
data - and their cores are both updated at the same time - lets start
experimenting with two. if we can do two - we can do 200."*

This is the architecture, what it costs, and the order of work. It replaces the
open question left in `CLAUDE.md` on 3 September — *"Cloudflare normally
requires a D1 database to be named in `wrangler.jsonc` at deploy time, which
would mean a deployment per practice signed up. There are ways around it.
Nobody has confirmed which one works here."* One is now confirmed, and it is
enough for two and for about a hundred.

---

## The decision that is already made, and still holds

**One practice, one database.** Decided 3 September. Not a shared database with
a "which practice" column on every table.

Nothing in this document changes it. Everything in this document is about how
to run *many* single-tenant registers from *one* codebase.

The reason is unchanged and worth restating, because everything below is
cheaper than it: under a shared database, every one of the 614 queries in this
application has to remember to say "and only this practice", and the one
somebody forgets does not produce a bug report — it shows one law firm another
firm's client files. With a database each there is no query to forget.

**What that buys us now:** the code needs no change at all to serve a second
practice. There is no tenant column to add, no query to audit, no migration to
write. That is the whole of the dividend from the 3 September decision, and it
is why this is a configuration and deployment problem rather than a rewrite.

---

## What is already true today

Worth being precise, because it is more than it looks.

| | State | Where |
|---|---|---|
| Every query assumes one practice owns the database | **Done, by design** | everywhere |
| Practice name, address, bank, GST, signature, terms | **In `settings`** | `core/practice.ts` |
| Every dropdown the practice uses | **In vocabularies, editable without a deploy** | `core/vocabulary.ts` |
| First user bootstrap with no existing user | **Done** | `/setup`, `SETUP_TOKEN` |
| Seeded test data and a reset | **Done** | `core/testseed.ts` |
| Schema applied by migration at deploy | **Done** | `d1 migrations apply` |

So a second practice needs: a database, a session store, a file bucket, a
Worker, an address, and the secrets. It does **not** need a line of application
code.

---

## The shape

```
                 one repository, one main branch
                              |
                    CI (typecheck, 2,589 tests)
                              |
              +---------------+---------------+
              |                               |
        deploy --env practice          deploy --env trial
              |                               |
   Worker clientregister            Worker clientregister-trial
   DB  clientregister-db            DB  clientregister-trial-db
   KV  sessions                     KV  sessions-trial
   R2  files                        R2  files-trial
   app.immigration.kiwi             (a workers.dev address to start)
```

Same bundle, same migrations, same day. Two sets of bindings. **No shared
state of any kind between them** — not a database, not a bucket, not a session
store. The only thing they have in common is the code, which is the thing we
*want* in common.

### Why Wrangler environments and not something cleverer

A Wrangler environment is a named block in `wrangler.jsonc` carrying its own
bindings and variables. `wrangler deploy --env trial` builds the same
`src/index.ts` and attaches the trial's bindings to a Worker named
`clientregister-trial`.

Bindings are **non-inheritable**: each environment must state its own
`d1_databases`, `kv_namespaces`, `r2_buckets` and `vars` in full. That is a
feature here rather than a nuisance — it means a trial Worker cannot silently
inherit the practice's database because somebody forgot a line. A missing
binding is a deploy that fails, not a deploy that mixes two firms' files.

The alternatives, and why not yet:

- **One Worker, database chosen per request.** Would need the D1 binding to be
  dynamic, which it is not. Building it would mean reintroducing a runtime
  "which practice" decision — the exact thing the 3 September decision removed,
  and now on the hot path of every request rather than in 614 queries.
- **Workers for Platforms** (a dispatch namespace, one user Worker per tenant,
  bindings attached through the API). This *is* the right answer at a few
  hundred, and Cloudflare's own reference architecture describes exactly this
  pattern — "for complete per-tenant isolation, the platform creates and
  attaches a unique D1 database, KV namespace, or R2 bucket per application".
  It is a paid add-on and a larger machine than two practices need. Nothing
  below makes it harder to adopt later, because the unit it dispatches to is
  the same single-tenant Worker we are already building.

### The question from 3 September, answered

A database has to be named at deploy time **for `wrangler deploy`**. It does
not have to be named in a file a human edits: the Workers API accepts a script
upload with its bindings supplied in the request, so a provisioning script can
create a database and deploy a Worker bound to it without any config file
existing. That is the path from about ten practices onward (stage 3 below), and
it is confirmed, not assumed.

---

## What is genuinely per-practice, and where it lives

| | Per practice? | Where it goes |
|---|---|---|
| Client data, matters, documents | Yes | its own D1 + R2 |
| Sessions | Yes | its own KV |
| Practice name, bank, GST, signature | Yes | `settings`, edited in the app |
| Dropdown lists | Yes | vocabularies, edited in the app |
| Address it is served on | Yes | `APP_ORIGIN` var + a route |
| Sending email address | Yes | `MAIL_FROM` secret |
| Mail / Telegram / WhatsApp / Drive credentials | Yes | secrets on that Worker |
| AI provider key | **Decide** — see below | secret on each Worker |
| Application code and schema | No | the repository |

**The AI key is the one genuinely unsettled item.** One key across all
practices is simplest and means one bill we cannot attribute; a key per
practice means each practice brings their own account. It does not block a
trial — the register is required to work with the AI switched off, so a trial
can start with `AI_PROVIDER` unset and gain it when the question is answered.

---

## The order of work

### Stage 1 — two, by hand, from one deploy *(this is the step being built)*

1. Create the trial's resources: a D1 database, a KV namespace, an R2 bucket.
2. Add an `env.trial` block to `wrangler.jsonc` naming them.
3. Teach the deploy workflow to migrate and deploy **both**, production first.
4. Put the trial's secrets in place as `TRIAL_`-prefixed repository secrets.
5. Bootstrap it: `/setup` with the trial's `SETUP_TOKEN`, then fill in
   Settings → Practice as that practice.
6. Seed the test data from the Test Data page, so the trial has something in it.

**Production must not be able to break because the trial did.** The trial is a
separate job that runs *after* the production deploy has finished, so a broken
trial deploy cannot roll anything back or block anything.

### Stage 2 — prove the isolation rather than assume it

Before a paying customer's data is in either one:

- A request to the trial address can reach no row of the practice's database.
  Check it by asking the trial's own database for a count of clients and
  reading zero — and by looking, in the Cloudflare dashboard, at which database
  id each Worker is actually bound to.
- A session cookie issued by one is not accepted by the other (separate KV,
  separate signing secret).
- A document uploaded to one is not readable from the other (separate bucket).
- The migration count matches in both after a deploy.

Written as a checklist a person runs, not as a test — the test suite runs
against a fake D1 and cannot see which database a deployed Worker is bound to.
That binding is exactly the thing at risk here, so it is checked where it is
true.

### Stage 3 — about ten practices: a manifest and a script

Editing `wrangler.jsonc` by hand stops being reasonable somewhere around the
fifth practice, and the deploy workflow's job list with it.

Replace both with **one file listing the practices** and a script that, for
each: creates the resources if they do not exist, applies migrations, and
uploads the Worker with its bindings through the API. The deploy workflow then
loops over the manifest instead of naming environments.

Nothing about stage 1 has to be undone to get here: the manifest is the same
information the `env` blocks carry, in a form a script can read.

### Stage 4 — a hundred and up

Deploy time becomes the limit: a hundred sequential Worker uploads and a
hundred `migrations apply` runs is a long CI job, and a failure halfway leaves
half the practices on the new code. At that point:

- Migrations and deploys fan out in parallel batches, and the run reports which
  practices are on which version rather than assuming they all are.
- **Schema changes must become backward-compatible for one release**, because
  "all practices updated at the same time" stops being true the moment the fan
  out can partially fail. This is the one place where the "no bridges" rule
  will have to bend, and it should be written down when it does.
- Workers for Platforms becomes worth its price.

---

## What must be answered before a practice pays for this

Not blockers for a trial with invented data. All blockers before real client
files belonging to somebody else are held here.

1. **The backup.** Shipped 12 September 2026: nightly, verified, kept for 30
   days. Two things about it still bear on this document. It is written inside
   the same Cloudflare account, so it answers a lost database and not a lost
   account. And **a practice with no R2 bucket has no automatic backup at all**
   — which is the trial's position today, and would be any new practice's on the
   day it is set up. Creating the bucket is part of setting one up, not an
   optional extra.
2. **Support access.** When a practice says "it is broken", somebody has to
   look — and looking means reading their clients' files. Decide what that
   access is, that it is logged, and what the practice is told about it, before
   it is needed at two in the morning.
3. **Getting their data out.** A practice that leaves is entitled to their
   records. The export exists; whether it is complete enough to be the answer
   has not been checked against this question.
4. **Who pays for the AI**, per the note above.
5. **Uptime and incident response**, in whatever words the practice will accept
   — there is currently no statement of either.

---

## What this does not change

- No table gets a tenant column. No query gets a tenant clause.
- Anything that differs between practices goes in `settings` or a vocabulary.
- Nothing assumes there is exactly one row in `settings` for the whole world,
  one practice name, or one sending address.

The database boundary is the tenant boundary. Everything above is plumbing
around that one decision.
