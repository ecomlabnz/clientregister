# What was built, 12 September 2026

For the practice, not for a developer. Grouped by what changed for you rather
than by release number, and written so you can read it without translating
anything.

**No client is named anywhere in this document.** Where a record has to be
identified it is identified by its reference, which means nothing outside the
register.

| | |
|---|---:|
| Releases | **1.55.0 → 1.57.0** |
| Migrations | **1** (0092) |
| Tests | **2,618** in 158 files, up from 2,541 |
| Registers running | **2** — the practice's, and a trial |
| Faults found and fixed | **4**, one of them affecting the live register |
| Still open at the end of the day | the demonstration-data workflow, and the seeded caseload |

---

## 1. Surnames come first

A matter used to read **RV. Partner — Bao Long VUONG**. It now reads
**RV. Partner — VUONG, Bao Long**.

Same for quotations, and for every list of clients you pick from. Lists now read
down the surname, the way a file drawer does. Before this, a list of two hundred
was sorted by whatever came first in the name, which for most of this caseload
is not the surname anybody is looking for.

The visa type stays at the front — that was your own decision in September, and
sorting by name still groups by kind of work.

**The client's own record still reads Bao Long VUONG**, in the natural order,
because that is the order a letter is addressed in. Two jobs, two orders.

189 matters and 7 quotations were renamed. Companies were left alone: there is
no surname in a registered name to bring forward. A quotation a client had
already accepted keeps the name it was accepted under.

## 2. Boxes you type into, instead of dropdowns you scroll

*"it is just impossible to search through this!"*

The matter box on a new quotation held seventy lines. The client box holds two
hundred and forty-five. Neither could be searched — pressing a key in a dropdown
looks at the first letter of the line, and every line began with the visa type.

Those boxes now take typing. Type part of a surname, a reference, or a kind of
work and the list narrows. Click the arrow and the whole list is still there.

**Where it applies:** new quotation, edit quotation, new matter, edit matter,
adding a party to a matter, new invoice, new inquiry, edit inquiry, and
converting an inquiry. The matter box on an invoice is still a dropdown — it
only ever holds that one client's matters and is short already.

**It refuses rather than guesses.** Type something that fits two matters and it
says so instead of picking one. A quotation attached to the wrong file is not a
mistake worth saving a keystroke for.

## 3. Read a document into a client's file

The card that was only on a matter is now on the client too, above Files. Drop a
document in, tick one already on the file, or point it at Google Drive — then
the same review screen and the same press before anything is written.

You were right that a client holds more than a matter does: name, title, gender,
place of birth, national identity, passport, visa, INZ number, nationalities.
All of those can now be filled from a document without opening a matter first.

**Nothing is lost where there is no matter.** If the document also mentions an
application number or a lodgement date, there is no box for it on a client — so
it goes into the file note, saying what it was and that it belongs on a matter.

**A client can only be pointed at their own documents.** Not another client's,
and not the ones filed to their own matters — those were filed there on purpose.

## 4. The register backs itself up every night

Until today the only backup was the button you had to remember to press. A
backup that depends on somebody remembering is a backup that exists until the
week they are busy, which is the week they need it.

From tonight it happens on its own at 7pm, as part of the run that already
expires quotes and sets your reminders. It writes a copy of the whole register
into storage, **reads it back to check it is really there**, and keeps the last
30. The newest is never deleted, whatever the setting says.

**Settings → Exports and backups shows a date, not a tick.** No backup for two
nights and there is a red band. That is the page to look at if you ever wonder.

**What it protects you from:** rows deleted by mistake, a bad change, the
database itself lost. That is the likely bad day.

**What it does not:** losing the Cloudflare account, because the copy is kept
inside it. For that, press the full backup button now and then and keep that
file somewhere else. That one includes the documents; the nightly one leaves
them out on purpose, because they already sit in the same storage the backup is
written to.

## 5. A second register, for a paying customer to trial

The largest thing of the day, and it needed **no change to the application at
all**. That is the whole return on the decision of 3 September — one practice,
one database — and it is why this was a plumbing job rather than a rewrite.

### How it works

One recipe, two kitchens. One copy of the program; two running copies of it,
each with its own locked filing cabinet beside it. The program can only ever
see the cabinet it is standing next to, so there is no "whose client is this?"
question for it to get wrong.

When a change ships, both get it in the same minute. Neither can be left on an
old version, because there is only one recipe.

### What exists now

| | Yours | The trial |
|---|---|---|
| Address | `app.immigration.kiwi` | `trial.immigration.kiwi` |
| Clients | 245 | 0 |
| Users | you | one owner, with two-factor on |
| Storage | `files` | `clientregister-trial-files` |
| Nightly backup | yes | yes, from tonight |

Confirmed against the real databases, not against a configuration file.

### What is different between them

Only three things, and none of them are in the program: which cabinet it is
next to, the address, and the firm's own name and details, which are typed into
Settings rather than written into code.

### The question that had been parked since 3 September

We had written down that Cloudflare might need a separate deployment per
practice and that nobody had checked. It does not. Up to about ten practices,
each one is a block of configuration. Past that there is a way to create the
whole thing with no configuration file at all. Both confirmed from Cloudflare's
own documentation.

## 6. A button that creates a practice's storage

Every practice needs its own file storage, and without it there is no document
storage **and no nightly backup**.

Storage gets locked to a part of the world the first time a name is used — which
is why your own bucket had to be renamed once. We had written down that it must
therefore be created from a browser in New Zealand.

**That turned out to be the workaround, not the rule.** The proper command takes
a "where should this live" setting; the earlier failure was a method that had no
such setting, so it placed the storage next to whoever asked. Corrected, and
there is now a button under Actions → *Create a practice's storage* that does it
properly and then checks where it actually landed.

Used for the trial today: created from a machine in the United States, landed in
Oceania.

## 7. See the quote and the letter before you send one

*"in the settings quotes and Letter of engagement - there should be a button to
preview these two documents or how they appear?"*

You edit the wording of both as boxes of text under Settings. A box of text is
not a document, so the only way to see what a change looked like was to go and
find a real quotation and open it.

There is now a **Preview** button on each of those two settings pages. It draws
the finished document — the same page a client is sent — with your wording as it
stands now.

**It draws on your most recently issued quotation.** That was a deliberate
choice over inventing a specimen client: an invented one shows invented figures
and invented names, and the thing you are checking is how *your* words sit in a
real document. The cost of that choice is that a real client's name is on the
page, so a band across the top says which quotation it is and that this is a
preview. That band prints, unlike the note on the client's own page — a printout
without it would be indistinguishable from the document itself.

Looking writes nothing: no record of a document being printed, no change to the
quotation, no client link minted. Only somebody who can already open Settings
can open a preview, because it shows a client file.

If nothing has been issued yet it uses the newest quotation on the register and
says it is not issued. With no quotations at all it says so in a sentence and
tells you to create one — which is what a trial register will see on its first
day.

---

---

## Four things I got wrong, and what changed because of them

Written down because they cost real time and the same shapes will come back.

**A deploy that ran nothing.** I added the trial's deploy with a switch that
GitHub does not allow in that position. Rather than disabling that one job it
rejected the whole file, so a push deployed nothing at all. The commit was
documentation only, so nothing was lost — that was luck. Fixed, and the check
now refuses that shape.

**A test that proved nothing.** Both that fault and the next one had tests. Both
tests checked that a line of text was present in a file, and in both cases the
line *was* present and the thing still did not work. Those are now written to
break the thing on purpose and confirm the test notices.

**Client names in the code.** While writing examples I used names taken from a
screenshot of your live register. The repository's own test found them before
anything was committed and I replaced them with invented ones. Nothing real was
committed.

**Your register going down for a minute at a time.** The worst of the four,
because you were working in it. Giving the trial its address put that address
into the deploy configuration — which means every deploy re-stated it, and
because both addresses sit on the same domain, re-stating one briefly knocked
the other over. Your own address had never been done that way: it was set up
once, by hand, and has never flickered in weeks. Now the trial's is set up the
same way.

The wider lesson, and the reason it is written down: **the fault was not in the
new register, it was in yours** — and nobody had changed yours. Two registers
share a domain and an account, so setting the second one up *is* a change to the
first one's world. "It only affects the trial" is something to check, not to
assume.

All four are in `docs/spec/mistakes.md` as faults 39 to 42, each with the rule
that now prevents it.

---

## What is waiting on you

1. **The seeded caseload for the trial** — 20 matters, 5 simple, 10 complicated,
   5 unusual, people from different countries. Asked for; not built yet.
2. **The demonstration-data workflow** from August, which can still load
   invented clients into your live register with one click. It should go; the
   Test Data page inside the register replaced it.
