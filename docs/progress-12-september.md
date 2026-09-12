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
| Still open at the end of the day | who may see a client acceptance link |

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

## 10. The one-click button that could fill your live register — removed

There was a **Demonstration data** button in the project's Actions list, built
in August when your register was still empty. Pressing *load* wrote twenty
invented clients straight into your live register. It had no confirmation step,
and anyone with access to the project could press it.

You said: *"yes, remove it, no need for the test data to be loaded into the
live register."* So it is gone — the button, the script behind it and the test
that kept the script working.

**Nothing changes in the register itself.** The Test data page (Admin → Test
data) is still there and still does this job properly: it marks every row as
test data, shows you the list before it deletes anything, and only an
administrator can open it. That page is why the old button was no longer worth
its risk.

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

## 11. And the last piece of it

The card on Settings → Maintenance that removed demonstration data went with the
workflow, in 1.62.0. It only ever appeared when such rows were in the register,
so before deleting it both registers were read: yours holds **245 clients and
199 matters, every one of them real** and not one demonstration row; the trial
holds nothing at all. A card that can never appear is a thing to delete rather
than carry.

Nothing was deleted from your register, and Settings → Test data — your own way
of laying down a caseload to practise on — is untouched and is now the only one.

## 12. The code, not every time

*"allow for 40 days of authentication memory on a machine, not every time. it is
annoying. so the machine should become trusted and only reset on the 41st day"*

When you enter the six-digit code there is now a box, already ticked:
**Remember this machine for 40 days**. Tick it and that machine asks for your
password only, until the fortieth day. On the forty-first it asks for the code
again.

**Your password is still asked for every time.** That is the whole design. The
box skips the code and nothing else — it does not keep you signed in, it does
not make a session last longer, and the cookie on its own opens nothing at all.

**The forty days do not move.** You said *"only reset on the 41st day"*, so they
run from the day you entered the code, not from the last time you used the
machine. Using it every morning does not push the date out. That is also the
safer reading: a window that slides on a machine you open daily never expires.

**My account → Devices** lists every machine you have remembered, when it
expires, and a Forget button. They are all forgotten for you when you change
your password, when an administrator resets it, when you turn two-factor off or
on again, when an account is suspended, and when you use a recovery code.

That last one is worth a sentence. A recovery code means your phone is gone. So
every machine trusted on the strength of that phone stops being trusted, and no
new one is handed out on that sign-in either — trusting a machine with the
authenticator you have just lost would undo the clearing in the same breath. You
are offered the box again the next time you type an ordinary code.

**Settings → Security** sets the number of days. It starts at 40, 0 asks for the
code every time, and 90 is the most anybody can set — that ceiling is in the
code and in the database, not in the form, so it holds however the number gets
written.

**Do not tick it on a shared or public computer.** That is said next to the box
and on the help page.

### What was got right here on purpose, and the rule behind it

Yesterday's fault 43 was about exactly this shape: *a bearer credential outlives
the decision that allowed it, so the permission is checked where it is spent, not
only where it is issued.* A cookie that sits on a laptop for forty days is that
credential, and forty days is a long time in an office — somebody leaves, an
account is suspended, two-factor is reset.

So nothing is trusted from the cookie. Every time it is offered, the register
asks the database again: is this machine still remembered, has the day passed, is
the account still active, is two-factor still on — and **is it still the same
authenticator**. That last check is done by keeping a fingerprint of the
authenticator on the row, so turning two-factor off and on again kills every
machine trusted under the old one on its own, with nobody having to remember to
go and revoke them.

And the rule that came out of building it: **a deadline a program can move is
not a deadline.** The 40 days are pinned by the database itself, which refuses to
change the date whatever asks. A future change that made trust "refresh on use"
would not quietly ship — it would fail on the first sign-in.

---

## What is waiting on you

Both of the things that were waiting on you were answered on 12 September and
are done: the acceptance link (section 9) and the demonstration-data workflow,
which you asked to be removed — *"no need for the test data to be loaded into
the live register."*

One thing I have not done, and it is on me: **the trial register is still
empty.** The twenty matters exist in the code and shipped, but putting them into
a register is a press of the Seed button on Settings → Test data, inside that
register — deliberately, because loading invented clients into a database is
not something a deploy should do on its own. That is the same reason the old
workflow was deleted today. I cannot press it; I have no account on the trial.
It takes about ten seconds and it is the last step before the trial is ready to
show anybody.

---

## 12 September, later: the try-it caseload becomes a practice (1.64.0)

### What you asked for

Five things, in your words:

- *"bring the total of trial cases to 35 and increase the number of clients, add
  some more organisation - all with fake details"*
- *"partners and children do not appear on the matters they belong to"*
- *"i do not see any invoices in trial data - please introduce say 5-7 invoices
  with various stages. also the same for quotes - increase number of quotes to
  the number of actual cases as one would think that a case once started with a
  quotation"*
- *"add some sample entries into the knowledge base to showcase it"*
- *"the principal clients should have varied employment, education and travel
  histories - we need prepopulated register to showcase the system"*

### What changed for the practice

The caseload on Settings → Test data is now a working practice rather than a
list of rows. It is what somebody deciding whether to buy this opens first, so
that is the standard it is held to.

**Thirty-five matters on twenty files.** Nine simply done, eighteen that are
real work, eight unusual — the same mix you asked for in the twenty, scaled up.
Approved, lodged, on hold, a PPI, two declines, a reconsideration, an appeal at
the Tribunal, an Active Investor Plus still gathering evidence, deadlines gone
past and deadlines still to come.

**Thirty-three clients, five of them companies.** Two companies carry their own
accreditation and job check matters; three are on the register only as the
employer named on somebody else's work visa. One company has two employees on
the register, which is what an accredited employer actually looks like.

**Everybody who belongs on a matter is on it.** Twenty-eight party links, nine
of the twelve roles. Partners, children, supporting partners who are not
applying, a sponsor, employer companies, and the director who signs for one.

**Seven invoices**, where there were none at all: two paid, one part paid, one
waiting and not yet due, one overdue, one draft and one voided with the reason
on it.

**Thirty-nine quotations**, one for very nearly every matter. Three matters have
none on purpose — two are covered by another matter's quotation and one was done
at no charge — and the reason is written beside each in the code.

**Eight knowledge base articles.** Two of them are shared, so the client link
has something to open.

**Varied histories.** Sixty-nine employment rows, thirty-two qualifications,
thirty-eight trips, across every client who holds a matter.

### What was got wrong, and the rule that came out of it

**An invoice could be marked as a rehearsal and then never deleted.** The
register has let an administrator mark an invoice as test data since 11
September, and the purge has had `invoices` at the head of its delete list since
the same day. But the database has refused to delete any invoice since it was
built, on purpose — an invoice is a tax document, you void it, you do not delete
it. Nobody had found this, because until today nothing ever wrote a test
invoice. The first reset with one in it would have failed outright.

The knowledge base had the other half of the same problem: an article could not
be marked at all, so the ten-day reset would have laid down a second copy of
every article each time it ran.

**The rule:** *a mark that cannot be unmade is not a mark.* Anything the register
lets you call a rehearsal has to be something the purge can actually take, and
that has to be proved by deleting one — not by reading the trigger and believing
it. Both are fixed in migration 0096, and both halves are now tested by
attacking the database directly: a marked invoice goes, a real one still refuses.

**More codes instead of names.** You caught three this morning. Checking every
field the same way turned up five more lists with the same fault — a warning
kind that was not one, a kind of employment that was not one, two travel
purposes written as labels, and eleven of the visas the caseload said its clients
held.

**The rule:** *check a value against the list it belongs to, not against the file
the lists live in.* The test written yesterday to catch exactly this read the
whole vocabulary file, so a key from the wrong list looked right — which is how
`sv_student` got through. Each field is now checked against its own list, by
name.

**A partnership application with no partner.** The one that mattered most. Not
untidy — impossible. The test now derives which matters are partnership-based
from their type and their title and fails if any of them names nobody, so the
next one somebody adds cannot repeat it. Pinning the rule rather than the case
is the difference between a test that catches this and a test that catches only
the one we already know about.

### What is waiting on you

**The trial register is still empty, and this is still the last step.** It is one
press of the button on Settings → Test data inside the trial register. Nothing
in a deploy will do it, on purpose — that is the same reason the old workflow was
deleted this morning. It takes about ten seconds.

**Nothing else.** The education change that was being written at the same time —
framework levels instead of words, and a date the qualification was awarded —
landed while this was being finished, so the caseload was rebased onto it and
every qualification converted. Twenty-eight of the thirty-two now carry an award
date, and the histories are written at all three date precisions, which is the
easiest way to see that the shorter ones work.
