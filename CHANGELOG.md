# Changelog

Notable changes to the Client Register, newest first. Dates are New Zealand
time. Versions follow [semantic versioning](https://semver.org): the middle
number moves when a feature lands, the last when something is fixed.

The user-facing version of this list, one line per release, is in the app under
**Help → Recent changes**.

## 0.83.0 — 1 September 2026

### Fixed
- **The third form that opens a matter did not name it either.** Found in
  review, on this branch: converting an inquiry to a matter still asked for a
  title and wrote no description — the same fault as the one below, in the last
  of the three places that create a matter. All three now ask the one question
  and derive the title from the answer.

### Security
- **The five-minute correction window uses the database's own clock.**
  Migration 0052 measured the window from `created_at` to the `edited_at` the
  caller supplied. That is sound for the handler that exists and is not a
  guarantee: a future handler stamping `edited_at = created_at + 1 second`
  could correct a note years afterwards and pass every check. The whole reason
  the rule lives in a trigger is that a second handler must not be able to
  disagree with it, so migration 0057 has the trigger read the clock itself, and
  requires the claimed moment to be the real one.

  Two more gaps closed with it, both of which the route covered alone: a note
  the register wrote about itself can no longer be corrected at all, and the
  text as it stood is now written to the audit log **by the database**, in the
  same statement as the correction. The route keeps its own record of who made
  the correction and from where; the database owns what the note said.

- **Migration 0055 checks before it converts.** A migration runs statement by
  statement with no transaction around it, so the original convert-then-verify
  order would have aborted with half the conversion already committed — exactly
  the column half in codes and half in names the migration's own header calls
  worse than either. The check is built from the pre-state and aborts before the
  first change. Rehearsed: on an unconvertible country the run stops and every
  value is left exactly as it was.


- **A matter opened from a document arrived with no description.** Found on the
  live register, one matter in. Migration 0049 made the description the name of
  a matter and took the title field off the matter form; the form that opens a
  matter from a read document was not changed with it, so it still asked for a
  title, wrote that to `title`, and left `descriptor` empty — the column the
  case list, the client's file and the AI brief all now read.

  The form now asks the one question the rest of the register asks — "What this
  matter is about" — and the title is derived from it, written from one place.
  Migration 0056 repairs the one matter already written that way, taking its
  title as its description exactly as 0049 did for the matter it found in the
  same state.

### Changed
- **Passports and certificates are on the file, not in the margin.** Both sat
  in the narrow right-hand column with their forms folded behind a line of
  small text. A passport is the travel document a matter works from and a
  police certificate decides whether an application can be made at all;
  entering them on a sideline was the wrong shape for what they are. Both cards
  move to the main column and their forms open from real buttons — "Add another
  passport", "Add a police certificate, medical or x-ray".

- **A country is chosen from a list, everywhere.** Passport country and
  certificate country were free text, and free text produced exactly what it
  always does: the live register held 30 passports issued by "Viet Nam" and 9
  by "Vietnam", the same country, which could never be counted, filtered or
  matched as one. Nationality has been a country code with a trigger behind it
  since migration 0030; these are the same kind of fact and now hold the same
  kind of value.

  Migration 0055 converts what is stored. Four of the six names in the register
  convert by a join against its own country list; the other two are the ISO long
  forms ("Viet Nam", "Russian Federation") where the list holds the short ones,
  and they are named one line each rather than resolved by a fuzzy match — a
  fuzzy match over country names is how a passport ends up issued by Niger
  instead of Nigeria. Anything that will not convert **aborts the migration**: a
  column half in codes and half in names is worse than either, and that is the
  only moment it can be caught. Rehearsed at the register's exact shape,
  including the abort.

- **The Immigration tab has a way through to certificates**, instead of a
  paragraph in grey text explaining where they live. They stay separate records
  rather than one set of dates on the form, and that part cannot change: a
  client may hold police certificates from three countries at once, and a new
  medical must not overwrite the one a March application relied on — that has to
  stay answerable.

- **A knowledge-base article carries its year**: KB-26-001, not KB-0001, on the
  same pattern as a matter's reference and through the same counter. Immigration
  instructions date quickly, so when an article is from is part of what it is.
  Migration 0054 renumbers what is filed, taking each article's year from its
  own creation date rather than assuming this one, and sets the yearly counter
  so the next article follows on.

## 0.82.0 — 1 September 2026

### Added
- **Five minutes to fix a slip.** A file note was saved with the wrong date on
  it and there was no way to put it right.

  Migration 0014 made entries append-only and that reasoning still holds in
  full: a note editable months later is not a record of what happened, it is a
  record of what somebody now wishes had happened, and it is worth nothing in a
  complaint, a standards inquiry or a Tribunal appeal. What migration 0052
  admits is narrower. For the first five minutes a note is not yet a record
  anybody has relied on — it is the sentence just typed, with the wrong date in
  it, still on the screen. Refusing that correction does not protect the file;
  it puts a wrong date on it forever, with a second note underneath explaining
  the first.

  The window is deliberately hard, and the database enforces it, not the
  screen: five minutes from when the note was written, once, by the person who
  wrote it, and only the text, the kind and the date it happened. Who wrote it,
  when it was written and what it is attached to cannot change at all, and a
  correction that does not mark itself as one is refused — so a corrected note
  always shows as corrected. The previous text goes to the audit log, which is
  append-only without exception.

- **"Preliminary consultation" is a kind of note.** A first meeting is the one
  that decides whether there is a matter at all, and what was said in it is the
  thing most often gone back to.

- **"Brief" is a document category.** Categories are vocabulary an
  administrator edits in Settings, but the register has held the defaults
  unchanged since it was seeded, so migration 0053 adds it to the value
  actually stored — once, and skipped if it is already there.

### Changed
- **A timestamp shows the time, everywhere.** A file with two notes written the
  same afternoon has to be able to say which came first, and "01 Sept 2026"
  cannot. Every moment the register recorded — when a note was written, when a
  record was updated, when a message arrived — now shows date and time.

  Set a size or two smaller than the text around it, in `em` so it stays in
  proportion wherever it sits, with the time smaller and quieter again than the
  date: a timestamp is a thing you check, not a thing you read, and at the size
  of the sentence beside it it competes with the sentence.

  Dates that are genuinely dates — a birthday, a visa expiry, the day a matter
  was lodged — are untouched. They have no time and must not be given a made-up
  one.

### How it is built
- `stamp()` in `ui/components.ts` is the one renderer, and it decides from the
  stored value: an instant gets its time, a date somebody typed does not.
- `timelineItem()` is shared by clients, matters and inquiries, which had three
  copies of the same markup that had already drifted apart.
- The correction rule lives in `core/timeline.ts` for the screen and in the
  0052 trigger for everything else. The tests attack the database directly —
  late, twice, silent, backdated, and each field that may never change.

## 0.81.0 — 31 August 2026

### Changed
- **A person may hold more than one nationality.** Reported from a real
  partnership file: the supporting partner is a national of Vietnam and of New
  Zealand, the document says so plainly, and the register recorded neither —
  the form had one dropdown, the phrase resolved to no single country, and the
  box came back "Not recorded".

  That is not a display fault. Dual nationality decides whether somebody needs
  a visa at all, which police certificates are required and which passport an
  application is made on. A field that cannot hold the answer is worse than no
  field, because it looks answered.

  `clients.nationality` becomes `client_nationalities` in migration 0050 — a
  table, not a second column and not a comma-separated string. `position` keeps
  the order, because the first answers "which passport" and the rest do not.
  The country-code trigger from migration 0030 moves across intact rather than
  being dropped for convenience. Measured first: 59 clients, 39 carrying a
  nationality, every one of them moved to a single row. Rehearsed on a scratch
  database at that shape before it ran.

  The form shows one box per nationality held and always one spare, so a third
  is added by filling it in and saving. Boxes rather than a multi-select
  (ctrl-clicking is a developer's gesture) and a spare rather than an "add
  another" button (the content policy forbids an inline script, and a control
  that stops working when script is blocked is a field nobody can reach).

- **The reading form has the boxes it was missing.** Current visa, visa expiry
  and nationalities, for the client and for everybody else the document names.
  These were columns the register already had — they were missing from that one
  form, which is the worse of the two: the reading found the answers, there was
  nowhere on the screen to put them, and they were lost at the last step.

- **What the reading says is kept as a file note.** Most of what a partnership
  summary carries has no column to go in — a relationship history, two previous
  marriages and their dates, where a child lives, an address, an assault
  reported to Police — and it was read once, shown on a form and dropped. The
  matter's summary field is a working description somebody edits; a file note
  is the record of what a document stated on the day it arrived, and file notes
  are append-only. The summary box is twelve rows and eight thousand characters
  rather than four and two thousand, which had been cutting a three-page
  document off mid-sentence.

- **Choosing an existing client fills only its empty boxes.** A document is
  evidence of what somebody wrote on a form once; the record is what the
  practice knows now. A reading that quietly replaced a corrected visa expiry
  with an older one would be worse than one that filled nothing in.

### How it is built
- `core/nationalities.ts` is the single owner. Nothing outside it writes the
  table, and nothing anywhere assembles the list from a column — the column is
  gone. `codesFromText` splits what a document actually writes: "Vietnam and
  New Zealand", "dual Vietnamese/New Zealand citizen".
- The invariant tests moved to the new table rather than being deleted with the
  old column, and gained the case that started this: one person, two
  nationalities, in order.

## 0.80.0 — 31 August 2026

### Added
- **The reader takes Word documents.** A partnership information form was
  dropped into the intake tool and came back "this cannot read". Nothing was
  wrong with the file: a `.docx` is not a document in the way a PDF is, it is a
  ZIP archive whose words live in one entry inside it. Its bytes are not text
  and no model reads them, so there was simply nothing here that could open it.

  `core/docx.ts` opens it — finds `word/document.xml`, inflates it, and turns
  WordprocessingML into the text a person would have copied out by hand.
  Paragraphs become lines, a table row stays on one line with its cells apart,
  breaks and tabs survive, and text the author had deleted under tracked
  changes is left out, because a crossing-out is not part of the document.

  Written rather than installed, for two reasons. The libraries that do this
  each carry a ZIP implementation, and the platform already has the only piece
  that is hard: `DecompressionStream('deflate-raw')` is exactly the
  decompressor a ZIP entry needs. And a dependency that unpacks untrusted
  archives is a large thing to take on trust for a job this size.

  Still refused, and now saying which: `.doc`, the old binary format, and a
  password-protected document.

### Security
- **A Word document is decided by what is inside it, not by its name.** The
  browser's media type comes from the file extension, so it is absent as often
  as it is wrong; a spreadsheet renamed `.docx` is turned away by its contents.
- **An archive that inflates past 8 MB is refused.** An upload limit is no
  protection against what is inside the upload: a few kilobytes of zeroes claim
  ten megabytes. Proven with an archive built to do exactly that.

### Fixed
- **The intake page said passport numbers are not extracted "because that
  column is encrypted".** The rule is right and the reason was out of date —
  the column stopped being encrypted on 30 August, by the practice's explicit
  decision, and the passage was left behind. Corrected here and in the comment
  on `ai/brief.ts` that made the same claim. Passport numbers are still never
  extracted and still stay out of exports.

## 0.79.0 — 31 August 2026

### Changed
- **Every section on a matter folds.** A matter page runs to a dozen sections
  — status, parties, tasks, files, notes, tags, key details, next action,
  quotes, summary — and which of them matter depends on what the file was
  opened for. Each heading is a handle now.

  They open on load, all but one: a section you cannot see is a section you
  forget to read, so the default is everything visible and folding is
  something the reader chooses. The fold is not remembered between page loads,
  and that is deliberate — a section missing because of something you did on
  another matter last week is worse than one you close again.

- **Fees is the exception**, and still starts closed for the reason it always
  has: it is the one thing on the page a client leaning over the desk should
  not read by accident. Worth repeating what that is and is not — a screen to
  click past, not access control. Who may see money is a question of roles.

- **"Fees and split" is now just "Fees".** The section was named after two of
  the things inside it rather than after the one thing it is.

### How it is built
- `foldingCard` beside the existing `card` and `collapsibleCard` in
  `ui/components.ts` — `<details open>`, like every other disclosure here,
  because the content policy forbids an inline script and a fold that stops
  working when script is blocked is a section nobody can reach.
- `test/casefolds.test.ts` pins the rule rather than the arrangement: every
  section on a matter folds, exactly one starts folded, and it is Fees. Both
  halves proven by breaking them and watching the tests fail.

## 0.78.1 — 31 August 2026

### Fixed
- **Saving a split answered "Not found".** Reported from a real matter: ticking
  "remove" beside a party on a matter's Fees and split section and pressing
  Save split landed on the stale-link page.

  Nothing was wrong with the form or the handler. `POST /cases/:caseId/fees/shares`
  was registered *after* `POST /cases/:caseId/fees/:feeId`, and a parameter
  matches any single segment — so the router read "shares" as a fee line's id,
  found no such fee and said so. The literal route now goes first.

  No data was at risk: the split was never written, so nothing was wrong in the
  meantime. The check that pins it looks at every module rather than this one,
  because the next route to be swallowed will not be in the fees module — a
  literal registered behind a parameter is unreachable and nothing says so
  until somebody presses the button.

- **A menu heading nudged upwards when its menu opened.** The bar held still
  and the word inside it rose six pixels. Same unstyleable twelve-pixel box as
  0.78.0: it sits beside the summary as a flex item, and centring measures
  itself against the pair rather than against the stated height. The heading is
  pinned to the top of its box instead, level with every other item in the run,
  open or closed.

## 0.78.0 — 31 August 2026

### Changed
- **A matter is named by what it is about.** Every matter was called
  "SURNAME, Given — Type": the client column and the type column, read back.
  That was not carelessness — the form pre-filled the title from the client and
  the type as they were chosen, and a field that arrives looking plausibly
  complete is never replaced. It buys the appearance of being answered at the
  cost of the answer. So the title field is gone from the form and the
  description is the one name a matter has: "Fresh application, chef role with
  her current employer".

  `title` stays as a column, NOT NULL, still read by the matter's own heading,
  the client's case list and the AI brief — but it is *derived* now, written
  from the description and nowhere else. One fact, one owner. The column is
  kept rather than dropped because a practice may one day want a matter named
  something other than its description, and this decision is hours old;
  nothing is lost by leaving it, and the form can offer it again without a
  migration.

  Migration 0049 renames the existing matters. Measured against the live
  register first: 43 of 44 carried a description and one did not, so that one
  takes its title (which was genuinely informative — "Privacy Act request for
  INZ file", not the generated pattern) as its description, and then every
  title follows its description. No heuristic tries to tell a generated title
  from a written one; it does not need to, because where a description exists
  the title was redundant and where it does not the title is all there is.
  Rehearsed on a scratch database at the register's exact shape before it ran.

- **The Matter column is back on the case list, and shows only the
  description.** It was switched off in 0.76.0 because it repeated the two
  columns beside it. Naming a matter by what it is about fixed the cause, so
  the column now carries the one thing no other column says. It is still a
  preference, and the description still appears under the reference when the
  column is off — but never in both places at once, which is what made it look
  redundant.

- **The intake prompt asks for the description, not a title.** The more urgent
  half: without it the next batch would have loaded thirty more generated
  names.

### Fixed
- **The menus in the top bar.** Three faults reported together, with three
  different causes.

  The bar grew twelve pixels taller whenever a menu opened. An open
  `<details>` is not just its summary and its panel: the browser wraps what
  follows the summary in a box of its own, and in Chrome that box is twelve
  pixels tall even when it holds nothing but an absolutely positioned panel
  that needs no room — and it ignores every attempt to style it (`height`,
  `padding`, `line-height` on `::details-content` all land on nothing;
  measured, not assumed). So the height is stated instead: one variable,
  `--nav-item-h`, sets the height of a link and of a menu heading alike, and
  an open menu cannot change it.

  Two menus could be open at once. `name="topnav"` makes the set exclusive in
  the browser itself, so this holds with scripting switched off.

  A menu stayed open after you had moved on. Plain HTML has no way to say
  "close when attention moves elsewhere", so that part is scripted: clicking
  anywhere else closes it, Escape closes it, and choosing an item navigates.
  Deliberately *not* on mouse-out — a phone has no hover, so a menu opened by
  a tap would never close, and on a desktop a menu that vanishes when the
  pointer strays a few pixels is worse than one that stays.

- **The menus were unreachable on a phone**, which the same look found. The
  navigation is a strip you swipe sideways, and a box that scrolls sideways
  clips what overflows it downwards too — so a menu opened inside it dropped
  behind the bar. On a phone the groups now open out into the strip: Quotes,
  Fees, Knowledge and the Assistant sit in the run like everything else, one
  swipe away. Grouping is a wide-screen answer to a bar that has to fit one
  line; the strip never had that problem.

### How it is built
- The form has one naming field. `title` is assigned from it in the values
  builder, so there is one place that writes it and no second handler can
  disagree. The title-suggestion script in `public/app.js` is deleted rather
  than left switched off.
- `test/nav.test.ts` pins each menu rule separately, because each has its own
  cause: the stated height, the absolute panel, `name=`, the closing script,
  and the phone flattening. `test/casedecision.test.ts` pins that the
  description appears once and not twice — proven by putting the duplicate
  back and watching it fail.

## 0.77.0 — 31 August 2026

### Changed
- **The top bar is one line again.** It had reached twelve items and wrapped,
  which is the point at which a navigation stops being scannable — you read it
  instead of glancing at it. Quotes and Fees group under **Money**, Knowledge
  and the Assistant under **Tools**, and Settings and Help move to the corner
  beside the account controls. Eight entries in the run, down from twelve.

  Weighed against a collapsible sidebar, which the practice had asked about. A
  sidebar costs 56px of width collapsed and ~220px open, permanently, on pages
  whose defining feature is wide tables — to save about 70px of vertical space
  once. Collapsed to icons it also asks twelve immigration-practice concepts to
  become twelve glyphs, where "Incoming", "Inbox" and "Alerts" are a guessing
  game. Grouping was the cheaper answer to the actual problem, which was item
  count rather than layout.

### How it is built
- `NavItem` gains `group` and `corner`, so a module still declares its own
  entry and adding one is still a line in that module — grouping is not a list
  kept somewhere central that a new module has to be added to.
- The groups are `<details>`, like every other disclosure here: no script, and
  they close on navigation because each link is a real link. A group whose page
  you are on renders open, so the bar shows where you are without being pressed.

### Guarded
- A test caps the run at eight entries, refuses a group holding only one item
  (a heading hiding a single link behind a press), and — the one that matters —
  asserts every declared destination is still reachable, in the run or in the
  corner. Grouping that loses a page is the failure worth catching.

## 0.76.0 — 31 August 2026

### Changed
- **The Matter and Decision columns are off by default**, and are now
  preferences rather than fixtures. On an AEWV the matter title is the client's
  name and the case type over again — both of which sit in their own columns
  beside it. Turned off, the row keeps the thing the title could not say: its
  short description, under the reference.

  Kept as switches rather than deleted, because the duplication is not
  universal: on a Privacy Act request or a PPI response, the title is the only
  thing on the row that says what the matter is. A practice that works mostly
  in those wants the column.
- **A decision's date sits under the status badge.** "Approved" over
  "31 Aug 2026" needs no third word, where a column headed Decision had to
  print "decided" on every row to explain itself. A matter still waiting shows
  its due date there instead.
- **The Clients page has no subtitle.** It read "Everyone the practice acts
  for", which stopped being true when the register began holding employers,
  sponsors, supporting partners, agents and stub records for people whose
  documents arrived in someone else's folder. A heading that overstates what a
  list contains is worse than none.

### Added
- **Clear**, on the case filters, appearing only when something is filtered.

### Fixed
- A `decided_at` carried over from a matter's earlier life — reopened, or
  imported — printed a bare date under a "Lodged with INZ" badge, reading as a
  decision that had not happened. Caught by looking at the rendered list, not
  by a test; there is a test now.

## 0.75.0 — 31 August 2026

### Added
- **Filter the case list by matter type**, and two new columns: **Type** and
  **Lodged** (the date it went to INZ). Both sortable. The types come from the
  vocabulary the practice edits in Settings, so the filter offers whatever is
  configured rather than a list baked into the page.

### Changed
- **"Key date" is now "Decision", and says which date it is showing.** It was
  showing the expected-decision date whatever the status, so an approved matter
  displayed a deadline that had already passed — which is what prompted this.
  A decided matter now shows when the decision arrived, labelled "decided"; one
  still waiting shows what it is waiting for; otherwise the next action.
- **The status list, on the practice's reading of it.** "INZ — further
  information requested" is removed and "PPI letter received" becomes **"PPI /
  RFI letter received"**: both described one working state — a letter from INZ
  with a clock on it — so the register was asking which of two words to use for
  one thing. Conversely **"Appeal / reconsideration" splits** into **"IPT
  appeal"** and **"Reconsideration"**: two places with two clocks under one
  name could not answer "who is holding this file".

### Fixed
- **A case-type filter that matched nothing.** Its first draft asked for the
  SQL placeholder before pushing the parameter, so it numbered one slot back.
  Typecheck was clean and the page rendered; the only symptom was an empty
  list, which looks exactly like "no matters of that type". Found in the
  browser, not by a test — so there is now a test that fails on the off-by-one.
- **Filing something twice.** The form is hidden once an item is filed, but a
  double-submit or a second tab went straight through, writing a second note —
  permanent, since notes are append-only — and orphaning the first. All three
  file routes now refuse. Found by the audit session.
- **The note and the mark are now one write.** Written separately, a failure
  between them left a note on the file with the item still in the queue, and
  refiling duplicated it. Row triggers cannot see across two tables, so the
  atomicity comes from `batch()`. Found by the audit session.
- **Unfiling now records which note it orphaned**, in the audit meta, before
  clearing the link. Found by the audit session.
- **Dates.** Last week's releases were written up as 1 September; they shipped
  on 31 August New Zealand time. Corrected across the changelog, the help
  notes, three migration comments and two code comments. Found by the audit
  session.

### Migration
- **`0048_one_letter_two_names.sql`** moves the one matter on the removed
  status to `ppi`. Nothing else changes: `cases.status` carries no database
  constraint, and the status history is left exactly as written — a row saying
  a matter moved to "inz_rfi" in August is true, and is not made false by the
  status being renamed afterwards. Rehearsed at production's spread (44
  matters): every reference unchanged, the one row moved, every other status
  untouched, history intact.

## 0.74.1 — 31 August 2026

### Fixed
- **Help said passport numbers are stored encrypted, in four places.** That
  stopped being true on 30 August with migration 0042, by the practice's own
  decision — so for two days the manual made the most sensitive claim in it,
  wrongly. Corrected: the number is stored as written, guarded by sign-in,
  roles, two-factor and an audited session, and still kept out of bulk exports.
  Release notes are left alone: they record what a past release did and remain
  true of it.

### Added
- **Help now covers what shipped last week**: the Files section on clients and
  matters (uploads, drive links, showing a client's document on a matter, and
  what happens with storage switched off), filing things out of Incoming, and
  the rows-per-page choice.

### Known and not fixed here
- `sealField` / `unsealField` in `src/core/crypto.ts` are now dead — nothing
  outside that file references them. Raised for the audit session rather than
  removed here, since deleting crypto is its call.

## 0.74.0 — 31 August 2026

### Added
- **Filing something that arrived onto the record it belongs to.** Incoming
  grew and never shrank, so the lists stopped being read. What was missing was
  not a delete button but the other half of triage: saying which matter this
  belongs to, and having it leave the queue once said. All three surfaces —
  the inbox, inquiries, conversations — now file onto a case or a client.
- **A "Filed" tab on each of the three.** A filed item leaves the working list
  and is not deleted: these rows are the register's record that a message
  arrived at all and on what date, which is evidence of the practice's own
  diligence. Unfiling is one press and puts it back.

### How it holds together
- **One fact, one owner.** The arriving message is the source and is never
  rewritten, edited or deleted. The file note on the case or client is the
  readable copy — the thing somebody finds months later. `filed_entry_id` ties
  the two together so neither has to be inferred from a timestamp. The note
  states its own provenance in its first line, because provenance kept only in
  a database column is provenance lost the first time the file is read as a
  PDF.
- **Unfiling does not remove the note.** File notes are append-only: a note
  that was written is a thing that happened. Unfiling says "this went to the
  wrong place", not "nobody ever put it there".

### Migration
- **`0047_filing_something_that_arrived.sql`** adds the filing columns and the
  triggers that make a filing whole-or-nothing. A half-filed row — gone from
  the working list, pointing at nothing — is the shape that loses things, so
  the database refuses it rather than the route that happens to be writing.
  Rehearsed at production's row counts (38 inbox messages, 15 inquiries, 18
  conversations): every row present and byte-for-byte unchanged afterwards,
  nothing arrives already filed, and the guards are live immediately.

## 0.73.1 — 31 August 2026

Three items, two of them from the audit session's review of 0.71.0–0.72.0.

### Added
- **Previous and Next above each list as well as below.** Paging from the top
  of a long page otherwise meant scrolling to the bottom to move and back to
  the top to read — the one thing a pager exists to save. The rows-per-page
  choice is deliberately *not* repeated: two sets of the same control invite
  the reader to wonder whether they do the same thing, and it is a decision
  made once rather than once per page turn.
- **Adding a user is behind a button**, on a bar above the list, like adding a
  task.

### Fixed
- **The task list ran one database query per row** to draw the "attached to"
  column. At 25 rows that was invisible; at the 500 this register now offers
  it is 500 subrequests against a platform ceiling of 1,000 — it would have
  worked until it very suddenly did not, which is the same "a page anybody
  with a link could hang" that the page-size allow-list exists to prevent,
  reintroduced at a size we ourselves offer. It is now a few queries whatever
  the page holds, guarded by a test that counts queries rather than looking at
  the output. Found by the audit session.
- **`AWAITING_DECISION_STATUSES` is derived rather than retyped.** It was a
  hand-maintained near-twin of `LODGED_CASE_STATUSES`, differing only by
  `appeal`; two copies of one list are two lists that eventually disagree with
  nobody able to say which is right. The `appeal` difference is real and is now
  written down where it lives. Found by the audit session.
- **The AI brief printed a decided matter's expected decision date as
  "Deadline".** A decided matter keeps that date for the expected-versus-actual
  comparison, so handing it to the model under that label invited it to reason
  about a deadline that passed with the decision. It now appears only while
  something is awaited, and the date the decision actually arrived is given
  alongside. Found by the audit session.

## 0.73.0 — 31 August 2026

### Changed
- **The New task button moved to the top of the list, beside the filter.** The
  form it opens now drops as a panel over the top of the list instead of
  pushing it down, so pressing the button does not move the rows somebody was
  reading. New `.list-bar` in the stylesheet for the filter-plus-action row.
- **Clients, Cases and Tasks open unfiltered.** Tasks opened filtered to your
  own; Cases opened on open matters only. A list that narrows itself before
  anybody has asked it to is how work goes unnoticed — the rows that are
  missing are exactly the ones nobody sees. The filter is one click away
  either way.

### Migration
- **`0046_a_list_opens_showing_everything.sql`** clears the three stored
  `pref.*` rows whose default moved. Changing the shipped default is not
  enough on its own: a preference already written wins over it, so the owner's
  stored values would have gone on filtering his lists while the code claimed
  otherwise — a setting that looks changed and is not. The rows are cleared
  rather than rewritten, so "where does a list start" has one answer instead
  of two that can disagree. Other preferences (landing page, rows per page,
  notifications) are untouched. Rehearsed on a scratch database seeded to
  production's shape, with the counts stated before the run and checked after
  (11 rows → 8, three targeted rows gone, the rest intact), and confirmed
  harmless to re-run.

### Fixed
- A specificity tie between two `margin-bottom` rules on an open `<summary>`
  shifted the whole task list 12px every time the New task form opened. Caught
  in Chromium by measuring the first row's position before and after, not by
  looking at it. Pinned by a stylesheet test.

## 0.72.1 — 31 August 2026

### Changed
- **The New task form on the task list is behind a button.** An always-open
  form put an empty box between the rows people came to read and the pager —
  the occasional errand competing with the constant one. It is now a "New
  task" button that opens the form when pressed. Built on `<details>`, so it
  needs no script: the content policy forbids an inline one, and a disclosure
  that stops working when script is blocked is a form nobody can reach. New
  `revealForm` in `ui/components.ts` for the next list that wants the same.

## 0.72.0 — 31 August 2026

Three faults on one card, all found by the practice approving a real matter
(CASE-26-051) and finding the screen confusing afterwards.

### Added
- **The decision date shows beside the status.** For an approved or declined
  matter, the date the decision arrived now sits next to the badge. It was
  always recorded — `decided_at`, written by the register the moment the status
  changes, never typed — but only shown in Key details further down, so the
  page read as though nothing had been kept.

### Fixed
- **"Response / decision due" is no longer offered on a decided matter.** It
  was rendered on every status move, pre-filled, with a hint that mentioned
  RFI, PPI and appeal but did not say what the field is *not* for. Approving a
  matter and typing the approval date into the box that is sitting there is
  the obvious reading, and it is the wrong field. It now appears only while
  something is genuinely awaited, and a submitted value is ignored when the
  matter is being decided. A date already recorded is left alone — an expected
  date beside the date a decision actually arrived is how the practice sees
  what INZ took.
- **"Approved / Granted." said the same thing twice.** Every status carries a
  line explaining what the badge cannot — "Lodged / Filed with Immigration New
  Zealand", "Declined / Refused — consider appeal, reconsideration or a fresh
  application". Approved's line was the bare synonym "Granted." It now says
  what to do next. A test refuses any status whose explanation is its own
  label, or is under three words.

## 0.71.0 — 31 August 2026

### Added
- **How many rows to show, chosen from under the list.** Clients, Cases and
  Tasks now offer 25, 50, 100, 250 or 500 in the pager, and say which rows are
  on screen ("Showing 26–50"). The choice already existed as a preference but
  only in Settings, three clicks from the list where the question is actually
  asked; the preference still sets where every list starts, and the control
  under a list overrides it for that list. Changing the size returns to page
  one, for the same reason sorting already does — page 3 of 25 and page 3 of
  100 hold different rows.

### Fixed
- **The task list was hiding work.** It ran one query with a fixed ceiling of
  200 rows and no pager at all, so past 200 tasks the rest simply were not
  shown and nothing on the page said so — in a list whose whole purpose is
  knowing what is outstanding. It now pages like the others. Pinned by a test
  that walks the pages and asserts every task appears exactly once, which
  fails if the offset, the limit or the slice disagree.

### Security
- The page size arrives in the address, so it is checked against the sizes on
  offer rather than parsed as a number: `?size=1000000` falls back instead of
  asking the database for a million rows and the browser to lay them out. The
  page number is bounded for the same reason. Both proven by reintroducing the
  bug each guards.

## 0.70.2 — 31 August 2026

### Added
- **A fourth answer to "where did this issue date come from": read off the
  scan by OCR.** The practice decided machine-reading may be run over scanned
  certificates for the next intake batch. A machine's reading is better
  evidence than a filename but is still not a person's, so it arrives flagged
  like the others and clears the same way — one press after checking the
  paper. The database refuses any value outside the four (rehearsed on a copy
  with real-shaped rows before deploy).

### Changed
- One matter's type corrected on the live register (VV. General → VV. Partner)
  under the practice's standing decision that a visitor visa for the partner
  of a named New Zealand person is recorded as VV. Partner. A note on the
  matter records the change.

## 0.70.1 — 31 August 2026

### Fixed
- **0.70.0 never reached the live register: its migration was refused, and
  rightly.** It rebuilt the documents table, which on the live database would
  have made a note lose its attachment — the append-only rule stopped the
  whole deploy, exactly as designed, and nothing was half-applied. The
  migration is rewritten without the rebuild: plain column additions, the
  stored-or-linked rule carried by triggers, and a linked file marked by a
  named `link:` storage key the file store never sees. Rehearsed against a
  copy shaped like the live register — including the document and note
  reference the practice had created that morning — before shipping again.

## 0.70.0 — 31 August 2026

### Added
- **A Files section on every client and matter page.** The document store has
  existed since the beginning; what was missing was the window onto it. Files
  now show on the record they belong to, grouped under the practice's own
  headings — Identity, Health, Character, English, Relationship and the rest —
  and the heading list is editable in Settings like every other dropdown.
- **A file can be a link to an external drive** (Google Drive and the like)
  instead of an upload. Only https addresses are accepted, opening one is
  recorded in the audit log, and the panel says plainly: the register controls
  who sees the link; the drive controls who can open the file.
- **A client's document can be shown on their matter** without copying it —
  one file, one owner; the link is a reference and unlinking removes only the
  reference. Only the matter's own client's documents can be linked, enforced
  in the route's SQL, so a matter can never become a window into someone
  else's file.
- Standing decision recorded in the intake prompt: the intake never copies the
  practice's actual files into the register. A file arrives only when a person
  uploads or links it.

## 0.69.2 — 30 August 2026

### Fixed
- **Removing the demonstration data now removes everything about it.** The
  clear recognised demo rows by their own identifier, so work done through the
  app *against* a demo record — a task completed on a demo matter, the note
  written when one was renumbered, an AI run over a demo file — survived it:
  33 notes, 18 tasks and 7 AI runs were still on the live register. Migration
  0043 sweeps that residue once (rehearsed on a scratch copy first), widens
  the append-only rule's one exception to match — a note about a fabricated
  record is as fabricated as the record — and the clear itself now deletes by
  reference as well as by identifier, so it cannot happen again. The audit
  log is untouched: it keeps the record that the demo data existed.

### Changed
- CLAUDE.md records three things that until now lived only in git history:
  the register is live (and what that means for how changes are made), what a
  release consists of, and who the register is built for.

## 0.69.1 — 30 August 2026

### Fixed
- **The header now keeps to the same width as the page.** On a wide monitor
  the menu, the search box and the account controls used to pin themselves to
  the far corners of the window while the content sat centred beneath them.
  They now stop at the page's own 1400px measure; the bar's background still
  runs the full window. Nothing changes on a laptop or a phone.

## 0.69.0 — 30 August 2026

### Changed
- **Passport numbers are stored as written and shown on the client's page**
  (the practice's decision). The encryption, the FIELD_KEY secret and the
  separate "reveal" step are gone: the number sits beside the passport's dates,
  visible to anyone signed in. Changing or removing a number is still recorded
  in the audit log — the record says it changed, never what to.
- One protection was kept on purpose: passport numbers still never appear in
  the bulk CSV exports. A spreadsheet in a downloads folder is the copy that
  actually escapes.
- The "Adviser" party role label shortened from "Licensed immigration adviser".

## 0.68.0 — 30 August 2026

### Added
- **Two new party roles on a matter: Lawyer and Licensed immigration
  adviser.** For counsel on a file who is not the matter's own assigned
  owner — prior counsel, opposing counsel, or an external specialist brought
  in on the case.

### Security
- The open question from 0.67.0 is settled by the practice: every signed-in
  role may use the audited passport reveal. Recorded as decided in
  `docs/security-findings.md`, together with verification that GitHub's
  branch protection, secret scanning and push protection are all enabled.

## 0.67.0 — 30 August 2026

### Fixed
- **A passport number that cannot be sealed is refused, not silently lost.**
  If the encryption key was ever missing from the deployment, recording a
  passport number would quietly store nothing while saying "saved" — and the
  file would afterwards read "no passport number on file". The register now
  refuses in plain words and saves nothing at all, which is the honest half
  of the bargain.

### Security
- **The doors in front of the practice's most sensitive data are now attacked
  by tests before any real data goes behind them**: sealed passport numbers
  reach a page only through the one audited reveal; the CSV export never
  carries a number, sealed or plain, and only an administrator can reach it;
  expired, idle, and revoked sessions all deny; a sign-in that has not passed
  its two-factor check cannot reach any page but the challenge. Sixteen new
  tests, each proven by putting the bug back and watching it fail.
- One open question is recorded in `docs/security-findings.md` for the
  practice to decide: today any signed-in role, including read-only, may use
  the audited passport reveal. It may be right; it is now written down
  rather than implicit.

## 0.66.0 — 30 August 2026

### Added
- **An issue date now says where it came from.** The expiry of a police
  certificate or a medical is a legal deadline the register works out from the
  issue date — so a date read off the certificate and a date inferred from a
  document's filename must never look the same. Every issue date carries its
  source, the database refuses one that stays silent about it, and a deadline
  computed from an unverified date says so on the client's page and in the
  alert itself. One press — "I have checked it against the certificate" —
  upgrades it once somebody holds the paper.
- **A visa expiry that waits on an event is no longer a blank.** Some grants
  have no date until something happens — "24 months after first arrival in New
  Zealand". The rule can now be recorded beside the (empty) expiry: the client's
  page shows the expiry as *not yet fixed* with the rule in words, and a
  standing alert asks for the date once the event has happened. The expiry
  field itself keeps its one meaning: a real date, or nothing.

### Security
- Both changes close the same hole from different sides: the register giving a
  confident answer about a legal deadline where it does not actually have one.
  Confidence it has not earned is now visible as exactly that.

## 0.65.0 — 30 August 2026

### Fixed
- **A message forwarded from a group or channel is captured again.** Whether a
  message was a forward was decided two different ways that could disagree, and
  for a group forward they did: the database refused the conversation the
  capture tried to attach, the whole capture aborted, and the message was never
  recorded at all. One rule now owns the fact, and a forward from anywhere is an
  inbox message and an inquiry, never a conversation.
- **The audit log records only what happened.** Deleting an inquiry wrote
  "deleted" to the audit log before asking the database, so a delete the
  database refused still went down in the record as done. The delete now
  happens first and the record is written only when it did.
- **The size cap on a displayed email can no longer cut a tag in half.** When a
  very long message ran out of room exactly inside a piece of formatting, a
  fragment of that formatting could reach the page. Formatting now goes out
  whole or not at all; the cap itself is unchanged.

### Security
- **A security test suite now attacks the register from four sides** — the
  database's own rules, the transport and cross-site defences, the email
  sanitiser (a corpus of hostile payloads), and route-level access control — 89
  tests that run with every deploy. The first pass surfaced the two fixes above.
- Findings are recorded permanently in `docs/security-findings.md`: what was
  found, what was fixed, where the guarding test lives, and anything accepted
  as a known gap with the reason written down.

## 0.64.0 — 30 August 2026

### Added
- **An email is shown the way it was written.** Until now the formatted part was
  read, stripped and thrown away the moment a message arrived. That is cheap and
  safe, and for triage — is this work, who is it from — it was enough. It is not
  enough for reading: an INZ letter or a schedule of dates is half structure,
  and stripping it leaves a wall of lines.
- The plain text is **always one click away**, and stays the version that search,
  triage and the AI read — smaller, and with no shape for anything to be
  confused by. One fact, two forms, and the form that is displayed is never the
  form anything else reads.

### Security
- The formatted body is **rebuilt, not cleaned**. `src/core/sanitise.ts` reads
  the markup token by token and emits only what is on an allow-list: a tag if
  its name is listed, an attribute if it is listed for that tag and its value
  passes the check for it. Anything unrecognised — a tag, a comment, a stray
  `<` — becomes escaped text. There is no path by which a construct nobody
  thought of is emitted verbatim, which is how every regex-based sanitiser
  eventually fails.
- `style`, `class` and `id` never survive, so a sender cannot restyle the page
  or borrow the register's own classes. Layout and type stay the application's.
- A link is kept only if it is plainly http, https, mailto or tel, checked after
  entities and control characters are removed — `java&#115;cript:` and
  `java<tab>script:` are both read as `javascript:` by a browser. One that fails
  loses its anchor entirely rather than becoming blue text that does nothing.
  What survives opens away from the register and tells the far end nothing about
  where it was clicked from.
- **Images are dropped and the reader is told.** A remote image in a client's
  email is a tracking pixel as often as it is a logo. The content security
  policy already blocked it loading; this means the page does not show a row of
  broken frames either, and nothing reports that a letter was read.
- The policy is the second layer and not the first: `default-src 'none'` with
  `script-src 'self'` and `style-src 'self'` means an inline script never runs,
  an inline style never applies and a frame never loads, even if something got
  past the rebuild.

## 0.63.0 — 30 August 2026

### Added
- **Forwarding**, per message, from any conversation. Forwarding is quoting: the
  recipient gets what was actually said, by whom and when, under the header
  block every mail reader writes — not a summary typed out again.
- The message being sent on may come from **any channel** — a client sends a
  payslip over Telegram and it has to reach INZ — but a forward always *leaves*
  by email, because that is the only channel where you choose who receives it.
- **A forward never joins the conversation it came from.** A message to a third
  party filed in the client's thread is the same mistake 0.61.0 undid at the
  other end, and a reply to it would come back to the wrong place. It starts, or
  joins, the conversation with whoever it was sent to — carrying the client and
  matter across so it still lands on the right file, but never moving a file the
  recipient already has.
- The quote sits **in the message box**, so what is about to be sent is what is
  on the screen, including anything you take out of it. Write your covering line
  above it. Too long to fit inside the 4,000 characters a message takes, and it
  says where it stopped rather than trailing off.
- To, Cc and Bcc offer the same address list as a reply; attachments come from
  the client's or matter's own documents, as references rather than copies.
- Only one "Fwd:" on the subject, however many hands it has been through. A
  forwarded reply takes its subject from whatever it was answering.

## 0.62.0 — 30 August 2026

### Added
- **A note carries the day it was written**, and who wrote it. "Called to find
  out, no update, will need to follow up in a week" is close to worthless
  undated: six months on nobody can tell whether the call was yesterday or in
  March. `completed_at` never answered it either — a note can be written before
  the task is finished, changed afterwards, or left on a task still open.
- **Finishing a task is one button.** "Done" sat inside a dropdown next to
  "Cancelled", which is one slip away from the opposite of what was meant. The
  dropdown stays for everything else.

### Changed
- The stamp moves only when the note itself moves. Re-saving the edit form
  without touching the box no longer redates a call made in March to today,
  which would be worse than no date at all.
- Existing notes take their date and author **from the audit log**, which
  already recorded each one as it was written. Where the log has nothing, the
  task's own timestamps stand in and no author is invented.
- The database refuses a note with no time on it, so a route that forgets fails
  loudly rather than quietly producing another undated note.

## 0.61.0 — 29 August 2026

### Fixed
- **A forwarded message is no longer treated as a conversation.** A conversation
  is keyed on the counterpart, because that is both who it is with and where a
  reply goes. A forwarded Telegram message has no counterpart: it arrives in the
  practice's own chat with the bot and is *about* somebody who is not in that
  chat. Keyed on the chat id, every forward joined one thread named after
  whoever forwarded it — three unrelated people showing as a single conversation
  — and a reply typed there would have gone back to the forwarder rather than to
  the person it concerned.
- A forward is now an inbox message and, when it is work, an inquiry. It is not
  a conversation, and the database refuses to give it one — on insert and on a
  later attach, because the capture writes the row and the thread in two
  statements.
- Migration 0037 unpicks what was already built on the old rule: forwards come
  back out of their threads, and a thread left holding nothing goes with them. A
  thread is kept if somebody really did write in that chat, or if the practice
  replied through it — something was said to somebody, and that stands.

## 0.60.0 — 29 August 2026

### Added
- **An inquiry can be deleted**, from the inquiries list or from its own page.
  Not everything that arrives is work — a chat forwarded twice, a wrong number,
  somebody's test message — and until now those could only be marked and left
  there. A list that fills with things nobody will ever act on stops being read,
  which costs more than the noise did.
- **Only while it is still only an inquiry.** The database refuses to delete one
  that has become a matter, been quoted, carries a task, a document, or a file
  note somebody typed. The rule is a guarantee about the data, so it is a trigger
  rather than a check in whichever route runs the DELETE — and the refusal is a
  sentence the screen can show as it stands.
- Being linked to a client is not one of those lines: a message from somebody
  already on the register arrives matched, and is still just a message.
- **Notes stay written.** `entries_cannot_be_deleted` is not relaxed. The system
  breadcrumb an inquiry is born with stays in `entries` after the inquiry goes —
  the honest cost of a record that cannot be rewritten — and the audit log keeps
  the inquiry's reference, source, subject and contact, written before the row
  is removed.
- The **message it was made from** is marked ignored rather than left looking
  unhandled, so the same rubbish is not dismissed twice. Done on the way out
  rather than after: `ingest_messages.inquiry_id` is `ON DELETE SET NULL`, and
  SQLite applies that before an `AFTER DELETE` trigger runs, so an `AFTER`
  version silently did nothing. Found by rehearsing the migration on a scratch
  database.

## 0.59.0 — 29 August 2026

### Changed
- **Converting an inquiry asks what the client form asks.** It offered one box
  called "name" and assumed everybody was a person. So a name arriving from a
  chat message — "Nguyễn Văn An" — was stored whole and unlike every other
  client, and a company inquiry became an individual named after the company.
  Neither is cosmetic: the register sorts, searches and exports on those
  columns, and a client list that sorts one row under N and its neighbour under
  the family name is a list nobody trusts.
- The conversion now offers **record type, given names, family name, nationality**
  and, for a company, its **registered name** — the client form's fields, by the
  client form's names, derived through the same helpers. A person created by
  converting an inquiry is now stored exactly as one created on the client form:
  family name in capitals, in plain English letters, `full_name` composed rather
  than typed.
- A guess at where the family name ends is **pre-filled and correctable**, taken
  from whatever the inquiry recorded as the contact's name.
- The wrong half of that block is hidden by the server as well as by the script,
  so it is never on the page whether or not scripting runs.
- **"Unassigned" is gone from the conversion.** The database has refused a matter
  with no owner since 0.54.0, so the form was offering a choice that failed on
  submit; it now defaults to whoever holds the inquiry, or to you.

## 0.58.0 — 29 August 2026

### Added
- **A reply can carry attachments** — chosen from the documents already on the
  client or the matter the conversation is linked to.
- **An attachment is a reference, never a copy.** The practice sends drafts back
  and forth: a submission at version three, then version four with the client's
  corrections. Six months later the question is not "was something attached" but
  *which one did we send them on the twelfth*, and a filename cannot answer that
  — four near-identical files sit in the folder and nothing ranks them.
- So `reply_attachments` joins a reply to a document, and the document answers
  the question from its own end: the documents list shows how many times each has
  been sent and when it last went. The conversation shows what each reply
  carried.
- A document that has been sent to somebody **cannot be deleted** — `ON DELETE
  RESTRICT`. Deleting it would leave the record that it was sent pointing at
  nothing.
- Attachments go out through both transports: `multipart/mixed` for Gmail,
  wrapping the plain-and-formatted body so a reader that will not show
  formatting still gets both the letter and the files; base64 for Resend.
- A **20 MB ceiling** on one message, below the ~35 MB Gmail refuses, because
  base64 inflates by a third. Anything over is skipped with a note rather than
  failing the send: a reply that reaches the client without an attachment is
  recoverable, one that never leaves is not.
- The queue carries **document ids, not bytes**, and resolves them at the moment
  of sending. A copy in a queue row would be a second answer to what was sent.

### Documentation
- `docs/operations.md` gains **What storage actually costs**. The short version:
  10 GB free, ~US$0.015 per GB-month beyond, and nothing at all for egress — so
  the thing to watch is not size but how many copies of the same bytes exist.
  Inbound attachments are recorded and not kept; outbound attachments are
  references. Both decisions are written down as decisions, so a future
  suggestion to "just store everything" meets an argument rather than a shrug.

## 0.57.0 — 29 August 2026

### Added
- **A matter has one principal applicant.** Everything about an application is
  measured from that person — whose visa it is, whose character and health is
  assessed, who the decision is about — and everyone else on the file is there
  in relation to them. Two principals is not an unusual matter; it is a data
  entry mistake that makes the file ambiguous about the one thing it has to be
  certain about.
- A **partial unique index** on `case_parties`, not a check in the route: three
  routes add a party — the party form, the create-and-add form, and the intake
  extraction — and a rule enforced in three places is a rule enforced in none.
  It also holds against an *edit*, so nobody can promote their way past it.
- The refusal **names who already holds the role** and suggests what to do,
  rather than reporting a failed constraint.

### Changed
- **The role defaults to Principal applicant on the first party**, and to
  Secondary applicant once the role is taken. It defaulted to Secondary always,
  which was wrong on the very first party added to every matter — a mistake
  somebody makes once and then has to undo.
- The migration demotes the later of any duplicate principals rather than
  deleting it, and writes why on the record. The first keeps the role: it is the
  one the file was built around.

## 0.56.1 — 29 August 2026

### Fixed
- The two ways of adding a party ran into one another: a rule and a heading now
  separate "somebody already on file" from "somebody not on file yet". Without
  them the second form read as more of the first, which is how somebody fills in
  half of each and presses the wrong button.
- The old route out of that dead end was a sentence of small grey text —
  *"Create a client first if they are not on file"* — which is exactly the kind
  of instruction a person does not see when they are looking for a control. It
  has been replaced by the control.

## 0.56.0 — 29 August 2026

### Added
- **A party can be created from the matter.** Adding somebody who is not yet a
  client meant leaving the matter, filling in the client form, and finding your
  way back — for a partner, a child or an employer, which is the *ordinary* case
  for a party rather than the exception.
- Four fields: given names, family name, role, email. Deliberately no more. The
  rest of what the register holds about a person belongs on that person's own
  page, and a longer form here would be a second client form to keep in step
  with the first.
- The name goes through the same helpers the client form uses, so somebody
  created here is written exactly as somebody created there — family name in
  capitals, in plain English letters, however it was typed. They get a reference
  of their own, because a party is a client in their own right.
- It lands you back on the matter you were working on. Anywhere else and it is
  the old journey with extra steps.

## 0.55.0 — 29 August 2026

### Added
- **Correspondence is searchable.** Global search now covers `ingest_messages`
  and `channel_replies` under a *Correspondence* heading. A file note records
  what somebody decided to write down; a message records what was actually said,
  in the words it was said in — and it was the one body of text in the register
  that could not be searched at all. "What did we tell them about the police
  certificate" was a question you answered by scrolling.
- A hit lands on the **conversation**, not the message in isolation: a message
  read without the exchange around it is half an answer.
- Ignored messages are left out, for the same reason they leave the
  conversation.
- **A client's page and a matter's page show their conversations** — who with,
  on what channel, the last thing said and which way round, and whether anything
  is waiting.
- Read from where it lives rather than copied onto the timeline. A message with
  two owners disagrees with itself the first time one of them is edited.

## 0.54.0 — 29 August 2026

### Changed
- **A matter is always assigned to somebody.** "Unassigned" is gone from the
  form. It is the rule tasks have had since they were built, for the same
  reason: a matter nobody owns is a matter nobody is doing, and "unassigned" is
  not a state a practice can be in — it is a gap that looks like one.
- Enforced by triggers on `cases`, not by the form. A guarantee in the route
  that happens to write the row lasts until somebody adds a second route, and
  this application already has three places that write a case. Triggers rather
  than `NOT NULL` because adding that to an existing column means rebuilding a
  table a dozen others hold foreign keys into — the same guarantee at a fraction
  of the risk, and it can say why.
- The field **defaults to whoever is opening the matter**, which is right far
  more often than not and is one fewer decision on a long form.
- **It cannot be given to a suspended account.** The database guarantees there
  *is* an owner; this guarantees the owner can sign in. `isAssignable` moved to
  `core/lookups.ts` and is now shared with tasks rather than duplicated.
- The migration gives any matter already adrift an owner — whoever created it,
  failing that the practice's first owner or administrator. Nothing is deleted
  and nothing is left unassigned. Production had none, but a migration that only
  works on tidy data is not a migration.

### Verifying
- `test/caseowner.test.ts` attacks the database directly: insert with no owner,
  clear it afterwards, hand it over. It also holds the form and the database in
  agreement, so a blank is a field marked red rather than a database message
  about matters.
- The new rule immediately broke `test/alertsql.test.ts`, whose fixture created
  matters with no owner. That is the guard working on its first day.

## 0.53.0 — 29 August 2026

### Added
- **A reply you have full control over.** A reply went to one address — whoever
  the conversation was with — as plain text, with nobody else on it.
  Correspondence does not work that way: a message arrives addressed to three
  people and the answer has to reach the same three.
- **To, Cc and Bcc**, each offering the register's own people as you type. Not a
  second address list to maintain — a list nobody maintains is worse than none,
  and these addresses are already kept current.
- **Cc is pre-filled with everyone else on their last message**, minus ourselves:
  the sending address, the polled mailbox and the trusted-sender list are all
  excluded, or every reply would copy itself back into the register. Reply-to-all
  without having to remember who "all" was.
- This needed the recipients to be captured in the first place. `to_addrs` and
  `cc_addrs` on `ingest_messages`, parsed from the message. Older rows keep NULL
  and the form offers nobody to add, which is honest.
- **Formatted replies.** The stored body stays the plain text somebody typed and
  the formatting is derived from it, so the record reads as what was written.
  `sent_html` records what was made of it.
- **Bcc through the whole mail layer** — both transports, and recorded on the
  message. A blind copy that leaves no trace is one nobody can answer a question
  about later. Blind is a property of the message, not of the file.
- **A conversation links to a matter as well as a client.** The column has been
  on `channel_threads` since it was created; nothing ever set it.
- **A message can be deleted.** Ignoring says "this was not correspondence";
  deleting says "this should not be here at all". The audit entry is written from
  the row before the row goes, and that log is append-only — so the fact that a
  message arrived survives its content being removed, which is what makes
  deletion safe to offer. One that became an inquiry cannot be deleted.

### Changed
- **Ignored messages no longer appear in the conversation.** Ignoring one is a
  decision that it was not correspondence, and a thread that keeps showing it
  disagrees with the decision. It stays in the inbox under *Ignored*.
- **The inbox leads with the subject**, then who it is from, then when. The date
  led before, which put the least useful column where the eye lands first.
- One `Re:`, however many times a conversation goes round.

### Fixed
- **`export const MAIL_POLL_CRON` from `src/index.ts` stopped the Worker
  starting.** The runtime rejects an export from the Worker's module that is not
  a handler. Production tolerated it; the local runtime refused outright, and a
  dry-run build never exercises either. Moved to `src/ingest/gmail.ts`, where it
  belongs anyway, with a test that fails on any non-handler export from
  `src/index.ts`.
- The delete confirmation uses `data-confirm` rather than an inline `onsubmit`,
  which the content security policy would have blocked — leaving a destructive
  button with no confirmation at all.

## 0.52.0 — 29 August 2026

### Added
- **A reply, where the message is read.** Capture has always set `thread_id`
  whenever the sender could be identified — that is what makes a reply possible —
  but the message page showed only the three decisions about what the message
  should *become*: create an inquiry, file it, ignore it. Answering the person
  who sent it meant leaving the page and finding the conversation by their name.
- It appears only when there is a conversation to reply in, and it sits below the
  three decisions rather than among them, because it answers a different
  question. A message's Details panel also links to the conversation now.

## 0.51.1 — 29 August 2026

### Fixed
- **Gmail credentials are trimmed before use.** They arrive by copy and paste,
  and a client ID with a trailing newline is a different string — to which Google
  answers *"The OAuth client was not found"*, which reads like the client was
  deleted rather than like a stray keystroke. Whitespace is never meaningful in
  any of these values.
- A whitespace-only value now counts as absent rather than present, so the
  integrations page says what is missing instead of the request failing later.
- **A credential of the wrong shape is named as such, before the request.** A
  client ID that does not end `.apps.googleusercontent.com` is not a Google
  client ID; a refresh token that does not start `1//` is probably an access
  token or an authorisation code saved in its place. Google's own answer to
  either names neither the field nor the problem. The message never repeats the
  value back — it goes into a flash message and the audit log.

## 0.51.0 — 29 August 2026

### Added
- **"Check for mail now"** under Settings → Maintenance. The same pass the
  schedule runs, on demand.
- It exists because of a gap that only shows once the feature is live: a poll
  that finds nothing writes nothing, so *connected and quiet* and *not working at
  all* look identical from outside. The button reports what it **looked at** as
  well as what it took — `Looked at 3 message(s): 1 taken, 2 already seen, 0
  failed` — which separates the two.
- When Google refuses the authorisation the message carries the provider's own
  words. `invalid_grant` means the refresh token does not match the client id and
  secret it is being used with, and saying so is more use than "failed".

### Fixed
- 0.50.1 shipped without its entry in **Help → Recent changes**. The in-app list
  and this file are written by hand and can drift; this one drifted because a
  scripted edit failed its guard silently and the commit went out anyway.

## 0.50.1 — 29 August 2026

### Changed
- **The secrets section of `docs/operations.md` is now the whole process**, not a
  table with a footnote. Every name the pipeline knows, what it unlocks, what
  breaks without it, how to set one, how to check it arrived, how to add a new
  name, and which two cannot be rotated casually.
- It leads with the two rules that actually caught people today, because neither
  is visible from anywhere: **a value set in GitHub does nothing until a deploy
  runs**, and **a name has to be in both `collect-secrets.mjs` and the workflow's
  `env:` block** or it is silently dropped.
- The one place the names are ever visible is the deploy's *Upload secrets to the
  Worker* step, which prints one line per name and a count. Documented, because
  it is the only way to confirm a change arrived.

### Verifying
- `test/secrets.test.ts` now holds three things together: every name the
  collector knows is passed by the workflow, described in `docs/operations.md`,
  and declared on `Env` in `src/types.ts`. A secret that arrives at the Worker
  and is unreachable from the code, or that nobody wrote down, now fails the
  build.

## 0.50.0 — 29 August 2026

### Added
- **The register can read a mailbox.** Every inbound channel so far worked by
  forwarding: you see something, you send it on, it lands here. Reliable, and
  also one more thing to remember on a day with forty of them. Now the practice's
  own address auto-forwards into a dedicated Gmail account and a five-minute cron
  polls it. `src/ingest/gmail.ts`.
- Everything found goes through the **same pipeline as routed mail** — same
  parser, same dedupe on the message's own `Message-ID`, same allow-list rule for
  whether it becomes an inquiry or waits in Incoming. A message that arrives this
  way is indistinguishable afterwards from one forwarded by hand.
- **Read-only, deliberately.** The scope is `gmail.readonly`; the register never
  labels, moves, marks or deletes anything in that mailbox. Whatever holds the
  token can read every message in it, and there is no reason for it to write as
  well. What has been taken is answered by the register's own Incoming list.
- **Its own refresh token, never the sending account's.** The client id and
  secret fall back, because both accounts commonly sit in one Google project. The
  refresh token does not: it is what names the mailbox, and reading the wrong one
  is the mistake worth making impossible.
- **It files; it does not decide.** Nothing in the poll changes a case, a date or
  a status.
- A second cron, `*/5 * * * *`, alongside the nightly housekeeping. The
  expression lives in `wrangler.jsonc` and in `MAIL_POLL_CRON`, and a test holds
  them together — if they drift, every firing runs the housekeeping and the
  mailbox is never read.
- The poll looks back two days each pass, so a missed run or an outage catches up
  by itself. A message that fails is not marked seen, so the next pass retries
  it.

### Fixed
- **The Gmail credentials were never passed through the deploy.** The collector
  knew the three names, the setup instructions asked for them, and
  `.github/workflows/deploy.yml` did not put them in the environment the
  collector reads — so an administrator could set them, watch the deploy succeed,
  and never have them take effect. `test/secrets.test.ts` now fails if any name
  the collector knows is missing from the workflow.
- Setting up Gmail on a **Google Workspace** address is materially simpler than
  on a personal one, and the instructions said only the hard version. Workspace
  gets an *Internal* consent screen: no verification, no test-user list, no
  "unverified app" warning, and none of the seven-day token expiry that catches
  personal accounts.

## 0.49.1 — 29 August 2026

### Fixed
- **Settings → Integrations said `MAIL_PROVIDER=resend — sending.` and stopped.**
  True, and no answer to the question a practice actually has: *where does the
  copy of what I sent end up, and can I have it in my own mailbox?* That depends
  entirely on which of the two transports is in use, so the answer now sits next
  to the switch — including, when Resend is configured, that no copy reaches any
  mailbox and what to set to change that.
- The wording lives in `mailTransportDetail` in `src/mail/provider.ts`, beside
  the transports it describes, rather than in the page that happens to print it.
- `docs/integrations.md` documented Resend only. Gmail has been in the codebase
  since it was written and was documented in the application's own help but not
  in the developer notes.
- Several help pages still said "Admin → …" after that section was renamed to
  Settings. The release notes still say Admin, because that is what it was called
  in those releases.
- `test/manual.test.ts` pinned the section name and failed the build on the
  rename — for the second time. It now checks that the manual documents both
  transports and where the test-message button is, without pinning where it
  lives.

## 0.49.0 — 29 August 2026

### Added
- **Nationality is a country, not a sentence.** It was a text box, so "Vietnam",
  "Viet Nam", "VN" and "Vietnamese" were four different nationalities and none
  of them could be counted, filtered or trusted. It is now an ISO 3166-1 alpha-2
  code chosen from the full list of 249, and two triggers on `clients` refuse
  anything else — a guarantee in the route that happens to write the row lasts
  until somebody adds a second route.
- Codes rather than names because countries rename themselves: Swaziland became
  Eswatini, Turkey became Turkiye, Macedonia became North Macedonia. A register
  holding codes changes one label. A register holding names needs a migration
  and an argument about what the old records meant.
- **Current visa is a choice**, from `vocab.visa_types` — modelled on the
  practice's own visa taxonomy, with the same VV/SV/WV/RV prefixes as the case
  types so the two lists read as one family. It is vocabulary, so an
  administrator edits it without a deployment; unlike nationality, the database
  does not police it.
- The list includes **"None — offshore"**, **"None — unlawful"** and **"None —
  visa expired, onshore"**. A client with no immigration status recorded raises
  an alert, and an alert that cannot be cleared honestly is one people learn to
  ignore.

### Changed
- **"Works for" and "Role there" are one group.** Left to flow with everything
  else they landed in different rows with an unrelated field between them, which
  is how a form turns into a dump of boxes. New `.field-group` — a fieldset that
  takes a row of its own and lays its own fields out inside it.
- The clients export now carries both `nationality` (the country's name, for a
  person) and `nationality_code` (for the next system).
- A nationality read out of a document or a model's answer goes through
  `countryCodeFor`, which takes codes, names, common variants ("UK", "USA",
  "Holland", "Burma") and the demonyms this caseload arrives under. Anything it
  cannot place resolves to nothing and the person picks from the list — a
  confident guess at somebody's nationality is worse than an empty box.

### Migrations
- `0030_countries.sql` creates the `countries` table, generated from
  `src/core/countries.ts`, and brings existing nationalities across. Names are
  the runtime's own CLDR names with a short list of corrections where CLDR
  writes something an adviser would not look under — "Hong Kong SAR China" is
  "Hong Kong" on a form, and the two Congos are named rather than distinguished
  by their capital cities.
- `0031_visa_types.sql` maps recorded visa text onto keys.
- **Neither discards anything.** What does not map is written into the client's
  file notes with a line asking somebody to set it, and the column is cleared.
  A record beats a tidy column.

### Verifying
- `test/countries.test.ts` builds the database from the migrations and checks
  the table matches the array exactly — two sources of truth for one list is how
  a dropdown ends up offering a country the database then refuses. It also
  attacks the column directly: `'Vietnam'`, `'vn'` and `'ZZ'` are all refused,
  on insert and on update.
- Both migrations were rehearsed on a scratch database against the values
  actually held, including the ones that do not map.

## 0.48.0 — 29 August 2026

### Added
- **Certificate expiry is a rule, not a typing exercise.** INZ does not read the
  expiry printed on a police certificate; it applies its own arithmetic, and the
  arithmetic branches: 6 months from issue, 24 once the certificate has gone in
  with an application. A medical is 3 and 36. So for those two kinds the expiry
  stops being something a person enters and becomes something the database works
  out from the issue date. One fact, one owner — and the fact is the issue date.
- **`submitted_on`** on each certificate: the day it went in with an
  application. Recording it moves the expiry by itself, and the file gets a line
  saying so. It is the only thing about a certificate that can be edited,
  because it is the only thing that is not a fact about the paper itself.
- A **certificate notice window**, `alerts.certificate_notice_days`, default 30.
  A certificate expiring inside it counts as pressing rather than upcoming —
  longer than the 14 days used for a deadline, because a replacement medical
  needs an appointment and an overseas police certificate can take longer than
  the notice period itself.

### Changed
- The "Expires" box on the certificate form is now for x-rays only, and the
  issue date is required for a police certificate or a medical. A form that no
  longer owns a column must not write it.
- The migration brings existing certificates under the rule where they have an
  issue date. Where a typed expiry disagreed, the rule wins: it is the one INZ
  applies, and a date that disagrees with INZ is not a record worth keeping.
  Rows with no issue date are untouched — there is nothing to compute from.
- A chest x-ray keeps its hand-entered expiry. No rule has been stated for one.

### Verifying
- `migrations/0029_certificate_validity.sql` puts the rule in a view,
  `certificate_validity`, and two triggers ask the view. One place to read the
  rule, one place to change it.
- The month-end correction is a `MIN()`: SQLite's `date(d, '+6 months')` turns
  31 March into 1 October, and rolling *forward* is the dangerous direction — it
  would have the register call a certificate live on a day it is not.
- `test/certvalidity.test.ts` runs the real triggers against a database built
  from the migrations: both kinds, both branches, month ends, recursive triggers
  on, and an expiry written straight into the column (the trigger overwrites
  it). Each was watched failing — the clamp removed, the months swapped, the
  update trigger narrowed — before it was kept.

## 0.47.0 — 29 August 2026

### Added
- **A task is a record you can open.** `/tasks/:id`, reached by clicking the
  title in the list. The details run in full, what it is attached to is a link,
  and who raised it and when are on the page. If it is finished, what was done
  is there too.
- The list still clamps details to two lines — twenty tasks each with a
  paragraph under it is not a list — but the clamp is no longer where the text
  ends. That was the bug: an answer could be written on a task and be
  unreadable from anywhere.
- Status, **Edit** and **Record what was done** all sit on the task page, and
  each returns to it rather than throwing you back to the list. The status
  control still works with scripting off.

### Changed
- A task alert now opens the task rather than the matter behind it. The row is
  about the task; the task page links on to whatever it is attached to.
- New `.inline-row` — a line of small things (badges, buttons, a status select)
  that sit side by side and wrap together. `.row-meta` did this only on a
  phone, so the same markup stacked on a desktop.

## 0.46.0 — 29 August 2026

### Changed
- **Admin is now Settings.** The menu entry, the page and the section title.
  Nothing moved: the same tabs at the same addresses. Most of the help text
  already said "Settings → …", so the menu was the odd one out — and "Admin"
  reads like user administration when the section is mostly configuration.
- **The navigation fits the width it is given.** Twelve sections need about
  970px at full spacing, which is more than the top bar can spare beside the
  wordmark and the search box on anything but a wide screen, so it wrapped into
  a ragged second row with a hole in the first. Now the links tighten with the
  viewport (`clamp()`, not a breakpoint — the width at which twelve labels stop
  fitting depends on the labels, and those are configuration), and below 1520px
  the navigation takes a full-width line of its own. One row from 1600px down to
  820px, two even rows below that, and the swipeable strip on a phone as before.

## 0.45.0 — 29 August 2026

### Added
Three more alerts that are not about a date. Same pattern as the first two: the
model noticed them reading a file, and what it noticed is now a query, so it
runs on every matter every time rather than on the one somebody thought to ask
about. AI as the scout, rules as the guard.

- **Not acknowledged** — a matter with a lodged status and no INZ application
  number on the file. INZ acknowledges a lodgement by issuing that number;
  after the grace period its absence means the acknowledgement never arrived,
  or it arrived and nobody wrote it down. You find out which by looking, and
  until then the matter cannot be quoted, chased or checked online. The grace
  period is a setting (**Settings → Alerts**), default 14 days.
- **No room to act** — a task due on the same day as the deadline it serves.
  That is not a plan, it is the deadline written twice: no room for the client
  to be unreachable, for a document to be missing, or for the day to go wrong.
  The register cannot know how long the work takes; it can see that nothing was
  allowed for it. It stops once the day has passed, where the deadline row says
  the same thing louder.
- **Status not recorded** — an open matter for someone with no current visa on
  their record. Every question a matter turns on starts from the visa they hold
  now. It clears by recording the answer, and "none, offshore" is an answer.
  Organisations are never asked: a row that can never be cleared teaches people
  to ignore the list.

### Changed
- The five checks that are not about a date now live in one exported place,
  `CHECKS_NOT_ABOUT_A_DATE`, rather than inline in `collectAlerts`.

### Verifying
- `test/alertsql.test.ts` runs all five against a database built from the
  migrations, with a row that should fire and a row that should not for each —
  a whitespace-only visa type, an organisation, a fresh lodgement inside the
  grace period, a task with a week in hand, a task already done. Each check was
  watched failing before it was kept.

## 0.44.0 — 29 August 2026

### Added
- **Sortable column headings in Cases and Clients.** Click a heading to sort by
  it, click it again to reverse. The heading is an ordinary link, not a script:
  sorting a list is navigation — a different view of the same thing — so it
  works with JavaScript off, and the sorted list has an address that can be
  bookmarked and shared.
- Sorting by name sorts by **family name**, matching the way the register writes
  them: *TRUONG, Thi Thu Thuy* sits under T for Truong, not under T for Thi. An
  organisation has no family name and sorts under its registered one.
- The name and title sorts use `COLLATE NOCASE`. SQLite compares text by byte
  otherwise, which puts `TRUONG` ahead of `Tagata` because capitals sort before
  lower case. Family names are stored in capitals, so this only matters for a
  row that arrived some other way — and that is exactly the row somebody would
  be scrolling to find.

### Security
- A sort key arrives in the address bar, so it is **looked up, never
  interpolated**: an unknown key finds nothing and the list falls back to its
  default order. The direction narrows to one of two literals at the point of
  use. `test/sorting.test.ts` holds both — it fails if the raw query value
  becomes reachable from the ORDER BY clause — and prepares every sort against a
  database built from the migrations, so a sort naming a column that does not
  exist fails in the suite rather than as a 500 on a page that worked yesterday.

## 0.43.0 — 29 August 2026

### Added
- **Two alerts that are not about a date.** Everything else on the page answers
  *what is due*; these answer *what is wrong*, which is how matters are
  actually lost — rarely to a missed deadline, usually to nobody looking.
- **Gone quiet** — an open matter with no note, no status change and no task
  activity for ten days. Any of the three counts as somebody working on it.
  The threshold is a setting, read where the alerts are built rather than
  passed in, because three pages call that function and a threshold meaning one
  thing on the dashboard and another on the alerts page would be a bug nobody
  could see.
- **Does not add up** — a matter whose own record contradicts itself: a
  decision dated before lodgement, a matter marked approved or declined with no
  decision date, a lodged date in the future. The row says *which* facts
  disagree, because a row somebody has to investigate before acting is a row
  they learn to skip — and that costs the reliable rows their credibility too.
- Both are ordinary queries. No model is consulted, and a test holds that true:
  the argument for putting them beside the dates is that they are as checkable
  as a date is.

## 0.42.0 — 29 August 2026

### Added
- **A brief can be edited before it is saved.** The box holds the note exactly
  as it will be written, so what you read before pressing save is what the file
  gets.
- **The opening line tells the truth about who wrote it.** A note kept as
  drafted says the model wrote it; one you changed says *edited before keeping
  by you*. A note that claimed to be the model's words after somebody rewrote
  them would break the one distinction this file rests on. The comparison uses
  the same function that fills the box, so the two cannot drift and decide
  authorship wrongly.
- **A brief can be discarded.** Nothing is written to the file. The run is
  marked discarded rather than deleted: that somebody read a reading and
  rejected it is the clearest signal there is about whether the model is
  earning its place, and throwing it away would throw that away too.

### Fixed
- The new field was called `body`, which the File notes form on the same page
  already uses — so both rendered with the same `id`. Invalid, and it broke the
  label association, meaning one label focused the other box. Found by driving
  the page rather than reading it.

## 0.41.0 — 29 August 2026

### Fixed
- **Saving a brief clears it from the panel.** It wrote the brief to the file
  and then left it sitting there, still offering to save the same words again,
  with nothing on screen to say it had already been kept. A brief with a
  `kept_at` is finished; the panel goes back to offering a fresh reading.
- `ai_runs` itself is untouched by keeping a brief — it records what the model
  was asked and what it answered, and that does not change because somebody
  kept the answer.

### Changed
- The assistant settings group is **AI Assistant**, and sorts first. It is the
  setting most likely to be changed and the one whose effect is least obvious
  from the page it acts on, so it is worth finding without reading along a row
  of twelve.

## 0.40.0 — 29 August 2026

### Fixed
- **A brief no longer reads its own earlier drafts as evidence.** Saving a
  brief writes it to the file, and the next brief reads the file — so a kept
  brief came back as ordinary file content. Left alone, each reading summarises
  the last, the file fills with the model's own output, and a later brief cites
  it as a record of what happened. Found by running the same case on two models
  and noticing the second one describing the first one's note.
- A kept brief is now marked in the text the model reads — *an earlier AI draft
  kept on the file, not a record of events* — and the prompt says not to repeat
  its conclusions or count it as correspondence.
- It is labelled rather than hidden: that somebody read a brief and kept it is
  a fact about the file. The writer and the reader share one exported constant,
  because a prefix known to only one of them would drift, and the drift would
  be invisible.

## 0.39.4 — 29 August 2026

### Fixed
- **The brief no longer expands abbreviations it was not given.** Asked about a
  case at PPI stage it wrote "PPI (Particulars of Inference)"; it is
  Potentially Prejudicial Information. The file never expanded it — the model
  guessed, and a plausible guess reads as fact to somebody skimming. PPI, RFI,
  AEWV, SMC and s.61 are terms of art with fixed meanings, and the adviser
  being briefed already knows them. It writes the abbreviation as it appears
  now, or asks under "questions".

## 0.39.3 — 29 August 2026

### Changed
- **A provider error now says what the request carried** — the model, and the
  workspace sent or that none was sent. An error naming a workspace is
  ambiguous on its own: it may be the one this register sent, or one the key
  itself is bound to, and telling those apart by comparing timestamps against a
  settings row is guesswork. The answer travels with the error instead. The key
  is never included; a workspace ID is an identifier, not a credential.

## 0.39.2 — 29 August 2026

### Added
- **A setting can declare the shape its value must have**, checked when it is
  saved. For settings holding somebody else's identifier, where a wrong one is
  accepted in silence and fails later in front of a client.
- The Anthropic workspace ID uses it. A workspace ID starts with `wrkspc_`;
  the identifier most easily confused with it — the organisation ID — is a
  plain UUID, and Anthropic answers that with a 404 that only arrives when
  somebody presses a button. It is refused on sight now, with the message
  saying where to find the right one rather than restating the rule.
- Clearing the setting is still allowed: empty means "ordinary key, send no
  header", and a shape check that rejected empty would make it impossible to
  undo.

## 0.39.1 — 29 August 2026

### Fixed
- **"Brief me on this matter" failed with a database error.** It asked
  `case_status_history` for a column named `changed_at`; the column is `at`,
  and always has been. Nothing caught it because nothing in the suite ran a
  query against a real schema — the tests read source as text, and the schema
  lived in migrations nobody loaded. It failed only when somebody pressed the
  button.
- **A new check prepares every fixed query in the codebase against the schema
  built from the migrations.** Preparing resolves table and column names
  without executing anything, so an unknown name fails in the suite. It found a
  second live bug immediately: the knowledge base CSV export asked for
  `published_on` and `source_url`, neither of which exists — that download
  would have failed for anyone who tried it.
- **The audit log printed IP addresses over the detail beside them.** The cell
  was `nowrap`, and an IPv6 address is one unbreakable token wider than its
  column; in a fixed table that does not widen the column, it paints over the
  next one.

### Added
- **An Anthropic workspace ID setting.** An identity-linked API key refuses any
  request that does not say which workspace it acts in. Left empty the header
  is not sent at all, which is what an ordinary key expects.

### Changed
- **Tags on a case are a single chip each**, tag and remove button together, so
  the × can no longer wrap onto the next line and appear to belong to the tag
  after it. Smaller type, and the add box is folded away until asked for — it
  was taking more room than the tags it adds to.
- **The status form's fields line up.** They were aligned to the bottom of the
  row, so a field carrying a hint under its input pushed its own label up and
  the row came out staggered. Fields start at the top now; a button sharing the
  row still sits level with the inputs rather than with the labels.

## 0.39.0 — 29 August 2026

### Changed
- **The model the assistant uses is chosen in the app**, under Admin →
  Settings → Assistant, and takes effect on the next request. It is a choice
  about cost and quality that the practice makes for itself — the same kind of
  choice as a case type or a fee rate — and waiting on a deploy to try a
  different one was the wrong shape for it. The key stays a secret; only the
  choice moved.
- Each option carries its price per million tokens, because the choice is
  mostly about cost and a choice about cost made without the figures is a
  guess.
- The list is fixed in code, and that boundary is deliberate: a model on it is
  a claim that the requests this register sends have been checked against that
  model — no `effort`, no `thinking`, the parameters that differ between tiers.
  A free-text box would let a typo switch the assistant off silently and a
  stale id look like a working one.

### Removed
- **`AI_MODEL` as a secret.** The setting owns the model now, and a secret
  saying one thing while a setting says another is the kind of disagreement
  nobody finds until it matters. Dropped from the collector, the workflow and
  the environment type.
- The Workers AI provider took its model from the same variable, but it names
  models in its own namespace where the Anthropic setting has nothing to say.
  It has its own default now and nothing overrides it.

## 0.38.0 — 29 August 2026

### Changed
- **The assistant runs on Claude Haiku 4.5** rather than Opus 5 — $1/$5 per
  million tokens against $5/$25, about a fifth of the price. Everything asked
  of it here is extraction and summarisation against a schema, from documents
  the practice already holds, and all of it is checked by a person before
  anything is written. Paying five times more would be paying for reasoning
  this workload does not use.
- Overridable with an `AI_MODEL` secret and no code change — `claude-sonnet-5`
  is the next step up, `claude-opus-5` above it. That works because no request
  here sends `effort` or `thinking`, which are the parameters that differ
  between the tiers; a test holds that true.
- Two consequences of the cheaper model, both fine for this workload: a 200K
  context rather than 1M (the longest thing sent is a case file, capped at
  60,000 characters) and a 100-page ceiling on a single PDF.
- **Admin → Integrations names the model in use**, and when the AI layer is off
  it now says what to set rather than only that it is off.
- The manual gained the two-secret setup: `AI_PROVIDER=anthropic` and
  `ANTHROPIC_API_KEY`.

## 0.37.0 — 29 August 2026

### Added
- **A search box at the top of every page, covering the whole register** —
  clients, matters, tasks, quotes, invoices, inquiries, file notes, uploaded
  documents and the knowledge base. A search that only knew about clients is
  the sort that gets abandoned in a fortnight: "Kiwi Orchards" might be the
  client, the matter, the invoice, or a note somebody left.
- A reference typed in full is marked as an exact match and put first. INZ
  application and client numbers find the matter. A phrase from a file note
  finds the note, which is often what you were actually after.
- Results appear as you type, through the same enhancement every other filter
  uses, and the page is a plain GET form so it works with scripting off.
- One letter is refused honestly — "one letter matches almost everything" —
  rather than answered with "no matches", which would be a lie about what the
  register holds.
- Not a search engine: no index, no ranking model, nine `LIKE` queries run
  together. At the size a practice like this reaches that answers in under a
  millisecond, and a fast plain thing beats a slow clever one. If that stops
  being true the answer is FTS5, and the comment in `core/search.ts` says so.

### Changed
- **Names are recorded in plain English letters**: RAWIRI, NGUYEN, DANG. Taken
  knowing what it costs — a macron in te reo Māori marks vowel length, and
  "Rāwiri" and "Rawiri" are not the same word — and applied consistently rather
  than left to whoever typed the record. An organisation's registered name is
  left as the Companies Office holds it; it is not the practice's to restyle.
- Most marks come off by decomposition, but a few letters do not decompose at
  all. The Vietnamese đ matters most here: without an explicit map "Đặng" would
  come out "Đang", half-converted, which is worse than either end of the
  choice.

### Fixed
- `test/css.test.ts` held **two copies** of five tests, and the second was the
  superseded version of the button-class guard — the one whose substring check
  passed while the bug was still in the tree. A bad splice of mine left it
  appended after its own replacement, so the weaker test kept running and
  kept passing.
- The clamp guard sliced the stylesheet at the first `@media (max-width: 720px)`
  and asserted against everything before it. Adding a narrow-screen rule earlier
  in the file broke it, for no fault of the thing it guards. It counts braces to
  the rule now: a guard that fails when unrelated CSS moves teaches people to
  edit the guard.

## 0.36.2 — 29 August 2026

### Changed
- **Five case types got the short forms the practice actually uses**, in the
  defaults rather than as a stored override, so the list still tracks future
  additions and an administrator can still edit it: `RQ. S.61`, `EMP. JC`,
  `RV. Partner RV`, `WV. Partner WV`, `RQ. Recon`.

### Fixed
- **A type label whose specific half is a filler now keeps its group.**
  "SV. General" stripped to "General", so matters came out named
  "General. NGUYEN, Thi Mai". Only "General" and "Other" count as fillers, named
  explicitly rather than guessed at, because "WV. Specific Purpose" and
  "RV. Permanent" are real types and must not be mistaken for one.
- The browser repeats this rule for the live suggestion, and a test now holds
  the two in step — a title proposed as you type differing from one the server
  would propose is the sort of difference nobody notices for months.

### Data
- Existing records were normalised in place rather than by shipped code:
  nineteen client family names capitalised (with `RĀWIRI` keeping its macron,
  which SQL's `UPPER` would have flattened to `RāWIRI`), and sixteen matters
  retitled to the convention with the two mis-typed as `OT. Other` corrected.
  Both computed with the application's own rules, so a retitled matter is named
  exactly as a new one would be.

## 0.36.1 — 29 August 2026

### Changed
- **A client's family name is stored in capitals**, whatever was typed. Not a
  display choice: the client record, the matter named from it, the CSV export
  and any search all agree without each of them having to remember. A passport
  prints the surname that way and INZ writes it that way, and many of this
  practice's clients have names whose order is not the English one — "Dac Dat
  BUI" says which part is the family name where "Dac Dat Bui" leaves it to be
  guessed.
- Deliberately lossy: a client who writes "de Vries" is stored "DE VRIES".
- The demo seed stores names the same way, so seeded data does not look
  different from data somebody typed.

### Notes
- This is done in the application, not in a migration, because **SQLite's
  `UPPER()` is ASCII-only**: it turns "Nguyễn" into "NGUYễN" and "müller" into
  "MüLLER", changing half the letters and leaving half. For this practice's
  caseload that is worse than doing nothing. JavaScript's `toUpperCase` is
  Unicode-aware and gets it right, so existing records are normalised by a
  one-off pass through the application rather than by shipped SQL.
- The rehearsal that found this nearly reported a false pass: the first harness
  split the migration file on `;` and skipped every statement, because each
  chunk began with its comment block. Running the file with `executescript`
  showed the real result.

## 0.36.0 — 29 August 2026

### Added
- **A matter has a name and a thing it is about, and they are now two fields.**
  One field was doing both jobs — "AEWV — Orchard worker, Kiwi Orchards" is
  both "which matter is this" and "what is it about" — and because it was one
  field the answer to the first drifted with the second: sixteen cases, sixteen
  different shapes.
- The name follows the practice's convention (`AEWV. TAGATA, Sione`), proposed
  from the type and the client and editable freely. **What it is about** is the
  small line under it in every list.
- The reference shares that line rather than taking one of its own. A third
  line would make every row in every list taller, and row height on these
  tables has already had to be fixed once.

### Changed
- **Surnames are capitalised in a matter name**, as a passport prints them and
  as INZ writes them. Many of this practice's clients have names whose order is
  not the English one: `TRUONG, Thi Thu Thuy` says which part is the family
  name where `Truong, Thi Thu Thuy` leaves it to be guessed, and guessing wrong
  on a form comes back as a request for evidence.
- The cases list showed the case type under the title. With the title naming
  the matter by its type, that said nothing; it shows what the matter is about
  instead, falling back to the type where there is no descriptor yet.
- An alert titled `${title} — ${client}` said the client twice once the title
  carried it. The client moved to the detail line, where it is still there for
  a title somebody wrote their own way.

### Fixed
- Two demo cases were typed `OT. Other` when `EMP. Job Check` and
  `EMP. Accreditation Renewal` existed — the type drifting because the title
  carried the meaning and nobody looked at the dropdown. Corrected in the seed.

### Notes on the migration
- Existing titles are split on the em dash they already used; a title without
  one keeps the whole title and gets no descriptor, which is right — there was
  no detail to move.
- Written first as `INSTR(title, ' — ') + 5`, on the assumption that the em
  dash's three bytes were three positions. SQLite's `SUBSTR` counts characters,
  so that ate the first two letters of every descriptor. Caught by rehearsing
  on a scratch copy, which is the entire reason for rehearsing.

## 0.35.1 — 29 August 2026

### Fixed
- **With scripting off, the client form showed five tab buttons that did
  nothing.** The bar was marked `js-hide`, which is the opposite arrangement:
  that marker is for a control which exists *for* the no-script case and is
  taken away once scripting turns up — a fallback submit button beside an
  auto-submitting select. A tab bar is useless without scripting, so it ships
  hidden and the script reveals it. The old marker was also cancelled by the
  tab code's own `bar.hidden = false`, so the bar showed either way.
- Found by actually running the app with JavaScript disabled rather than
  asserting that it worked. Everything else held: signing in, searching,
  filtering, opening and saving a client through the tabbed form, marking a
  task done through the fallback button, and recording the completion note.
  With the bar gone the form reads as one long page with its section headings,
  which is what it already did.

## 0.35.0 — 29 August 2026

### Added
- **Marking a task done asks what was done, and how.** A history of "done,
  done, done" answers nothing six months later, when the question is what was
  actually said to INZ or which of three options the client took.
- **It never holds anything up.** The task is written, and the audit entry
  made, before the box appears; somebody who closes the tab has still marked it
  done. *Nothing to add* closes it in one press.
- **It is a page, not a dialog.** A dialog needs scripting to exist at all, and
  this register works with scripting off — and a box that blocks you every time
  becomes a box you dismiss without reading, which produces notes that say
  "done".
- **Never required.** Some tasks genuinely need no note ("ring them back"), and
  forcing one produces exactly the notes this exists to stop. The column is
  nullable and the empty form is a valid answer.
- The note is saved on the task and added to the timeline of whatever the task
  was attached to, where somebody reading the case will find it. It is
  appended, never written over the completion entry: the file records what was
  said at the time, so a later change is another line rather than a rewrite of
  the first.
- A new preference, *Ask what was done when I complete a task*, turns the
  prompt off for anyone who finds it in the way. The note can still be added by
  editing the task.

### Changed
- `field()` accepts `autofocus`, used only where the whole point of the page is
  the one box.

## 0.34.0 — 29 August 2026

### Changed
- **Inquiries, the Inbox and Conversations share one menu entry, *Incoming*,
  as three tabs.** Nobody thinks "I will go to the Inbox" — they think "what
  came in", and three separate entries made you choose a screen before you knew
  what had arrived.
- **They stay separate records.** The inbox holds raw messages from a channel:
  untrusted outside text that nothing acts on by itself. An inquiry is a work
  item with a reference, a status and an owner. A thread of twenty messages is
  still one inquiry, and an inquiry taken over the phone has no message behind
  it at all. Merging the data would lose that; only the menu is shared.
- The number beside each tab is what is *waiting* on it — open inquiries,
  untriaged messages, open threads — not how many rows exist. A count is only
  useful if it means "this much is asking for you".
- The inbox's own status views (Waiting, Processed, Ignored, Failed, All) are a
  row of buttons now rather than a second bar of tabs, for the same reason the
  approvals queue's are: two tab bars on one page make the lower one look like
  navigation away rather than a filter of what is already there.
- The Inbox and Conversations tabs are absent for a role that cannot triage,
  not disabled — a tab that refuses to open is worse than one never offered.
  Checked by demoting an account to `readonly`: the bar shows Inquiries alone
  and `/inbox` answers 403.

## 0.33.0 — 29 August 2026

### Added
- **A client may hold more than one passport.** A dual national holds two at
  once and neither supersedes the other; someone who has just renewed holds the
  new one and the old one carrying a live visa, which is the whole reason
  *Transfer to New Passport* exists as a matter type. Three columns on the
  client row could not represent any of that.
- Each passport is now a record with its own country, number, issue and expiry
  dates, and a status. One is marked **primary** — the travel document the file
  works from — and a partial unique index makes the database, not the code,
  responsible for there being at most one. The columns on `clients` remain as a
  cache of the primary, refreshed on every change, so the alerts page, the
  client list, the CSV export and the intake extraction did not have to learn
  about the new table. That is the same arrangement as certificates,
  deliberately: one pattern to learn rather than two.
- The alerts and the automation triggers now watch **every passport still
  held**, not only the primary, and name the issuing country in each alert — so
  a dual national is chased about both. A passport marked *replaced* stays on
  the file as a record but stops being chased.
- A **Passports** dataset in the export. Numbers are excluded there as they are
  everywhere else; the column says only whether one is held.

### Changed
- **Every form sizes itself off the box it is in, not off the window.** The
  Immigration band on the client form was rendering as three 87px columns on a
  1440px screen. Two faults, neither visible to the checks that existed — those
  asked only whether anything ran off the edge of the screen, and nothing ever
  did. `grid-column: 1 / -1` does not work inside `repeat(auto-fit, ...)`, so
  the band marked "take the whole form" took one column; and the column counts
  came from viewport media queries, so a form in the 430px side column of a
  two-column page was told the window was 1400px wide. Container queries and
  explicit track counts fix both.
- **"For approval" keeps the Alerts tab bar** rather than replacing it with its
  own. A tab that leads to a page wearing a different bar reads as a trapdoor.
  The queue's three views are a row of buttons now: two tab bars on one page
  make the lower one look like navigation rather than a filter.

### Fixed
- `btn-sm` was written in eight places and defined in none, so those buttons
  rendered full size. An unknown class is not an error in CSS, it is simply
  nothing.

## 0.32.0 — 29 August 2026

### Changed
- **The test message can be sent to any address**, with your own filled in by
  default. The useful question is not "does my own mail arrive" but "what does a
  client see": providers judge a new sending domain differently, and a message
  Proton files in the inbox Gmail may put in spam. Most clients are on Gmail or
  Outlook rather than wherever the practice reads its own mail.
- Restricting it to the sender was a bad call on my part, and worth naming.
  It cost nothing in safety — anybody who can reach that page can already email
  any address from a quote, through the same queue and the same audit log — and
  it made the test answer a question nobody was asking. The recipient is
  recorded in the audit entry either way.

## 0.31.0 — 29 August 2026

### Added
- **Send a test message to myself**, on Admin → Integrations, once outbound mail
  is configured. It goes only to the address of the person pressing it: a test
  that could be aimed anywhere would be a way to send mail as the practice to
  anyone. The message names the provider, the sending address and the time, and
  says plainly that a first message landing in spam is normal for a domain that
  has just started sending.

### Fixed
- **Three features shipped without a manual section.** Expected decisions and
  chasing INZ, certificates, and export all had pages and no documentation.
  Written up now, including why a certificate is a record rather than a field
  and why passport numbers are in no export.
- **The rename from Today to Dashboard left the old name in three places** in
  the manual.
- **Setting up Resend was one sentence** in the middle of the Gmail section.
  It now has its own steps — verify the domain, create a sending-scoped key,
  three secrets, deploy, test — alongside when to use *Replies should go to*
  and why the sending address and the reply mailbox are two different questions.
- A test now checks that every registered feature with a page has a section in
  the manual, that section ids are unique, and that the first screen is called
  by its current name. The manual is part of the product; it should fail the
  build when it falls behind.

## 0.30.0 — 29 August 2026

### Added
- **Reply-To.** The address a message is sent *from* and the mailbox a reply
  lands in are two different questions, and treating them as one forces a
  practice to choose between a domain its provider will send for and an address
  somebody actually reads. Sending is authorised by DNS — a provider will only
  put a From address on a domain verified with it — while receiving is a
  mailbox that domain may not have. Set **Replies should go to** under
  Settings → Practice and every outbound message carries it; leave it empty and
  replies go to the sending address, as before.
- Resolved once, in `queueEmail`, rather than at each call site: passing an
  address overrides the setting, passing null suppresses it, and passing nothing
  uses the setting. Stored on the message rather than read again at send time,
  so what was queued is what goes out even if the setting changes in between.
- Carried by both transports — `reply_to` for Resend, a `Reply-To:` header for
  Gmail, through the same guard the other headers get, so an address containing
  a newline is folded into the value rather than beginning a line of its own.

## 0.29.0 — 29 August 2026

### Changed
- **"Today" is now "Dashboard."**
- **It leads with one list: "Needs you today."** Everything dated that has
  arrived or gone past — case deadlines, tasks, expiring documents, lapsing
  quotes, overdue invoices — merged from every source and sorted by date, with
  names and dates rather than counts. A morning is spent on that list, not on
  working out which of eight panels holds the thing that is late.
- **The figures carry their own urgency**: red once something is late, amber
  when it bites this week, quiet otherwise. A count alone says how many, which
  is the less useful half of the answer.

### Added
- **Waiting for you** — the automation approval queue, which until now was
  reachable only from Alerts. A queue nobody opens first is a queue nobody
  works.
- **Invoices overdue**, by name and by how late, rather than folded into one
  "invoiced unpaid" total.
- **Conversations waiting** — Telegram and WhatsApp threads with an unanswered
  message.
- **Matters lodged**, as a twelve-month sparkline. The one place on the page
  where a shape beats a figure, because it is a trend rather than a state.
  Drawn with SVG presentation attributes rather than inline styles, which the
  content policy forbids, and its y axis starts at zero — a chart that crops the
  bottom makes an ordinary month look like a collapse.

### Fixed
- **Three pixels of horizontal scroll on every phone.** The narrow-screen rule
  for the two-column layout used `1fr` where the desktop rule used
  `minmax(0, 1fr)`. A grid track's default `min-width` is `auto`, so a plain
  `1fr` cannot shrink below its content and one wide child pushes the column
  past the viewport. The desktop rule always had the guard; the mobile rule did
  not.

## 0.28.0 — 29 August 2026

### Changed
- **The user list reads as a list.** Every row carried live inputs — two text
  boxes, two dropdowns and a Save button apiece — which cost four lines of
  height each and turned six people into a page of boxes. Rows are now one line
  each, with an **Edit** button that opens the single row being changed.
  A list of people is read several times for every time it is edited, and it
  should be shaped for the reading.
- The open row is chosen by the address (`?edit=…`) rather than by a script, so
  it survives a reload, can be linked to, and works with scripting off — the
  same pattern the service catalogue and the automation rules already use.

### Added
- **Document storage is live.** R2 enabled, bucket bound, files attach to cases,
  clients and file notes. Served through the Worker, so every download passes
  the session check and is written to the audit log.
- The bucket is in **Oceania**, alongside the D1 database. Getting there took
  three attempts and the reason is now recorded in `wrangler.jsonc`: R2 honours
  a location hint only the first time a bucket of a given name is created, so a
  name whose first bucket landed in the wrong region can never be moved by
  deleting and recreating it. A different name, created from a browser in New
  Zealand, was the way out.

## 0.27.0 — 29 August 2026

### Added
- **A passport number can be removed, not only overwritten.** Leaving the box
  blank still keeps what is stored — otherwise every unrelated edit would wipe
  it — so there was no way to take out a number entered against the wrong
  person. There is now a "Remove the number on file" tick, shown only when one
  is held. Asking to replace and remove at once is refused rather than guessed
  at: those are different intentions and picking one would be picking wrong half
  the time.
- **Changing it is recorded as specifically as reading it.**
  `client.passport_set` (noting whether it replaced an existing number) and
  `client.passport_cleared` sit alongside the existing
  `client.passport_revealed`. Until now a change was only a generic
  `client.updated`, so you could tell who had looked at a passport number but
  not who had altered it — for the one field the register encrypts, that
  asymmetry was the wrong way round. A line is also written to the client's own
  timeline, where somebody looking at the file would see it.
- The number itself never reaches the audit log or the timeline. Verified
  against the database after a full set-correct-replace-clear cycle: zero rows
  in either table contain it.

## 0.26.0 — 29 August 2026

### Added
- **Export.** Admin → Export: sixteen datasets, each one link and one CSV —
  clients, matters, parties, certificates, fees, quotes and their lines,
  invoices and their lines, payments, tasks, notes, inquiries, the knowledge
  base and the audit log. UTF-8 with a byte-order mark so Excel reads macrons,
  RFC 4180 quoting, and a leading `=`, `+`, `-` or `@` defused so a cell cannot
  become a formula that runs when somebody opens the file. Every download is
  audited. Passport numbers are excluded — the export says only whether one is
  held. Reading data back in is a separate job and is not built.
- **Certificates are records, not fields.** A police certificate, medical or
  x-ray is now its own row with its own dates, and a new one does not overwrite
  the old: a matter lodged in March relied on what was held in March, and that
  has to stay answerable. A client may hold police certificates from several
  countries at once, which one set of boxes could never represent. Existing
  values were carried across, and the columns on the client row remain as a
  cache of the current one, so the alerts page needed no changes.
- **Medical certificate type** — General Medical (INZ 1007) or Limited Medical
  (INZ 1201).
- **English language** on a client: test or exemption from an editable list,
  score as the certificate states it, and the date, because most results are
  accepted for only two years.
- **A fee summary on the client page**, aggregated across their matters and
  linked back to each one. Fees are recorded per case, which is right, but
  "what does this person owe us" is a question about the person.
- **The fee section on a case starts folded.** Worth saying plainly: that is a
  screen to click past, not access control — the figures are still in the page
  for anyone who may open the record. Who may see money is a question of roles.
- **Matter titles follow a convention**: `AEWV. RUBEZHANSKII, Aleksei` —
  the type first, then the client formally, because every list showing a title
  also shows the client in its own column. Suggested as you choose, never
  overwriting a title somebody has typed.
- **Matter numbers carry their year**: `CASE-26-001`, from a counter per year,
  allocated in one atomic statement. Existing references are untouched.
- **ARCHITECTURE.md** — the four commitments (secure, modular, AI-assisted but
  never AI-dependent, mobile-first), a table of where each guarantee is actually
  enforced, and the shape of the codebase.

### Fixed
- **Saving a client wiped its certificate dates.** The form still wrote those
  columns after its inputs were removed, so a plain save cleared them. Those
  columns are a cache of the certificates table now and nothing else writes
  them — one fact, one owner.
- The Immigration tab is grouped under headings rather than one bucket of
  fields.

## 0.25.0 — 29 August 2026

### Added
- **An expected decision date, filled in on lodgement.** A month after
  lodgement by default, and only when nobody has supplied one. It stays
  editable: INZ publishes processing times per visa type, and the adviser
  handling the matter knows better than a default does.
- **Chasing INZ when that date passes.** A task on the day, another a month
  later, another the month after — three by default, assigned to whoever owns
  the matter. Every part of it is a setting: how long a decision is expected to
  take, whether to chase at all, the schedule, and the priority.
- **The schedule is counted from the expected decision date**, not from
  lodgement, so changing how long a decision takes moves the chases with it
  rather than chasing before the decision is even due.
- **One matter can opt out** without touching the practice default — a file
  under a formal complaint, or one where the client has asked for silence.
  Chases already raised are withdrawn.
- **It reconciles rather than fires.** Each chase is a row keyed to its case and
  its position in the sequence, rebuilt from the current dates every night. Move
  the expected decision and the chases move; change the schedule and every open
  matter is on the new timing by morning; a decision arriving withdraws what is
  left. A chase somebody has already done, or marked as not needed, is left
  alone.
- `FormReader.checkbox()`, because an unticked box is simply absent and every
  caller was inventing its own idea of what counted as ticked.

### Fixed
- **Automations jumped out of the Admin menu.** The tab led to a page wearing a
  different tab bar, so following it left no way back to where you were. The
  rules now live at `/admin/automations` under the Admin bar, where they belong
  — they are configuration. The approval queue keeps its own bar with Alerts,
  where it belongs — it is daily work. The old address redirects.
- **The audit log had four-line rows.** Six columns with no widths shared the
  page equally, so a date that reads on one line broke across four while the
  detail was squeezed into a strip. The date now sits above the time, the name
  above the address, the two least useful columns give way on a phone, and the
  detail gets the width. Rows went from around 120 pixels to 59.
- **`.clamp-1` and `.clamp-2` did nothing on a desktop**, because they were
  defined only inside the narrow-screen media query. That is why long values
  ran to full height on a wide screen — the class was there, the rule was not.

## 0.24.0 — 29 August 2026

### Added
- **Open a matter from a document.** Assistant → Open a matter, or the button on
  New case and New client. Drop in a forwarded email, an INZ letter, a
  photograph of one or a scrap of notes — or paste it — and what comes back is
  not a summary to read and retype but *the form*, with the boxes filled: the
  client, anybody else the document names and their role on the matter, the
  type, the numbers, the dates. Correct it, press the button, and one submit
  creates the client, links the parties, opens the case and records where it
  came from. Before that press the register is untouched.
- **It says what it could not find.** Rather than a confidence score, the empty
  boxes are named: no decision date stated, no application number in the
  material. A missing date stays missing — an invented deadline in a system that
  raises alerts is worse than no deadline.
- **It offers an existing client rather than a duplicate**, on a matching email,
  a matching phone, or both halves of a name. A shared family name is a
  coincidence, not a match. Choosing the existing record leaves it exactly as it
  is; the reading never overwrites what the practice already holds.
- **Passport numbers are deliberately not extracted**, even when the document
  shows one. The column is sealed, and pulling numbers out here would write them
  in the clear into the run log on the way past. It is one field, typed once.
- **The file is read and dropped.** It is not stored — there is nowhere to store
  it until R2 is switched on, and pretending otherwise would lose somebody's
  document. Uploads are sniffed by their first bytes rather than trusted from
  the browser, capped at five files and 8 MB each.
- **A drop target that lists what it is about to send**, as progressive
  enhancement over an ordinary file input. A file that silently failed to attach
  looks exactly like a model that read nothing.
- On Cloudflare's own models, which read text only, a PDF or a photograph is
  refused **by name** rather than quietly ignored.

### Fixed
- **Hiding something did not hide it.** `.js-tabbed [data-panel]` and
  `[data-kind]` set `display: grid`, and an author rule beats the browser's own
  `[hidden] { display: none }` — so every section the scripts hid stayed on the
  page with its `hidden` property correctly set to true. This is why the client
  form showed its company fields, NZBN and Companies Office number under an
  individual's name, and why all five tab panels appeared at once. `[hidden]`
  now carries `!important`, declared before the rules that were beating it.
- **A tab that opened the wrong fields.** Clicking Identity while the record
  type was Organisation un-hid a section of passport fields, because the tab
  handler knew about tabs and the kind handler knew about kinds and neither knew
  about the other. They are one piece of code now: a tab whose section belongs
  to the other kind is not offered at all, and switching type moves off a tab
  that has just become irrelevant.
- **The client form is right with scripting off**, not only with it on. The
  server marks the irrelevant half hidden in the HTML itself, so a person never
  sees a company's NZBN box and an organisation never sees a passport box,
  whether or not the script runs.
- **`.settings-form` had no `display: grid`** of its own — it worked only where
  the same element also carried `.form-grid`, and stacked into a single column
  the first time it was used alone.

## 0.23.0 — 28 August 2026

### Added
- **Invoices.** Raised from a quote in one press, or found under Quotes →
  Invoices. An invoice is a new record rather than a quote in another state: a
  quote is an offer that can be withdrawn or superseded, an invoice is a demand
  with a number in a sequence, and those are different lifetimes. The lines are
  copied, so editing the quote or the catalogue afterwards changes nothing, and
  the quote is not consumed — it can reasonably be invoiced more than once,
  which is what staged fees are.
- **An issued invoice cannot be altered.** Not the amounts, not the dates, not
  the lines, not the number. Triggers refuse every change but the ones that
  legitimately happen afterwards: payment, voiding, and the record of a push to
  Xero. Proved by attacking the database directly rather than through the
  application — every one of those updates is refused, and an issued invoice
  cannot gain or lose a line while a draft still can.
- **Nothing is deleted; a wrong invoice is voided** with its reason, and its
  number stays in the sequence. A gap in an invoice sequence is the first thing
  an auditor asks about.
- **Payments are added, never edited.** A mistake is corrected by a second
  entry marked as an adjustment, which is how a ledger stays a record rather
  than an opinion. Every payment carries the person who recorded it —
  `created_by` is NOT NULL and RESTRICT.
- **A printable tax invoice** on the practice's letterhead, with the GST
  number, bank account, payments already received and what is now due. Headed
  *Tax invoice* when GST applies and *Invoice* when it does not.
- **An invoice must be addressed to somebody.** A quote may sit against an
  inquiry that has not become a client yet; an invoice may not, and neither
  raising nor issuing one will proceed without a client on it.
- **Somewhere for Xero to land**, before it is connected: the invoice carries
  the Xero identifier, when it was pushed and any error, so the two systems can
  later agree about which invoice is which rather than being matched by amount.

### Fixed
- **A trigger that would never have fired.** The one meant to stop lines being
  deleted from an issued invoice was written `NOT IN ('draft', NULL)`, and
  `NULL NOT IN (…)` is NULL — which is not true, so it never fired at all. It
  uses IFNULL now, and a test names the mistake so it is not made twice.

## 0.22.0 — 28 August 2026

### Added
- **Channels are conversations, not just a direction.** Until now a channel was
  somewhere messages arrived from: a Telegram message became a row in the inbox
  and the practice answered it somewhere else, on a phone, with nothing on the
  file to say what was said. A thread is one counterpart on one channel and
  holds both halves — Inbox → Conversations. Telegram and WhatsApp can be
  replied to from inside the register; email replies go through the outbound
  queue the rest of the application uses.
- **A conversation can be linked to a client**, which puts it on their file.
  Linking changes nothing about trust: whether a sender may create records is
  still the channel's allow-list, which is a secret rather than a setting.
- **Every reply has a person behind it.** `channel_replies.created_by` is
  NOT NULL and `ON DELETE RESTRICT`, so a reply cannot exist without an author
  and a sent message keeps the person who sent it. Nothing in this application
  writes on a channel by itself.
- **A reply is recorded before it is attempted.** What the practice said is on
  the file whether or not the transport was working, and a failed send is a row
  saying so with the provider's own reason — including WhatsApp's refusal
  outside the 24-hour window, which is shown rather than guessed at.
- **WhatsApp sending**, behind two new secrets (`WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`). Receiving does not need them; without them a
  reply is saved and marked as waiting.
- **The inbox is tabbed and searchable**, like every other list: Waiting,
  Processed, Ignored, Failed, All, and Conversations, with counts, columns that
  give way on a phone, and search that answers as you type.

## 0.21.0 — 28 August 2026

### Added
- **Automations.** A rule is a trigger, a window and an action, and it reads
  back as one sentence: *when a case deadline is approaching within 7 days,
  create a task for Tai, for approval*. Anything harder to say than that is a
  program, and a program does not belong in a form. Five triggers, all of them
  questions the register can already answer from dates it already holds: a case
  deadline approaching, a task past its due date, a quote about to lapse, a
  client document expiring, a message sitting untriaged in the inbox. A rule
  written this afternoon matches everything that already qualifies, because
  nothing is stored to make the triggers work.
- **An approval queue**, at Alerts → For approval. Everything a rule would like
  to do, waiting for somebody to say yes, with what it would create or send
  shown before the decision rather than after it.
- **A task may be raised without asking; an email may not.** A task is internal
  and the worst case is one somebody closes, so a rule can be written to create
  one outright. Anything leaving the practice waits for a person and records
  which person — and that is not a setting: the schema carries
  `CHECK (action_kind != 'email' OR requires_approval = 1)`, so a rule that
  skips approval on an email cannot be stored by any route, including a direct
  write to the database.
- **It proposes once.** Every proposal is unique on rule + record + the date
  that caused it, enforced by the database. The nightly run cannot raise the
  same thing twice, and something dismissed stays dismissed. A date that moves
  is genuinely new, and is proposed again.
- **A digest**: one message gathering everything a rule matched, rather than one
  per record.
- **The AI layer writes one thing here: the covering paragraph on a digest.**
  The list under it is assembled by the register, the recipient comes from the
  rule, and the sending waits for a person. It is written when the digest is
  proposed rather than when it is approved, so what somebody reads is what goes
  out, and the interface says which paragraph the model wrote. Switch the AI
  off and every rule still fires, still proposes and still acts — the digest
  arrives as the list.
- **Skips are counted and explained.** A rule that matches and then cannot act —
  a task with nobody to assign it to, an email with no address — says so on the
  Automations page. A rule that quietly does nothing looks exactly like a rule
  that is working.

### Fixed
- **A `var(--line)` that was never defined**, which silently dropped a border.
  A test now checks every custom property used in the stylesheet against the
  ones defined, because a misspelled one fails invisibly.

## 0.20.0 — 28 August 2026

### Added
- **A banner when a message arrives.** The inbox is checked on a quiet poll and
  a small banner appears in the corner you chose — top or bottom, left or
  right — carrying the channel and the subject line and nothing else. Clicking
  it opens that message. It never carries the body of a message: the endpoint
  behind it returns a count, an id, a channel and a truncated subject, so a
  banner on a screen somebody else can see gives nothing away.
- **A choice of five sounds, or none.** They are synthesised by the browser
  with the Web Audio API rather than downloaded. Partly because it is lighter —
  no files, no requests — and partly because the content policy permits no
  media at all, so an audio file would be blocked outright. A browser will not
  make a sound before the page has been clicked, so the first alert in a fresh
  tab may be silent; that is the browser's rule, not a fault here.
- **You decide how often it looks**, from every thirty seconds to every three
  minutes, or never. "Never" means no request goes out at all. While the tab is
  in the background nothing is asked for either, because the answer would only
  be shown when you came back to it.

### Fixed
- **Each group of preferences is saved on its own.** Every group renders as its
  own form, but the handler read every preference on the account — so saving
  one group read the other group's unticked boxes as "off" and quietly turned
  them off. The form now names its group and the handler stays inside it.
- **The first message to arrive into an empty inbox was swallowed.** One
  variable was doing two jobs: "we have not asked yet" and "nothing is
  waiting" looked identical, so the first arrival set the mark instead of
  announcing itself. Those are two pieces of state now.
- **The in-app release notes had fallen seven versions behind** the changelog.
  Help → Recent changes lists them again.

## 0.19.0 — 28 August 2026

### Added
- **An Assistant page.** Paste text — a forwarded email, a scanned letter, notes
  from a call — and it extracts the name, contact details, dates and likely
  matter type, then offers to start an inquiry or a client record with those
  filled in. The create forms accept a proposed starting point through the
  address, so the suggestion arrives as a form somebody submits.
- **Brief me on this matter**, on every case. The register assembles the file —
  statuses, dates, parties, notes, tasks, fees — and hands that text to the
  model, which proposes where things stand, what to do next, what is worth
  watching, and what the file does not say. A brief can be saved to the file as
  an ordinary note.

### Security
- **Read access is granted by assembling what may be read, not by handing over
  the keys.** The model never queries the database, holds no credentials, and
  cannot reach anything the person asking could not already see. Passport
  numbers are never included in a brief: they are encrypted at rest precisely so
  they are not casually handled, and no brief needs one.
- **Nothing the AI layer produces is written without a person pressing the
  button.** Every suggestion is a form to submit or a note to save.
- A brief saved to the file says in the note that it was drafted by the AI layer
  and who kept it. A file that does not distinguish what a person wrote from what
  a model drafted is a file nobody can rely on. Being an ordinary note, it then
  cannot be edited.
- Every run is recorded with its input hash, output, latency and any error —
  failures included, so a provider that is quietly failing is visible rather
  than silent.

### Changed
- The provider interface gained briefing alongside triage, implemented for both
  Anthropic and Workers AI, and is still handed the practice's configured case
  types per request rather than importing a list.
- **The register works with the AI layer switched off**, as it always has. The
  Assistant page says so plainly and every other workflow is untouched.

## 0.18.0 — 28 August 2026

### Added
- **Three more themes**, each with day and night: **Blossom** (warm pinks, vivid
  magenta), **Lagoon** (mint and sea green, strong teal) and **Aurora**
  (electric violet on lilac). The quiet three are untouched.
  - Bold means the neutrals are tinted towards the accent rather than staying
    grey with a coloured button on top; the semantic colours stay constant, as
    they do everywhere.
  - Each was one CSS block and one line of TypeScript, which is what the theme
    layer was built for.
- **A contrast test across every theme.** Adding a theme is now easy, which
  makes adding an unreadable one just as easy. Five pairings — body text on the
  page and on a card, muted text, links, and a button label on its button — are
  checked against WCAG AA (4.5:1) in both modes of all six themes. All pass;
  the closest is 4.6:1.
- **Tabs with counts on Alerts, Tasks and Quotes**, matching Clients and Cases:
  Alerts by kind, Tasks by Open / Overdue / Completed / All, Quotes by
  Live / Accepted / Closed / All.
- **Search as you type** on those lists, and quotes gained a search box.

### Changed
- Those three lists now use declared column widths, drop their lesser columns on
  a phone and fold that content into the first cell, and keep their headings
  under the navigation while the list scrolls — the same treatment cases and
  clients already had.
- The task list opens filtered to you or to everyone according to your own
  preference, and an explicit choice in the address still wins.

## 0.17.0 — 28 August 2026

### Added
- **Per-user preferences**, under My account → Preferences: where you land after
  signing in, rows per page, which view Clients and Cases open on, whether the
  task list filters to you, and whether new tasks are assigned to you by
  default. They affect only that person.
  - The distinction from settings is deliberate. A *setting* says how the
    practice works and one answer serves everybody, so an administrator owns it.
    A *preference* is one person's, and needing an administrator to change where
    you land after signing in would be absurd.
  - Declared by the module that owns them, key and value in the database, so
    adding one is a line of code rather than a migration — and only a declared
    key can be written, with each value coerced to its declared type. Tested
    that a landing page outside the offered list is refused, since that value
    ends up in a redirect.
  - Theme and colour mode stay as columns on the user row: they are read on
    every request to render the page, and a second query for them on every page
    load would cost something for nothing.
- **My account is tabbed** — Security, Preferences, Appearance, Devices — having
  grown past a screen.

### Changed
- **The new client form is in tabs**: Who this is, Contact, Identity,
  Immigration, File. The whole form is always in the document and submits
  together, so nothing is lost switching between them, and with scripting off
  every section shows at once exactly as before. An invalid field on a hidden
  tab reveals its tab rather than blocking the submit with nothing to see —
  verified in a browser.
- **Settings fields lay out across the page** instead of stacking in a single
  narrow column with the rest of a desktop empty. Long text settings take the
  full width; the rest flow two or three across, never more.
- **Tab bars stay under the navigation while a page scrolls**, and a sticky
  table heading clears them. Desktop only: measured in a browser, a bar is 36px
  on a wide screen but wraps past 100px on a phone, and freezing that would
  spend a third of the screen on navigation nobody is reading.

### Fixed
- The audit log's heading sat below its tab bar while every other page in the
  section had it above.

## 0.16.0 — 28 August 2026

### Added
- **File notes that cannot be altered.** The timeline is where the story of a
  matter is told, and it is worth something precisely because it cannot be
  tidied up afterwards. `entries` is now append-only at the database: an edit to
  the wording, the kind, the dates or the author is refused, and so is a delete.
  Verified by attempting each directly against the database.
  - Two things stay changeable because neither alters what was said: whether a
    note is pinned, and attaching a file to a note already written — and that
    only ever goes from nothing to something, enforced by the same trigger.
  - The one exception is the fabricated demonstration data, whose identifiers
    all begin `demo_`, so it can still be removed.
  - A correction is a new note. Both stand, in order.
- **Backdating.** A note can be filed under the day the call or meeting happened
  while the file still records when it was written up; the timeline shows both
  when they differ.
- **A note can carry a file**, linked from the note and listed under Documents.
  Needs R2; until then the box says so. If an upload fails the note is still
  saved and the person told — what they typed is never lost to a failed upload.
- Document storage now has step-by-step instructions in the setup guide,
  including what R2 is, what it costs, and that everything else works without it.

### Changed
- **Administration is one set of tabs.** Users, Practice settings and the Audit
  log were reached by buttons while the rest of the section used tabs — the same
  navigation wearing two faces. A tab may lead to another page as readily as to
  another part of this one; what matters is that the whole section is visible
  from anywhere in it.
- Settings shows a second, quieter bar for the groups within it, so the two read
  as an outline rather than two equal choices.

### Fixed
- **A date somebody typed was stored at midday UTC**, which is the small hours
  of the following morning in New Zealand — a note backdated to Thursday would
  have appeared on the file as Friday. Dates are now stored at an instant that
  falls on the intended day here, in either of our offsets, and a date-only
  value shows as a date rather than with a fabricated time. Covered by tests
  across both standard and daylight time.

## 0.15.0 — 28 August 2026

### Added
- **Payment stages on a quote.** A quote answers two questions and the system was
  answering only one: the items say what is being paid for, the stages say when
  each part falls due. They are stored apart rather than derived from each
  other, because they do not line up — one piece of work is often split across a
  deposit and a balance, and one stage can gather several fees into a single
  payment. Each stage carries its own wording, figure and GST treatment, so it
  prints as "$1,750 + GST" or a flat amount, the way a terms of engagement fee
  schedule does.
  - **Draft stages from the items** writes one stage per item as a starting
    point, to be reworded, split or merged. How a matter is staged is a
    judgement about that client, not something the system should decide.
  - The page says so when the stages do not add up to the quote total, before it
    goes out.
  - A free note under the schedule, as the practice's own template provides for.
- **Bank account details on the quote**, from Settings → Practice.

### Security
- **The bank account is off by default.** A quote is forwarded on, and account
  details are exactly what invoice-redirection fraud feeds on; showing them is a
  decision to take deliberately. When shown, the quote asks the client to quote
  its reference and tells them to telephone before acting on any email that
  appears to change the details.

### Changed
- Choosing **Disbursement** now defaults the GST treatment to none, since money
  paid to Immigration New Zealand or a panel physician on a client's behalf is
  passed through as it stands. A treatment already chosen by hand is left alone,
  and the form says so where the script is not running.

## 0.14.0 — 28 August 2026

### Added
- **Quote lines can be edited**, not only added and removed: description,
  quantity, unit, price, type, GST treatment and order, all on one form. A line
  whose quantity or price cannot be read is left exactly as it was and named in
  the message, rather than being written half-changed or silently dropped.
- **Emails can be sent as formatted HTML as well as plain text.** Written as
  plain text with light markers — `**bold**`, `*italic*`, `## heading`, `-` and
  `1.` lists, and bare web addresses — and a small toolbar inserts them.
  Choosing *Formatted* sends both parts, so a client whose mail client will not
  render HTML still gets a readable letter.
  - Deliberately not a rich-text editor: no `contenteditable`, no
    `execCommand`, no library. What is stored is the text the person typed,
    which is what makes it safe to render and readable in the audit log.
  - The renderer is shared with knowledge base articles, so there is one place
    where escaping could be got wrong and one set of tests covering it.
  - HTML emails style inline rather than with a stylesheet, because that is
    what mail clients honour.

### Changed
- **The working area is wider on a desktop** — 1400px rather than 1180px, still
  capped so a line of prose does not run the full width of a large monitor. The
  public page keeps its own narrower measure, being read rather than worked in.
- **The compose form uses the full width**, with the body in a monospace face —
  the figures in a quote are padded into columns and only line up in one.
- The catalogue picker's explanatory text moved out of the form row, where it
  made that field taller than the others and threw the row out of alignment.
- **The terms of engagement is a link on its wording** rather than a bare URL
  across the page. The address itself still prints, because a hyperlink is no
  use to somebody holding a printout.

## 0.13.0 — 28 August 2026

### Added
- **Case types are configuration, not code.** The seventeen types this system
  shipped with were a guess; the practice's own list runs to sixty-odd in a
  shorthand it already uses. That list is now the default, editable under
  Settings → Lists and dropdowns, and validated on write so nothing
  unrecognised reaches the database. Case statuses stay in code: they decide
  which transitions are legal, so they are workflow rather than vocabulary.
  - A general vocabulary layer (`src/core/vocabulary.ts`) so the next
    amendable list is a declaration rather than a refactor.
  - Migration 0012 maps existing cases onto the nearest new term. Anything
    unmapped keeps its value and shows as itself — a case filed under a type
    since retired is still that kind of case.
  - The AI layer is handed the configured list per request rather than
    importing one, so a type added this morning is one it may suggest this
    afternoon.
- **Search that answers as you type**, on the case and client lists. Debounced,
  with the previous request cancelled so a slow answer to an abandoned query
  cannot overwrite the one being typed now. Pure progressive enhancement: with
  JavaScript blocked the form submits and the Filter button works exactly as
  before. Verified in a browser that the document is never re-created.
- **Column headings stay put** while a long list scrolls under them, meeting the
  navigation bar exactly. This needed `overflow-x: clip` rather than `auto` on
  the table wrapper — `auto` makes the wrapper a scrolling box, and a sticky
  heading then sticks to *it* and scrolls away with the page. Verified in a
  browser rather than assumed.
- **Names and email addresses are editable on Admin → Users**, including your
  own — a person marries, or was entered with a typo, and neither is a reason
  to make a new account and orphan the audit trail. Your own role and status
  stay locked so you cannot demote or suspend the account you are signed in
  with; a forged post trying to is ignored rather than obeyed. A duplicate
  email is refused with an explanation, and each field change is recorded in
  the audit log with its before and after.

### Changed
- **Lists fit a phone.** Six columns cannot share 390 pixels, so on a narrow
  screen four of them are dropped and their content folded into the matter or
  name cell, where it reads as a line of text instead of a squeezed column.
  Titles clamp to two lines. Case rows went from ~250px tall to ~110px.
- Columns now take declared widths (`table-layout: fixed`) instead of being
  sized by whichever cell holds the longest word, so a long status can no
  longer take the space three other columns needed.

### Fixed
- **The demonstration seed would have failed** against the current schema: it
  created tasks with no owner, which `NOT NULL` now refuses. It resolves the
  owner account in the statement itself, so it works on any installation.
- The seed also wrote the old case-type keys, which showed as raw keys in the
  list rather than labels.

## 0.12.1 — 28 August 2026

### Fixed
- **The figures strip on Today was unusable on a phone.** Six boxes laid out as
  a flex row with a minimum width fought over 390 pixels until each was a couple
  of characters wide, and the labels wrapped one letter per line — "OPEN CASES"
  came out as a column of letters, and `$17,480.00` broke across nine lines. It
  is now a grid, which decides how many fit and wraps the rest, and drops to two
  columns on a phone. Labels and figures also opt out of the page-wide
  long-word breaking that a client's email address needs but a number does not.
- Checked with a real browser at 390px: no page-level horizontal scroll on the
  dashboard, clients or quotes — only the navigation strip and tables scroll,
  inside their own boxes, which is intended.

### Added
- Tests covering those layout decisions, so the ones that were got wrong once
  cannot be got wrong again silently.

## 0.12.0 — 28 August 2026

### Added
- **Itemised quotes.** A quote is now a list of lines — description, quantity,
  unit, price per unit — rather than one description and one figure, which is
  not what a client receives from a professional practice.
  - Professional fees and disbursements are shown and totalled separately on
    the printed quote, because a client is entitled to see what is the
    practice's fee and what is money passed through on their behalf.
  - Subtotal, GST and total payable. The GST line is omitted entirely when
    nothing on the quote carries any, rather than printing a zero.
  - Quantities are stored in thousandths, so a quarter of an hour is exactly
    250 rather than a float that multiplies into a rounding error. The quantity
    is applied and rounded once, then GST separated from that single figure —
    doing it the other way multiplies the rounding error by the quantity.
  - Each line keeps the GST rate that applied when it was written, so reopening
    an old quote shows the arithmetic that was actually sent.
- **A catalogue of standard items** behind the description dropdown, at
  Quotes → standard items: add, edit and retire. Choosing one fills the line in
  (client-side, from data attributes — no request). A quote keeps its own copy
  of the wording and price, so editing the catalogue never alters a quote
  already sent. Items are retired rather than deleted.
- **Validity as a date, never a number of days.** Set the date of issue and how
  long the quote stands; the register works out the last day, counted
  **inclusive of the day of issue** — issued on the 28th, seven days means good
  through the 3rd. Both are stored on the quote, so changing the practice
  default later does not silently rewrite what a client was promised.
- **Practice GST number and postal address** on every quote, from
  Settings → Practice.
- **Settings → Quotes**: default validity, the capacity wording ("subject to our
  capacity to accept the work at the time you accept it"), payment wording, and
  the default unit.

### Changed
- **Converting a quote to case fees copies one fee line per quote line** instead
  of two lumps, and marks only professional fees as included in the revenue
  split. Disbursements are never apportioned — splitting them would hand the
  practice a share of somebody else's fee.
- The covering email is itemised to match the printed quote, with figures
  aligned for a plain-text mail client and a long description taking its own
  line rather than being truncated.

### Fixed
- `/quotes/catalogue` was being matched by the `/:id` route and returning 404.
  Routes are matched in registration order; the literal path now comes first.

### Documentation
- The manual explains itemising, the fee/disbursement distinction and why it
  matters to the split, standard items, and how validity is counted.
- The role descriptions on Admin → Users moved out of the form's column layout,
  where they collided with the text beside them, into their own block below it.

## 0.11.0 — 28 August 2026

### Added
- **The public page is built to be found and to be read by machines.**
  - A canonical link, Open Graph and Twitter card tags, and a title that says
    what the practice is rather than only its name. The canonical address is a
    setting, because a Worker answers on its `workers.dev` name as well as the
    real domain and search engines treat those as two sites with one page.
  - **Schema.org structured data** as JSON-LD: the practice (`LegalService`,
    `Attorney` or `ProfessionalService` — a setting), the services as an offer
    catalogue, and the questions as a `FAQPage`. All generated from the same
    settings as the visible page, so they cannot drift from it.
  - **`/llms.txt`** — the page as plain prose, for answer engines that read a
    page rather than ranking it. Same facts, no layout to parse.
  - **`/robots.txt` and `/sitemap.xml`**, both derived from the indexing
    setting. While indexing is off, robots.txt disallows everything and the
    sitemap and llms.txt return 404. When it is on, only the public page is
    offered — every register path is explicitly disallowed.
- **A brighter favicon**, plus `apple-touch-icon` and a `theme-color`.

### Changed
- **Clients are now Leads / Individuals / Organisations / All**, replacing
  Leads / Clients / Everyone. Leads cuts by stage; the other two cut by what
  kind of client it is, because looking for a person and looking for a company
  are different errands. Archived records stay out of all but All.
- **Administration is tabbed** — Overview, Integrations, Modules, Maintenance —
  rather than one page that ran well past the bottom of the screen.

### Documentation
- **`docs/principles.md`** records the rules this system is built to, including
  the new one: *if a page would run longer than one standard desktop screen,
  split it into tabs.* A page that runs past the fold hides half of itself, and
  the half it hides is the half nobody maintains. Tabs here are plain links with
  a `?tab=` parameter — no JavaScript, each one linkable, and the back button
  behaves.

### Security
- JSON-LD is emitted inside `application/ld+json`, which browsers treat as data
  rather than code, so the policy forbidding inline script is unchanged and no
  exception was opened. `<`, `>` and `&` are escaped inside it so no settings
  value can close the element early — covered by tests.

## 0.10.0 — 28 August 2026

### Added
- **Gmail as an outbound transport.** Cloudflare Workers cannot open an SMTP
  connection — SMTP needs a raw TCP handshake the runtime does not offer — so
  this uses the Gmail REST API over HTTPS with OAuth. Google is also retiring
  app passwords, so OAuth was the destination regardless. Sending this way keeps
  the message in the practice's own Sent folder and brings replies back to the
  inbox they already read.
  - The refresh token is exchanged for a short-lived access token, cached in KV
    until a minute before it expires, so a hundred messages cost one token
    request rather than a hundred.
  - A 401 clears the cached token, so a revoked grant is not replayed.
  - Header injection is closed off: newlines are stripped from `From`, `To` and
    `Cc`, and a non-ASCII subject is sent as an RFC 2047 encoded word. Tested
    with a subject and recipient carrying `\r\nBcc:`.
- **Step-by-step setup instructions in the application**, at
  Help → Connecting Telegram, WhatsApp and email. Written for someone who has
  not done this before: BotFather through to `setWebhook`, the Meta app through
  to subscribing to the `messages` field, Cloudflare Email Routing, and the
  Google Cloud project through to the refresh token. The webhook URLs are
  rendered from the address the page is being served on, so they are always
  correct to paste.
- The guide also answers who triages what arrives, and why nothing from an
  inbound channel is ever created without a person seeing it first.

### Changed
- **Admin → Integrations names what is still missing** for outbound email rather
  than only reporting it as off, and links to the setup guide.

## 0.9.0 — 28 August 2026

### Added
- **A knowledge base.** Visa packs, internal circulars, legal material,
  announcements and immigration instructions, searchable and taggable, sharing
  the same tag vocabulary as cases so "AEWV" means the same thing on a matter
  and on a circular.
- **Publication and effective dates are separate fields**, plus an expiry and a
  review date. Immigration instructions are routinely announced weeks before
  they apply; collapsing those into one date makes the register unable to answer
  either "what was the rule in March" or "what changes next month".
- **Follow-up tasks raised from those dates**, a configurable number of days
  ahead (7 by default; 0 means the day itself). They are *reconciled* rather
  than fired once: recomputed when an article is saved and again every night, so
  changing the lead time in settings corrects every existing follow-up instead of
  leaving a trail of stale ones. A follow-up someone has finished or cancelled is
  never reopened by the nightly run. Verified end to end: changing the lead time
  from 7 to 3 moved both follow-ups on an untouched article, and a second run
  changed nothing.
- **File an inbound message into the knowledge base** from the inbox. Subject,
  text and arrival date carry across; the original stays in the inbox and the
  article links back to it.
- **Version history on every article**, with an optional note of what changed, so
  what an article said on the day a client was advised stays recoverable. Like
  the audit log it is append-only, enforced by database triggers rather than by
  convention — verified by attempting an update and a delete directly against
  the database and having each refused.
- **Superseding**: marking a new article as replacing an old one moves the old
  one to Superseded and stops its follow-ups, deleting nothing.
- **Kinds are configuration**, edited in Settings as `key | Label`, one per line,
  and validated on write — so a new kind is a line in a text box, and nothing
  unrecognised can reach the database.

### Changed
- **Every task now has an owner.** `tasks.assigned_to` is `NOT NULL` with
  `ON DELETE RESTRICT`: an unassigned task is work nobody has agreed to do, and
  a person with open work cannot be removed out from under it. What a task is
  *about* stays optional. Existing unassigned tasks are given to whoever created
  them, falling back to the owner account — none are dropped. Verified on a
  populated copy of the schema, including the case with no creator either.
- The task forms default the owner to the person adding it, and refuse a
  suspended account: assigning work to someone who cannot sign in is the same as
  not assigning it.

### Security
- Article bodies are rendered by a small purpose-built renderer rather than a
  Markdown library. A parser that emits HTML would sit in the path of everything
  a stranger can put in front of the practice through an inbound channel. This
  handles paragraphs, lists, headings and links; every fragment goes through the
  escaping templates, and only `http`/`https` are linked. Covered by tests that
  push script tags and quote-breaking URLs through it.

## 0.8.0 — 28 August 2026

### Added
- **A public page for the practice**, served at the root of the site to anyone
  who arrives without a session. Signing in falls through to the dashboard as
  before, so the register is unchanged for the people who use it.
- Hero, services, process, about, questions and a closing invitation — all of
  the wording held in settings under **Settings → Website**, edited by the
  practice without a deployment. The four list fields take one item per line as
  `Heading | text`; a line with no bar is a heading on its own, blank lines are
  ignored, and a missing field renders as an absent section rather than an
  error.
- **Optional public enquiry form**, off by default. When switched on it creates
  an inquiry in the register with source `web`, ready for triage alongside
  everything arriving by email, Telegram and WhatsApp.

### Security
- The public page is **not indexed** unless the practice turns indexing on:
  this address also serves the client register, and putting it in a search
  index is a decision for a person rather than a default.
- The enquiry route **only writes**. It creates an inquiry and says thank you;
  it never reads the register back, so there is nothing for a probe to learn
  from it. It returns 404 when the form is switched off, so the endpoint does
  not exist until the practice says it does.
- Protected by the existing same-origin check (verified: a cross-origin post is
  refused with 403), a hidden field no browser fills in — answered with the same
  thank-you a person gets, so an automated caller learns nothing from the
  difference — five submissions per hour per address, and length limits on every
  field. The rate-limit key is a hash of the address, so KV never holds an IP.
- The website carries no design tokens of its own; it renders in the same
  palette as the register, which means it inherits the same CSP with no inline
  script, no inline style and no third-party origin.

### Fixed
- A redirect back to an anchor was building `/#enquire?ok=…`, which puts the
  query inside the fragment where the server never sees it — the visitor would
  have been told nothing after sending an enquiry.
- The two settings tables that scroll horizontally on a narrow screen were
  missing the box that lets them.

## 0.7.0 — 28 August 2026

### Added
- **Day and night modes, and three themes.** Slate (cool greys, deep blue),
  Warm (paper tones, terracotta) and Ink (blue-charcoal, teal), each with a
  light and a dark rendering. Colour mode can follow the device or be pinned
  light or dark. Chosen under **My account → Appearance**.
- The choice is stored on the user row, not in a cookie, so it follows the
  person between devices and is rendered into the first response — there is no
  theme script, nothing extra to download, and no flash of the wrong colours.
- **Appearance changes are recorded in the audit log** like every other change
  to a user record.

### Changed
- **The interface is now laid out for a phone deliberately, not as a
  fallback.** On a narrow screen the navigation becomes one swipeable strip
  with every section still reachable (no menu script), controls grow to
  thumb size, form controls render at 16px so iOS Safari stops zooming the
  page on focus, rows that pair a label with an action stack instead of
  squeezing, and nothing scrolls sideways except tables, which do it inside
  their own box.
- **Typography and density.** Tighter type scale, a system font stack that
  resolves to SF Pro, Segoe UI Variable, Inter or Roboto depending on the
  machine — still zero font bytes over the wire, because the CSP allows only
  self-hosted fonts and a font file would be the heaviest thing on the page.
  Tabular figures throughout, so money columns line up.
- Badges are small rounded rectangles rather than pills, and headings, tables
  and buttons are a touch smaller and quieter.

### Security
- Only the themes and colour modes the application defines can be written to
  the database; anything else is refused, and a value that somehow got stored
  is ignored on read in favour of the default.
- Printing forces the light palette, so a dark-mode quote does not come out of
  the printer as light text on white paper.

### Internal
- Adding a fourth theme is one block in `public/app.css` and one entry in
  `src/ui/theme.ts`. A test fails if the two ever disagree.
- The two settings tables that were not wrapped for horizontal scrolling now
  are.

## 0.6.0 — 28 August 2026

### Added
- **Case tags.** Free-form labels created the moment you type one — no
  administrator required. Shown on the case list, filterable, and matched
  case-insensitively so "AEWV" and "aewv" are one tag.
- **Case parties.** A case can now have several clients on it, each in a role:
  principal applicant, secondary applicant, supporting partner, dependent
  child, employer, sponsor, agent. The role belongs to the link, so a company
  can be the client of its own accreditation and the employer on somebody
  else's work visa at the same time.
- **Related people** on a client page — everyone appearing on a matter with
  them, which is how a family group shows itself without a second list to
  maintain.
- **Organisation contacts.** A person can be linked to a company client with
  their role there, and one of them named as its primary contact.
- **Leads and clients** are now separate views of the same list, with
  conversion as a one-click status change.
- **Demonstration data**: 20 clients and 15 cases covering families, employers
  and the deadline-driven matters. Marked three ways and removable in one click
  from Admin.

### Changed
- "Prospect" is now called **Lead**, and "Active" is called **Client**.



### Added
- **Settings page with tabs.** Practice, Security, Fees and GST, Alerts and
  Inbound channels. Each tab is contributed by the module that owns those
  parameters, so adding a setting is a declaration rather than a form.
- **Practice details** — name, contact details, adviser or barrister details,
  and the terms-of-engagement link and wording.
- **Terms of engagement on every quote**, on screen, in print and in the
  emailed version, pointing at whatever link is configured.
- **Print, email and cancel for quotes.** The printable version drops the
  application chrome; the emailed version is drafted for you to edit, records
  itself on the file, and queues through the outbound mail system.
- **Security policy**: optionally require two-factor authentication for
  everyone, and raise the minimum password length.
- **In-app manual** at Help, and the version in the footer.

### Changed
- Settings are typed and validated from their declarations. Only a declared key
  can be written, and a partial form post no longer blanks fields it did not
  mention.

## 0.4.0 — 28 August 2026

### Added
- **Editing for every record.** Tasks, quotes, inquiries and fee lines can now
  be edited, not only created and status-changed. Clients and cases already
  could.
- **Task editing** covers title, details, due date, priority, status, owner and
  detaching the task from the record it hangs off. Reachable from the task list
  and from the case page, returning to wherever you came from.
- **Fee line editing** recalculates GST at the practice's current rate, and
  shows which rate the line was originally entered at.
- **Audit log by person.** Filter by user, action prefix or date; each user row
  in Admin → Users links to that person's activity.

### Changed
- **The audit log is append-only at the database.** Triggers refuse every
  UPDATE and DELETE from any caller — the application, the Cloudflare console,
  the D1 API. Previously nothing modified audit rows, but that was a property
  of the code rather than of the data.
- Material changes now also write to the record's timeline: a changed fee
  total, a changed quote total, a renamed or reassigned task.

### Note
- Because the audit log cannot be altered, it cannot be pruned in place. See
  `docs/operations.md` for how to archive it deliberately.

## 0.3.0 — 28 August 2026

### Added
- **Given names and family name kept separate** for individuals. Immigration
  forms, INZ correspondence and police certificates all distinguish them.
  Existing records keep their name; the edit form suggests a split to confirm.
- **Organisations as clients**, identified by NZBN and Companies Office number.
- **Document expiry tracking**: passport country and expiry, police certificate
  country, issue and expiry, medical certificate and chest x-ray expiry.
- **Alerts page** — one list of everything with a date: case deadlines, overdue
  tasks, expiring quotes and expiring client documents, ordered by how soon
  they bite.
- **NZBN register lookup** (optional, needs a free MBIE API key). Create a
  company client from the register rather than retyping its details.
- Dashboard card for documents expiring in the next 90 days.

## 0.2.0 — 28 August 2026

### Added
- **Sign out** in the top bar. The route existed but was only linked from the
  two-factor screen.
- Worker secrets are managed as GitHub repository secrets and uploaded by the
  deploy workflow, so a redeploy cannot leave the Worker without them.
- Unhandled errors are recorded in the audit log with their request id, path
  and message.
- Role descriptions on the add-user form.

### Changed
- The "Licensed adviser" role is now called **Specialist**, covering lawyers as
  well as licensed immigration advisers.

### Fixed
- **Password hashing exceeded a platform limit.** Cloudflare Workers refuses
  more than 100,000 PBKDF2 iterations in one call; the code asked for 600,000,
  so creating the first account failed with a generic error. The work factor is
  now expressed as rounds × iterations and chained, so it can be raised without
  breaching the per-call limit.
- First-run setup accepts a token pasted with a trailing newline, and explains
  what to check when one is refused.

## 0.1.0 — 27 August 2026

Initial release.

### Added
- Clients, cases (16-status lifecycle with enforced transitions), inquiries,
  quotes, tasks and a shared timeline.
- Fees with per-line GST treatment and an adjustable revenue split between the
  principal and the admin team, allocated to the cent.
- Inbound capture from email, Telegram and WhatsApp, verified by signature and
  gated on sender allow-lists, triaged in an inbox.
- Optional AI triage layer that suggests but never writes, and an outbound
  email queue.
- Sign-in with TOTP two-factor, five roles, CSRF and origin checks, a strict
  content security policy, encrypted passport numbers and an audit log.
