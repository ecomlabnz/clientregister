# Changelog

Notable changes to the Client Register, newest first. Dates are New Zealand
time. Versions follow [semantic versioning](https://semver.org): the middle
number moves when a feature lands, the last when something is fixed.

The user-facing version of this list, one line per release, is in the app under
**Help → Recent changes**.

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
