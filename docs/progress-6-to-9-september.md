# What was built, 6 to 9 September 2026

For the practice, not for a developer. Grouped by what changed for you rather
than by release number, and written so you can read it without translating
anything.

**No client is named anywhere in this document.** Where a record has to be
identified it is identified by its reference, which means nothing outside the
register.

| | |
|---|---:|
| Releases | **47** (1.2.1 → 1.32.0) |
| Commits | **59** |
| Migrations | **16** (0064–0079) |
| Things the database refuses | **103**, up from 61 |
| Tests | **1,936** in 122 files, up from 1,114 in 74 |
| Files changed | 115 · +19,712 / −992 lines |

Everything below is merged, deployed and live.

---

## 1. A client can now be sent a quotation, read it, and accept it

This is the largest single thing, and none of it existed on the 6th.

### The link

Press **Email to client** and the drafted email carries a private address. The
client opens it with no account and no password — one page, carrying the
quotation, the letter of engagement beneath it, and a way to sign at the foot.

The address is 128 bits of randomness, which is the same standard the register's
own sign-in cookie is held to. It is created once and never changes. Anybody
holding it can read that quotation, so it is treated exactly as the email it
travelled in.

### Signing

Full name, date, and a tick to say they have read the documents. The register
records that, plus the moment it arrived and the address it came from — their
date is their word, ours is ours, and both are kept because a document recording
only one would be less use in the one argument it exists for.

The Accept button sits at the **foot**, after both documents. A button that
follows the reader down the page can be pressed on the first screen, and what
that records is a click, not a reading. A quiet bar follows them instead, saying
it has not been accepted yet, with a link down to the form.

### What happens the moment they accept

- A green **ACCEPTED** stamp appears at the head of the quotation — on their
  page, on your print view and on paper — with the date, the time and the name.
- **The quotation freezes.** Its lines, schedule, parties, figures, dates and
  status cannot be changed by anyone, including you. A quotation accepted in
  error is answered with a new quotation, exactly as it would be on paper.
- **Two emails go out.** One to the client, saying what they agreed to and
  giving the link again — which is worth keeping precisely because the document
  behind it can no longer change. One to you, saying it arrived, who accepted,
  and that the quotation is now fixed.
- **A full note goes on the quotation's file**, and another on the matter.
- **An audit row** names the client rather than a member of staff.

If the client has no email address on file, your copy says so rather than
letting you assume they were written to. Neither email can hold up an
acceptance: a contract is formed by the client's act, not by our bookkeeping.

### The covering email

It used to type the whole quotation into the body in plain text. It is now your
own letter — the one you gave on the 9th — with the figures, dates and link
filled in, including your paragraph that accepting is **not** a guarantee of any
immigration outcome.

It adapts in five places where a sentence would otherwise be untrue of a
particular quotation: it does not promise a Letter of Engagement that is not
going, does not say "inclusive of GST" when no GST applies, does not mention
disbursements when there are none, uses your own capacity note where you have
written one, and leaves out the closing date when a quotation has none.

---

## 2. The letter of engagement became the document you actually send

On the 6th it was a price list. It is now the document the practice engages on.

- **Every word is yours**, held in the register and editable without a
  deployment: the opening, the scope of the retainer, the standing clauses, the
  administrative team, the acknowledgements, the closing, and the Law Society
  addendum. Nothing is supplied by the register — the words a client is asked to
  accept are the practice's own.
- **The clauses printed are chosen by the kind of work**, and a quotation
  covering two kinds of matter gets the clauses of both. It had been reading one
  source *or* another and throwing away the rest.
- **It names everybody the engagement is with**, not only the payer.
- **`**two asterisks**` around a phrase prints it in bold**, in every wording
  field, so you can emphasise a clause without typing HTML.
- **Pasted numbering is stripped**, so a list already numbered in your document
  does not come out "1. 1. …".
- **The confirmations box takes 10,000 characters.**
- **A place for the Law Society "Information for Clients"** — printed as an
  addendum after your signature, on a page of its own.
- **Justified**, set flush to both margins, as a legal document is set. Only the
  running prose: the address block, the RE line, the salutation, the signature
  and the headings keep their ragged edge.

---

## 3. The documents themselves

### The black pages

A quotation you printed arrived with a near-black rectangle over both pages.
Three attempts to fix it failed because each treated a symptom. The cause was
the **sheet behind the page** — its colour comes from the root of the document,
which no print rule could reach.

A page carrying a document is now simply not a dark page, in any medium. There
is nothing left for a browser to skip. Verified with "Background graphics" on,
in a browser forced dark, through both render paths: six files, no dark fill
anywhere.

### Set like your own invoice

Measured off the Xero invoice you sent rather than eyeballed: **8.5pt** body,
hairline rules between rows, the totals gathered to the right with short rules
rather than lines across the page, section headings in your accent with a rule
under them, and the title top-left with your details top-right.

### And

- **20mm margins**, on every edge of every page, A4 named explicitly.
- **Every document is stamped** — *"Printed Thursday, 10 September 2026 at 1:20
  am NZST"* — so two printings of the same reference can be told apart.
- **"FEE QUOTE" and "INVOICE"** are document titles, at twice their old size.
- **Colour is back** on section headings and links; body text stays black.
- **The standard terms address is a live link** and still prints as a readable
  address.
- **A web address no longer breaks in the middle of "http".**
- **Your administrative team prints exactly as you type it.**
- **Your contact lines are labelled** — Mobile, Email, GST — on both the
  quotation and the invoice.

One thing no stylesheet can control: in the print box, **Margins** must be left
on *Default*. Any other setting overrides what the document asks for. The print
page says so beside the button.

---

## 4. Money

- **The totals sit under the Amount column.** They had stayed under GST when
  Amount moved. The columns are named in one place now and the totals take their
  width from it.
- **The payment schedule cannot promise more than the quotation**, enforced by
  the database, and it tells you what is left to allocate. Saving a schedule
  that would go over is refused as a whole — nothing half-saved.
- **Payment stages show what the client pays**, with how much of it is GST
  underneath. They had shown the net figure with "+ GST" beside it while the
  total below was inclusive.
- **The money columns sit in the same place on every quotation.** They were
  sized by their contents, so a quote with larger figures put them somewhere
  slightly different.
- **A quotation's shape can be saved as the template** for every new one — the
  wording and the GST treatment, never the amounts.
- **The unit can be cleared.** "item" was unremovable by anybody.
- **One list of the work the practice does.** The quotation catalogue and the
  case-type list were two lists of the same thing and could disagree; 67
  duplicate rows were deleted.

---

## 5. Records

- **A matter or a client created by mistake can be deleted**, with seven
  refusals the database makes — an invoice against it, a quotation already sent,
  documents held, a client who still has matters, a client anyone has written
  about, a client named on somebody else's matter. **File notes are never
  destroyed**: deleting a matter moves its timeline onto the client's file.
- **The INZ client number moved to the person** from the application. 64 numbers
  were backfilled; where a person's matters disagreed, a note and a flag were
  written rather than a value guessed.
- **Every surname in capitals, given names in ordinary case**, across the whole
  register.
- **A carriage return removed from 190 names** — invisible on screen, and the
  reason searches were silently missing people.
- **Tags on clients**, matching tags on matters.
- **A full backup**, owner only: one press, one dated zip, every table, every
  document, passport numbers included. Restored and verified.

---

## 6. Two things the register caught that I did not

Worth telling you, because they are the reason the guards exist.

**A real client's name nearly went into the release notes.** The test that
forbids client names in the code failed and stopped the commit. That fault had
happened twice before and was found both times by an audit, weeks later. This
time it was caught in seconds.

**The build stopped on a secret scan.** I had written a 32-character string
named `TOKEN` into a test — a made-up link for a fixture, but nothing said so to
a machine, and a scanner that ignored it would ignore a real one. Rather than
add an exception, the fixture was rewritten so there is nothing to flag: an
exception in a scanner's configuration is a place for a real secret to hide.

---

## What is still waiting on you

| | |
|---|---|
| **Two-factor is switched off** on all three logins, on a register holding live client files at a public address | 5 minutes, and the largest remaining gap |
| **Send yourself a test quote and press Accept** | proven on my machine, not yet on yours |
| **The commit history** still carries nine client names. A rewritten history is on GitHub as `claude/history-without-the-nine`, verified clean and byte-for-byte identical code; the force-push over `main` needs your hand | asked four times |
| **Your wording** — the scope of the retainer, the Law Society addendum, the acknowledgements | yours to write |
| **Whether the letter of engagement should swap its header** as the quotation and invoice did | it kept the letterhead top-left, because a letter is not an invoice |
| **Three INZ numbers** the register refused to guess, and one duplicate client pair | flagged on the files |

## What is queued and not built

- **An automated nightly backup.** Today's is a button somebody presses. This
  remains the largest operational risk.
- **Teams**, so your Vietnamese staff see their own work and not your cases.
  About three or four days: 52 queries touch matters across 21 files, so it
  needs one shared helper every list goes through and a test that fails when a
  new query skips it.
- **A role editor** in Settings, so access is a grid you tick rather than a
  deployment.
- **A PDF attached to the email**, generated by the register rather than by your
  browser. About a day, and likely free at your volume.
- **Which edition of the terms a client accepted** is still not recorded. It
  becomes urgent the first time the terms are republished.
- **Retiring the `workers.dev` address** now that nothing points at it.
