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

If you have not sent one yet it uses the newest quotation on the register and
says it has not been sent. With no quotations at all it says so in a sentence
and tells you to create one — which is what a trial register will see on its
first day.

**This paragraph said "issued" until it was reviewed, and so did the page.**
That was wrong, and wrong in the ordinary case: the register stamps a date of
issue on *every* quotation the moment it is created, so reading that date told
us a draft nobody had ever sent was "the last quotation you issued". What
records a quotation going out is a separate mark, set when it is sent. Caught
before it reached you, by having the work reviewed by somebody who had not
written it.

---

## 8. Every page now says which role may open it — and the check found a real hole

The register has 233 pages and five roles. Three tests in the whole suite
checked that a page refused the wrong person. The thing that catches is not an
attack: it is a page added without its permission check, which looks exactly
like working software until somebody with the wrong role opens it.

There is now a test that reads every page out of the running application and
insists each one names the permission it needs, then signs in as each of the
five roles and proves that every combination which should be refused is. A page
added without its check now fails the build.

**On its first run it found one.** An upload token is the credential your Apple
shortcut carries when it sends a file in. Anyone who could sign in could make
one — including somebody on Read only, whose whole point is that they change
nothing. Making a token was a way of writing into your inbox that their role
should never have had. Making one now needs the same permission as working the
inbox.

**And the fix was half a fix, which the review caught.** Guarding the button was
not enough: a token lives on a laptop and does not disappear when somebody's
role changes, and a token can only be cancelled by the person who made it — so
you would have had no way to take it back short of suspending their whole
account. The check is now made when the token is *used*. A change of role stops
it at the next file sent.

**What this means for you: nothing, unless somebody in the practice is on Read
only and has an upload token.** Theirs will stop working, which is the point.
No other token was touched and none were cancelled.

---

## 9. The client's acceptance link is no longer printed for everyone

Somebody on **Read only** — or an assistant — can open a quotation, read the
client's acceptance link off the page, and use it to accept the quotation in the
client's name. The register then records the contract as formed, sends the
letters, and says the acceptance cannot be undone.

Every individual permission here is correct, which is why the new test cannot
see it. The page is one those roles are entitled to read. The *link on it* is
the whole authority — it has to be, because the client has no account.

Put to you, and you said **proceed**. Shipped the same day as 1.61.0.

The address is now shown to whoever may send a quotation — you, an administrator
or a specialist. Everybody else is told the client has their link and when it
went out, which is what that panel is read for. The knowledge-base share address
went the same way, shown to whoever may create one.

**No link changed and none was cancelled.** Every address already with a client
still works. This was only about who can read one off a screen.

**The rule worth keeping.** A test that checks who may open a page cannot check
what the page hands out once it is open. Both leaks here sat behind permissions
that were individually correct. When a page prints a token or an address that is
itself an authority, the question is not "who may read this page" — it is "who
may hold this thing".

Written up as issue 13 in `docs/issues.md`, now closed.

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
that now prevents it. A fifth was added later the same day — fault 43, the
upload token above: **a credential outlives the decision that allowed it, so the
permission is checked where it is spent, not only where it is issued.**

---

## What is waiting on you

Both of the things that were waiting on you were answered on 12 September and
are done: the acceptance link (section 9) and the demonstration-data workflow,
which you asked to be removed — *"no need for the test data to be loaded into
the live register."*
