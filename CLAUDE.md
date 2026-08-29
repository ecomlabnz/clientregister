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

"Unless absolutely necessary" means: an outside party depends on the old shape
and cannot be updated (INZ, a bank, a client's saved link). Then say so
explicitly, keep the bridge as small as possible, and write down what would let
it be removed. Convenience is not necessity.

Two things genuinely cannot be changed directly, and are not exceptions to this
rule but facts about the data:

- **The audit log and file notes are append-only.** They record what was said at
  the time. Never rewrite them to make history tidy.
- **`FIELD_KEY` must never change.** Passport numbers are sealed under it;
  rotating it makes every stored number unreadable.

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

Prove behaviour rather than assuming it. Database guarantees are checked by
attacking the database directly, not through the application. Browser behaviour
— sticky headers, hidden sections, tab interactions — is checked in Chromium
with Playwright, then pinned with a test that asserts the rule rather than the
appearance. Migrations that touch existing data are rehearsed on a scratch
database first.
