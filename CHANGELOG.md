# Changelog

Notable changes to the Client Register, newest first. Dates are New Zealand
time. Versions follow [semantic versioning](https://semver.org): the middle
number moves when a feature lands, the last when something is fixed.

The user-facing version of this list, one line per release, is in the app under
**Help → Recent changes**.

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
