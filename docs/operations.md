# Operations

## Cloudflare resources

| Resource | Name | ID |
|---|---|---|
| D1 database | `clientregister-db` | `cffee490-cd35-4f54-97f2-e9d72b4aa2bb` |
| KV namespace | `clientregister-sessions` | `bc10c12242b1440aaf6cff8c3f3e5837` |
| R2 bucket | `clientregister-docs` | not created — R2 not yet enabled on the account |
| Worker | `clientregister` | created on first deploy |

D1 is pinned to Oceania (`oc`), so the register's data sits close to the
practice.

### The trial practice

A second register, from the same code. Architecture and the order of work:
[`second-practice.md`](second-practice.md).

| Resource | Name | ID |
|---|---|---|
| D1 database | `clientregister-trial-db` | `a2bdf373-974a-47b6-a7a3-72f7bf7b4730` |
| KV namespace | `clientregister-trial-sessions` | `8e6c31e521fc4226b541003bf27bb466` |
| R2 bucket | `clientregister-trial-files` | created 12 September 2026, in `OC` |
| Worker | `clientregister-trial` | `https://trial.immigration.kiwi` (also `clientregister-trial.ecomlabnz.workers.dev`) |

Both were created on 12 September 2026; the database carries the same `oc`
location hint as the practice's, so a trial that becomes a practice is already
in the right place.

**Nothing deploys to it until `TRIAL_SETUP_TOKEN` exists** as a repository
secret. That is the switch: no secret, no job, no Worker.

#### Turning it on

1. **Add `TRIAL_SETUP_TOKEN`** (Settings → Secrets and variables → Actions).
   Any long random string; it is what `/setup` asks for once, to create the
   first user. Optionally also `TRIAL_MAIL_PROVIDER`, `TRIAL_MAIL_FROM`,
   `TRIAL_RESEND_API_KEY`, `TRIAL_AI_PROVIDER`, `TRIAL_ANTHROPIC_API_KEY` —
   each is uploaded under its unprefixed name and each is optional.
2. **Push to `main`.** The deploy workflow applies the migrations to
   `clientregister-trial-db` and deploys `clientregister-trial`, after the
   practice's own register has finished. The run prints the `workers.dev`
   address.

   Every Wrangler command for a practice other than the first carries
   `--env <name>` — migrations included. Without it the command reads the
   top-level configuration, does not find that practice's database, and fails
   before doing anything. Checking that by hand takes a second and needs no
   token: `npx wrangler d1 migrations list <database> --local --env <name>`.
3. **Give it an address, once, and then leave it alone.** A subdomain of the
   practice's own domain, attached to that Worker as a custom domain in the
   Cloudflare dashboard. Put the address into `wrangler.jsonc` as that
   practice's `APP_ORIGIN` — and **nowhere else**.

   **Do not declare it as a `routes` entry.** A route in the config is
   re-asserted on every deploy, and on a zone carrying more than one practice
   that reconciliation briefly 403s the *other* practice — which is somebody
   else's live register. It happened on 12 September 2026 and is fault 42.
   `app.immigration.kiwi` has never been in that file, and never flickers.

   The `workers.dev` address keeps working alongside whatever you attach.
   `APP_ORIGIN` builds links in the nightly automation output, so it must be
   that practice's own address — a summary linking into somebody else's
   register is the one mistake this arrangement exists to prevent. Done for the
   trial on 12 September 2026: `trial.immigration.kiwi`.
4. **Open `/setup`** on that address, give it the token, and create the first
   user.
5. **Fill in Settings → Practice** as that practice — name, address, bank, GST.
   Nothing about the practice's identity is in the code.
6. **Seed it** from the Test Data page, so the trial has a caseload to look at.

#### The R2 bucket

Every practice needs one. Without it there is no document storage **and no
nightly backup** — the backup is written to R2 — so this is part of setting a
practice up rather than an optional extra.

**R2 pins a name to a location the first time that name is created**, for good:
delete the bucket and recreate the same name and it comes back where it was.
The practice's own bucket had to be renamed to `files` because the original
name was stuck in eastern North America.

**Use the button, not the dashboard.** Actions → *Create a practice's storage* →
Run workflow, with a name that has never been used on this account and the
location left at `oc`. It runs `wrangler r2 bucket create --location oc`, which
says where the bucket goes explicitly, then reads it back to confirm where it
landed.

Done for the trial on 12 September 2026: `clientregister-trial-files`, created
from a GitHub runner in the United States and confirmed afterwards to be in
`OC`. That is the proof the location flag does what the dashboard workaround was
standing in for.

(An earlier version of this note said the bucket had to be created from a
browser in New Zealand. That was the workaround, not the rule — it was needed
because the *API* call has no location parameter, so "automatic" placed the
bucket near whoever called it. Wrangler's `--location` removes the problem.)

Then add it to that practice's environment in `wrangler.jsonc`:

```jsonc
"r2_buckets": [{ "binding": "DOCS", "bucket_name": "clientregister-trial-files" }]
```

Until it is bound there, the register reports document storage as not enabled —
which every page that uses it already handles — and its Exports page says it has
no automatic backup.

#### Checking the two are actually separate

Before any real client data is in either, and after any change to the bindings.
`test/tenancy.test.ts` refuses a configuration that shares a database, a
session store or a bucket — but it reads the file, and what matters is what
Cloudflare is running.

- In the dashboard, open each Worker's settings and read the **database id** it
  is bound to. They must differ, and must match `wrangler.jsonc`.
- Ask the trial's database for a count of clients. Before it is seeded the
  answer is zero; if it is not, it is not the database you think it is.
- Sign in to one and load the other's address. It must ask you to sign in
  again — separate session stores, separate signing secrets.
- After a deploy, compare the migration count in both.

## Deploying

Cloudflare pulls from GitHub. `main` is the only branch that reaches production.

Add two repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — API token with **Edit Cloudflare Workers**, **D1
  edit** and **Workers KV Storage edit** on this account. Create it at
  <https://dash.cloudflare.com/profile/api-tokens>.
- `CLOUDFLARE_ACCOUNT_ID` — your account ID, shown in the dashboard sidebar.

Push to `main` and `.github/workflows/deploy.yml` typechecks, tests, applies
pending D1 migrations, then deploys. Migrations run before the code that needs
them, so a deploy never lands against a schema that does not have its columns
yet.

By hand, while setting up:

```bash
npx wrangler login
npx wrangler d1 migrations apply clientregister-db --remote
npx wrangler deploy
```

## Secrets

### The two rules that catch people

**1. Setting a secret does nothing until a deploy runs.** Values live in GitHub
and reach the Worker only when the *Deploy* workflow uploads them. Save a secret,
walk away, and the register carries on with the old value — no error, no warning,
nothing in the log. Every change ends with **Actions → Deploy → Run workflow**.

**2. A name has to be in two places.** `scripts/collect-secrets.mjs` lists what
may be uploaded, and the `env:` block of the *Collect configured secrets* step in
`.github/workflows/deploy.yml` is what puts the values where that script can see
them. A name in one but not the other is a secret an administrator can set, watch
deploy successfully, and never have take effect. That happened to the three Gmail
credentials; `test/secrets.test.ts` now fails the build if any name on the list is
missing from the workflow.

### What each one is for

| Secret | Needed for | Notes |
|---|---|---|
| `SETUP_TOKEN` | creating the first account | Only `/setup` uses it. Remove it afterwards. |
| `INGEST_EMAIL_ALLOWED_SENDERS` | inbound mail | Comma-separated. Mail from these addresses becomes an inquiry; everything else waits in Incoming. Unset means nothing is ever trusted. |
| `TELEGRAM_BOT_TOKEN` · `TELEGRAM_WEBHOOK_SECRET` · `TELEGRAM_ALLOWED_USER_IDS` | Telegram ingest | |
| `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_ALLOWED_SENDERS` | WhatsApp ingest | |
| `NZBN_API_KEY` · `NZBN_USE_SANDBOX` | company lookup | Free key from `portal.api.business.govt.nz`. |
| `AI_PROVIDER` · `ANTHROPIC_API_KEY` | the assistant | `AI_PROVIDER=anthropic`. Which model runs is a *setting*, not a secret — Settings → AI Assistant. |
| `MAIL_PROVIDER` | outbound mail | `gmail` or `resend`. This one switch decides which transport is used; the other transport's secrets are simply ignored. |
| `MAIL_FROM` | outbound mail | `Name <address>`. On Gmail it **must** be the authorised mailbox — Gmail refuses to send as anything else. |
| `RESEND_API_KEY` | outbound via Resend | Sending access only, scoped to the verified domain. |
| `GMAIL_CLIENT_ID` · `GMAIL_CLIENT_SECRET` · `GMAIL_REFRESH_TOKEN` | outbound via Gmail | Scope `gmail.send`. The message lands in that account's own Sent folder. |
| `GMAIL_INBOX_REFRESH_TOKEN` | reading a mailbox | Scope `gmail.readonly`. **Never the sending account's token** — it is what names the mailbox. |
| `GMAIL_INBOX_CLIENT_ID` · `GMAIL_INBOX_CLIENT_SECRET` | reading a mailbox | Fall back to the sending pair only when both accounts are in the same Google project. A refresh token is bound to the client that issued it, so a token from a different project needs its own pair. |
| `GMAIL_INBOX_ADDRESS` | display only | Lets the integrations page name the mailbox being read. Authorises nothing. |
| `GDRIVE_CLIENT_ID` · `GDRIVE_CLIENT_SECRET` · `GDRIVE_REFRESH_TOKEN` | reading the practice's Google Drive | Scope `drive.readonly`. **Its own OAuth client, never the mail one** — revoking Drive must not stop outgoing mail, and the two grants carry different scopes. Nothing falls back to `GMAIL_*`. Without all three there is no Drive card on a matter at all. |

### Setting or changing one

1. **GitHub → repo → Settings → Secrets and variables → Actions.**
2. **New repository secret**, or the pencil icon to change an existing one.
3. **Actions → Deploy → Run workflow** on `main`. Nothing happens until this
   finishes.
4. **Verify.** Open the run's *Upload secrets to the Worker* step. It prints one
   line per name and a count — that is the only place the names are visible, and
   the count going up is the proof the change arrived. Values are never printed.
5. **Confirm the effect** in the application, under **Settings → Integrations**,
   which says what is configured and what is still missing.

### Adding a new secret name

Three edits, all required:

- `scripts/collect-secrets.mjs` — add the name to `SECRET_NAMES`.
- `.github/workflows/deploy.yml` — add `NAME: ${{ secrets.NAME }}` to the `env:`
  block of *Collect configured secrets*.
- `src/types.ts` — add it to `Env` so the code can read it.

`test/secrets.test.ts` holds the first two together.

### By hand, if you must

```bash
npx wrangler secret put NAME     # set
npx wrangler secret list         # see what is set (never the values)
npx wrangler secret delete NAME  # remove
```

A secret set only in the Cloudflare dashboard is invisible to this repository, so
nobody reading the code can tell it exists, and a redeploy into a fresh account
will not reproduce it. Prefer the pipeline.

### Rotating

Most secrets rotate by replacing the value and deploying. Two do not:

**A Gmail refresh token dies if its OAuth app is left in *Testing*.** Google
issues seven-day tokens to unpublished apps, so mail stops a week after setup
with nothing visibly wrong. A Workspace address avoids this entirely — its
consent screen is *Internal*, which has no expiry, no verification and no
warning. A personal Gmail account must be **published** (*In production*) before
the token is taken. Revoking access in the Google account, or changing that
account's password, also invalidates the token.

## What storage actually costs

Worth knowing before deciding what the register should keep, because the
intuition that "files are expensive" is from a different era of hosting.

**R2 charges for storage and operations, and nothing for egress.** The free
allowance is 10 GB stored, 1 million writes and 10 million reads a month; beyond
it, storage is about US$0.015 per GB-month. A practice holding 5 GB of scans
pays nothing. At 50 GB it pays about 60 US cents a month. Downloading a document
a thousand times costs nothing at all, which is the charge that makes object
storage expensive elsewhere.

So the thing to watch is not size, it is **how many copies of the same bytes
exist**. Two decisions keep that at one:

- **Inbound attachments are recorded but not kept.** A message stores its
  attachments' names, types and sizes; the contents are discarded. Forwarded
  mail carries signature images, logos and newsletters, and keeping all of it
  would fill the register with things nobody will ever open.
- **An outbound attachment is a reference to a document already on the file**,
  never an upload made at the moment of sending. Sending a document costs one
  read and stores nothing.

The database is smaller still: text and dates, a few megabytes for a practice
with hundreds of matters.

**Where cost would actually come from**, if it ever did: storing every inbound
attachment automatically, or making a copy of a document each time it is sent.
Neither is done, and both are worth refusing again if they are ever proposed.

## Migrations

Numbered files in `migrations/`, applied in order and tracked in the
`d1_migrations` table.

```bash
npm run db:migrate:local     # local dev database
npm run db:migrate:remote    # production
npx wrangler d1 migrations list clientregister-db --remote
```

Rules: never edit a migration that has been applied — write another one. Never
`DROP` a column that live code still reads; deploy the code that stops reading
it first.

The initial four migrations (`0001`–`0004`) were applied directly through the
Cloudflare API when the register was built, and recorded in `d1_migrations`, so
`wrangler d1 migrations apply` picks up cleanly from `0005` onward.

## Plan requirements

The Workers **Free** plan allows 10ms of CPU per request. Hashing a password
costs roughly 15ms, so sign-in sits just over the line and relies on the burst
allowance Cloudflare grants to workers that exceed the limit infrequently. If
sign-in ever fails with Cloudflare error 1102 (`Worker exceeded resource
limits`), that is what happened — the Workers **Paid** plan ($5/month) raises
the limit to 30 seconds and removes the question. R2 document storage needs a
payment method on the account anyway.

On the Paid plan, raise the password work factor to the OWASP figure by setting
`PBKDF2_ROUNDS` to `6` in `src/core/crypto.ts` and deploying. Existing users are
re-hashed transparently the next time they sign in.

## A caseload to practise on

The register can be loaded with a fabricated caseload — twelve clients, their
matters, quotations and invoices — so somebody learning it has something to
look at.

**Admin → Test data** lays it down and takes it away again, from inside the
register. Every row is written already marked as test data, the page lists what
it would delete before deleting it, and only an administrator can reach it. The
files carry the awkward shapes on purpose — a decline and its reconsideration, a
section 61, an expired certificate beside a current one, an invoice part paid —
because a caseload of clean grants teaches nobody anything.

There used to be a **Demonstration data** workflow in the Actions tab that
wrote invented clients straight into the practice's live register with one
click, using the same credentials as a deploy. It was **deleted on 12 September
2026** — the practice decided it was no longer needed now the Test data page
does the same job from inside the register. Nothing replaces it in the pipeline:
test data is laid down by a person signed in as an administrator, not by CI.

The card on Admin → Maintenance that removed those rows went too, in 1.62.0.
It only ever appeared when rows whose identifier began `demo_` were present, and
both registers were checked before it was deleted: the practice's holds 245
clients and 199 matters and not one such row; the trial holds nothing at all.
A card that can never appear is a thing to delete, not to carry.

**If a register ever does turn up with `demo_` rows** — a copy restored from an
old backup, say — they are removed with a `DELETE` against that prefix. The
statements are in the history of `scripts/seed-demo-remove.sql`, deleted in the
same change. That is a deliberate trade: the button was standing code paid for
every day against an event that has not happened and now cannot.

## Backups

**There is a nightly backup, since 12 September 2026.** It runs in the register's
own overnight pass, writes a copy of the whole database into R2 under
`backups/`, reads the bytes back to confirm they are there, and keeps the last
30 by default. Settings → Nightly backup turns it down; it is on by default and
never removes the newest archive whatever the count is set to.

Whether it is actually happening is on **Settings → Exports and backups**, as a
date rather than a tick. A register with no backup for two nights shows a red
band there. That page is the one to look at if you ever wonder.

### What it protects against, and what it does not

- **The database.** Rows deleted by mistake, a bad change, a table dropped, the
  database itself gone. That is the likely bad day and this answers it.
- **Not the Cloudflare account.** The archive is written inside it. Losing the
  account loses both. For that, take a manual backup from the same page and
  keep it somewhere else — that copy is the whole register including the
  documents, which the nightly one leaves out.
- **Cloudflare's own Time Travel** can rewind a D1 database to a point in time
  and is a genuine safety net, but it is their copy in their account. This is
  the practice's own, which is the point.

### The documents are not in the nightly one

Deliberate, for two reasons. They already live in the bucket the archive is
written to, so copying them from a bucket into a file in the same bucket buys
nothing against a lost database. And the archive is built in memory inside a
Worker: one that grows with every document uploaded works every night until the
night it silently stops.

The manual backup button includes them. That one is for taking the register
away with you.

### On a register with no document store

The trial has no R2 bucket yet, so it has **no automatic backup** and its
Exports page says so in those words. Creating that bucket is the step that
turns its backups on — see the trial section above for why it is created by
hand from a browser in New Zealand.

### Taking one by hand, or restoring

## Scheduled work

The cron trigger (`0 19 * * *` UTC — 07:00 the next morning in New Zealand)
runs `scheduled()` in `src/index.ts`:

- flushes the outbound mail queue,
- expires quotes past their validity date,
- writes a `cron.housekeeping` audit row so you can see it ran.

## Monitoring

```bash
npx wrangler tail                     # live logs
npx wrangler tail --status error      # errors only
```

Observability is on in `wrangler.jsonc`, so logs are also in the dashboard under
Workers → clientregister → Logs. Every response carries an `X-Request-Id`; the
same id appears in the log line for an unhandled error and on the error page, so
a user can quote it.

`/healthz` returns `{ok: true}` without touching the database — suitable for an
uptime check.

## The audit log cannot be pruned

`audit_log` is append-only at the database: triggers refuse UPDATE and DELETE
from every caller. That is deliberate, and it means the table only grows. It is
small — a row is a few hundred bytes — so this is a question for years from
now, not months.

When it does need trimming, export first and drop the triggers deliberately in
a numbered migration, so the repository records that history was truncated and
by whom:

```sql
-- migrations/00XX_archive_audit.sql
DROP TRIGGER audit_log_is_append_only_delete;
DELETE FROM audit_log WHERE at < '2027-01-01';
CREATE TRIGGER audit_log_is_append_only_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: rows cannot be deleted');
END;
```

## Routine checks

- **Admin → Audit log** — sign-ins, failures, record changes, passport reveals,
  document downloads.
- **Admin → Users** — everyone should have two-factor on. Suspend leavers
  immediately; suspension revokes their sessions at once.
- **Admin → Integrations** — shows what the running Worker actually has
  configured.

## Recovering access

**Locked out of an account:** another owner or administrator can reset the
password from Admin → Users, which issues a one-time temporary password and ends
that user's sessions.

**Locked out of every account:** there is no back door by design. Delete the
user rows through the Cloudflare dashboard's D1 console, then set a fresh
`SETUP_TOKEN` and use `/setup` again — it only works while the register has no
users.

**Suspected session compromise:** suspend the user in Admin → Users (revokes all
their sessions), or clear the KV namespace to sign everybody out at once.

## Letting somebody try the register

**Asked for on 11 September 2026:** *"I need a user status that can ONLY see and
play with the test data ... This is so that some users can try the system and
learn."*

The caseload half of that is built — Settings → Test data lays down twelve
invented files, puts them back on demand, and can put them back on a timer. The
**login that can only see them is not**, and this is the reasoning, so nobody
re-opens it without a better answer.

### Why a trial role inside this register would be unsafe

A role is a list of what somebody may *do*. Holding a person inside the test
data is a different thing: it is a condition on what they may *see*, and the
only place to enforce that is the queries. There are over six hundred of them
and 228 routes. Every list, every search, every count, every dropdown that
offers a client would need "and only the test data" adding to it.

That is precisely the fault the one-database-each decision of 3 September 2026
was made to avoid, in the same words: *"the one somebody forgets does not
produce a bug report — it shows one law firm another firm's client files."* A
trial user is the same problem wearing different clothes. The failure is silent,
and what leaks is a client's identity documents.

The database cannot help here either. SQLite has no row-level security, and a
trigger can refuse a write but cannot filter a read.

### What to do instead

**Give the person their own copy of the register.** A second Worker, a second D1
database, a second address — the arrangement already chosen for a second
practice, and already possible today.

In that database:

1. Sign in and create their account as normal.
2. Settings → Test data → **Load the caseload**.
3. Settings → Practice caseload → **Put the caseload back every 15 days**.

There is then nothing to restrict, because there is nothing else in the
database. Every query is already only about test data. Somebody can delete a
client, accept a quotation, void an invoice — all the things you would never let
them do here — and in fifteen days it is back as it was.

This is also the honest answer to *"only see the test data"*: they see only test
data because there is only test data.

### What is still missing before doing this

Nothing in the code. What is missing is the same thing missing everywhere else
in this document: the nightly backup is **inside the Cloudflare account**, and a second
deployment is a second database nobody is backing up.
