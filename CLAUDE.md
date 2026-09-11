# Working on this register

Standing decisions, so they survive a new session. Detail lives in
[ARCHITECTURE.md](ARCHITECTURE.md); this is what to hold in mind while working.

## Build direct. No bridges unless absolutely necessary.

When something changes shape — a reference format, a column, a table — change it
and move on. Do not leave a compatibility layer behind: no old→new mapping
tables, no "also check the legacy field", no dual-write, no shim the application
then carries forever. Migrate the data directly and delete the old way.

A **migration** is not a bridge: it runs once per database at deploy and is then
finished, with no runtime cost. Migrations are the preferred tool. What is
forbidden is the *permanent* accommodation — the code path that exists only
because something used to be different.

### When a bridge *is* the right answer

The default is direct. A bridge is warranted when one of these is true:

1. **Data would be lost or put at risk** by changing directly, and that risk
   cannot be removed by rehearsing the change on a copy and verifying the result
   before and after. Never trade records for tidiness. A bridge that keeps every
   record beats a direct change that loses one.
2. **An outside party depends on the old shape** and cannot be updated — INZ, a
   bank, a client's saved link.
3. **The direct change would cost out of proportion** to what it buys.

This weighing changes as the register fills with real data. On an empty register
direct is nearly always right; once the practice is working in it daily, the
first test carries more weight than the other two, and "we would have to rebuild
a lot" becomes a real answer rather than an excuse.

What is actually forbidden is the *unremarked* bridge — the fallback that
appears because it was easier that afternoon and is still there in two years
because nobody wrote down why. So: whichever way it goes, say which and why,
keep the bridge as small as it can be, name it in the code, and write down what
would let it be removed.

One thing genuinely cannot be changed directly, and is not an exception to this
rule but a fact about the data:

- **The audit log and file notes are append-only.** They record what was said at
  the time. Never rewrite them to make history tidy.

(An earlier rule here — that `FIELD_KEY` must never change — retired with
migration 0042: passport numbers are stored as written, by the practice's
explicit decision of 30 August 2026. They still stay out of bulk exports.)

## The register is live

Since 30 August 2026 the register holds the practice's real client files. This
is the fact the "when a bridge is right" weighing already anticipates: the
first test (never put records at risk) now outranks tidiness every time. Any
change that touches production data is rehearsed on a scratch database seeded
from a production snapshot, and the rehearsed SQL — not a re-derivation of it —
is what runs against production. Data-loading tooling lives outside the
repository (real client data never enters it).

## Releases

Every user-visible change ships as a release, and a release is three edits
that must agree: the version in `package.json` (middle number for a feature,
last for a fix), a `CHANGELOG.md` entry, and a line under Help → Recent
changes (`RELEASES` in `src/modules/help/index.ts`) written in the practice's
voice — plain words a non-developer reads without translation. Merges to
`main` go through a pull request: the branch ruleset requires the CI `check`,
and the merge method is rebase.

**Merge and deploy without being asked** (standing instruction, 3 September
2026). Do not stop at a green pull request to ask whether to merge it: when CI
passes and nothing is outstanding, merge it and let the deploy run. Say what
shipped afterwards. This applies to work the practice has already asked for —
it is not licence to widen the work, and a change nobody asked for still gets
put to them before it is built.

## Who you are working with

The owner runs an immigration law practice and is not a developer. Answer in
plain language, explain a term the first time it appears, and when the answer
is "it depends", say what it depends on in one sentence. "Do not understand —
clarify" means shorter and more concrete, not more detail. Standing
instruction (31 August 2026): be brief and to the point, no fluff.

**Write plainly (standing instruction, 11 September 2026).** Shown five styles
of the same explanation and asked to choose, the practice picked the plainest:
*"mostly use #1. simple."* That style was short sentences, ordinary words, no
jargon, and the point first — *"Until today, a fee quote could only go to one
person. If you put two addresses in the To box, the email silently failed. I
found it while building the address picker, and fixed it."*

What that rules out: the shape of an explanation that names functions, files and
mechanisms. That version is accurate and nearly useless here. Say what changed,
whether it affects them, and what they need to do. The mechanism belongs in the
code comment and the commit message, where it is already written down.

When they say they do not follow, the fix is **shorter and more concrete**, not
more detail — walk through what actually happens, step by step, with real
things.

**End the day with a digest** (standing instruction, 9 September 2026): *"i do
not always have time to read your writing but i want to - so at the end of the
day produce easily readable digest of what has been accomplished."* Plain words,
grouped by what changed for the practice rather than by release number, and
short enough to read in a couple of minutes. What shipped, what it means for
them, what is waiting on them. It is not a changelog — `CHANGELOG.md` is already
that — and it is not per-change commentary during the day, which is the thing
they do not have time for.

## One practice, one database

Decided 3 September 2026, when the practice said the register will be sold to
other practices in time. **A second practice gets a database of its own.** Not a
shared database with a "which practice" column on every table.

The reason is what the register holds. Under a shared database, every one of the
614 queries in this application has to remember to say "and only this practice",
and the one somebody forgets does not produce a bug report — it shows one law
firm another firm's client files. With a database each there is no query to
forget. This is also what the code already is: every query here assumes the
whole database belongs to one practice, and that assumption becomes the
isolation rather than something to be undone.

**What this means while working now:** nothing changes, and nothing is being
built for it yet. The practice's own register is the only one. But do not
introduce anything that would have to be unpicked later:

- No table gets a tenant column, and no query gets a tenant clause. The database
  boundary *is* the tenant boundary.
- Anything that differs between practices belongs in `settings` or a vocabulary,
  not in the code — because those already live inside the tenant's own database
  and so become per-practice for free.
- Nothing may assume there is exactly one row in `settings` for the whole world,
  one practice name, or one sending address.

**Answered on 12 September 2026**, when the practice said a paying customer
wanted a trial. A database does have to be named at deploy time *for*
`wrangler deploy` — but each practice is a Wrangler **environment** with its own
bindings, deployed from the same bundle by the same workflow, so "a deployment
per practice" costs a config block rather than a repository. Past about ten, the
Workers API accepts a script upload with its bindings supplied in the request,
so no config file needs to exist at all. Both are confirmed, not assumed.

**The architecture, the costs and the order of work are in
[`docs/second-practice.md`](docs/second-practice.md).** Read it before touching
anything to do with a second practice. The runbook — what exists, how to turn a
trial on, and how to check the two are actually separate — is in
[`docs/operations.md`](docs/operations.md).

What is built: an `env.trial` block, its own D1 and KV created on 12 September,
and a deploy job that migrates and deploys it *after* the practice's own
register, gated on a `TRIAL_SETUP_TOKEN` secret existing. `test/tenancy.test.ts`
refuses a configuration where two registers share a database, a session store or
a bucket — that shared binding is the one fault here that cannot be seen from
inside the application, because every query is *supposed* to return everything.

**Still true, and still the order of work:** the shape and running routines of
the app settle first. A second practice is still set up by hand, and that will
not scale past about ten. The automation is worth building once somebody has
paid — and **before another firm's files are held here at all, the backup is.**

One thing to do before another practice's files are held here at all: **there is
still no automated backup.** See `docs/operations.md`.

## The other standing decisions

- **Security, modularity and mobile-friendliness rank first** — ahead of how it
  looks. A fast, plain page beats a slow, handsome one.
- **Invariants belong in the database**, as triggers and constraints, not in the
  route that happens to write the row. A guarantee in a handler lasts until
  somebody adds a second handler.
- **The register must work with the AI switched off.** The AI proposes; a person
  presses the button. Nothing it produces is written without that press.
- **Every dropdown the practice uses is editable by an administrator**, without a
  deployment. See `core/vocabulary.ts`.
- **Tabs when a page would run past one screen.** Established rule.
- **One fact, one owner.** Where a value is derived, say so and let one place
  write it. A form that no longer owns a column must not write it.
- **Real client data never enters the repository** — not in tests, fixtures,
  seeds or commit messages. It belongs in the production database only.
- **Push back when a request would not work**, briefly, then build what was
  actually asked for if the answer stands. This has been asked for explicitly.

## Verifying

**Never pipe a test or typecheck run into `head` or `tail` inside an `&&`
chain.** A pipeline's exit status is that of its *last* command, so `npx vitest
run | tail -3` reports success however badly the tests failed, and the chain
carries on to commit and push. Use `set -o pipefail`, or run the command and
read its output separately. This has already put one red build on main.

Prove behaviour rather than assuming it. Database guarantees are checked by
attacking the database directly, not through the application. Browser behaviour
— sticky headers, hidden sections, tab interactions — is checked in Chromium
with Playwright, then pinned with a test that asserts the rule rather than the
appearance. Migrations that touch existing data are rehearsed on a scratch
database first.
