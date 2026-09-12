# Changelog

Notable changes to the Client Register, newest first. Dates are New Zealand
time. Versions follow [semantic versioning](https://semver.org): the middle
number moves when a feature lands, the last when something is fixed.

The user-facing version of this list, one line per release, is in the app under
**Help → Recent changes**.

## 1.65.1 — 12 September 2026

### Fixed
**Remembering a machine for the maximum 90 days could be refused at random.**

The register worked out when the trust started and when it ended by asking the
clock twice. If the clock ticked over between the two — which it does, sometimes
— the result was ninety days *and three milliseconds*, which is longer than
ninety days, so the database refused it.

At any other number of days nobody would ever have noticed. At the maximum it
was the difference between working and not, and which one you got depended on
the moment you pressed the button.

It now reads the clock once and uses that single moment for both ends.

**Nothing you have done is affected** — this was caught before the feature
reached either register.

## 1.65.0 — 12 September 2026

### Added
**The try-it caseload is a working practice now, not a list of rows.**

*"bring the total of trial cases to 35 and increase the number of clients, add
some more organisation"*, *"partners and children do not appear on the matters
they belong to"*, *"i do not see any invoices in trial data"*, *"add some sample
entries into the knowledge base to showcase it"*, and *"the principal clients
should have varied employment, education and travel histories."*

**Thirty-five matters on twenty files**, up from twenty on eleven. Nine are
simply done, eighteen are real work, eight are unusual — the same mix as before,
scaled up. Approved, lodged, on hold, a PPI, two declines, a reconsideration, an
appeal at the Tribunal, deadlines that have passed and deadlines still to come.

**Thirty-three clients**, up from twenty, including **five companies** — two of
them with their own accreditation and job check matters, three named as the
employer on somebody else's work visa.

**Everybody who belongs on a matter is now on it.** This was the fault: a
partner or a child existed as a client of their own and the matter they belonged
to named only the principal applicant. Worst of all, the partnership residence
application named no partner at all. There are now 28 party links across the
caseload using nine of the twelve roles — partners, children, supporting
partners, sponsors, employer companies and the director who signs for one.

**Seven invoices**, where there were none: two paid, one part paid, one issued
and not yet due, one overdue, one still a draft and one voided with its reason
on it. Every figure is computed from the invoice's own lines, so nothing on the
page disagrees with anything else.

**Thirty-nine quotations**, one for very nearly every matter. Not all accepted —
one declined, one withdrawn and re-quoted, one left to expire and one still a
draft.

**Eight knowledge base articles**, so that page is not empty: a partnership
checklist, a note on PPI letters, what a job check needs from an employer, a
covering-letter template, an office procedure, a draft and a superseded document
list. Two are shared, so the client link has something to open. Every one of
them says on its first line that it is a demonstration and not advice, and none
of it is copied from anywhere.

**Varied histories on every principal client.** Sixty-nine employment rows,
thirty-two qualifications and thirty-eight trips, including deliberate gaps —
periods of unemployment and of caring for family — because the register marks a
period nobody has accounted for and a caseload with no gaps shows that doing
nothing.

Every qualification carries its framework level and, where it has been
conferred, the day it was awarded — both of which arrived in 1.64.0 above with
nothing yet using them. The dates are written at all three precisions on
purpose: a day, a month, and a bare year on the older ones, because a caseload
that wrote every date in full would never show that the shorter forms work.

### Fixed
**A rehearsal can now be taken back out, whatever it is.** An invoice marked as
test data could be marked and never deleted, so the first reset with one in it
would have failed; a knowledge base article could not be marked at all, so a
reset would have laid down a second copy of every article every time. Migration
0096 fixes both. A real invoice still cannot be deleted, only voided, and that
is tested by attacking the database directly.

**More invented keys, found on the way through.** A flag kind that was not a
flag kind (`general`), an employment kind that was not one (`employee`), travel
purposes written as words rather than keys (`Work`, `Family visit`), and eleven
of the visas the caseload said its clients held — `resident`, `aewv`,
`partner_work` and the rest — none of which are keys the *visa a client holds*
list carries. Each of them displayed a raw code, or nothing at all, on the first
pages a prospective customer opens. Each field is now checked against its own
list rather than against the vocabulary file as a whole, which is what let
`sv_student` through this morning.

**Only the demonstration caseload was affected by any of this.** Nothing in your
own register changed.
## 1.64.0 — 12 September 2026

### Added
**An education level is now a number on the NZQCF.** *"education level must
also have a numerical identifier as per NZQCF - do you know how to determine
the level?"*

The honest answer was that for half the old list, you cannot. It read
*Certificate, Diploma, Bachelor's degree…* — and a **Certificate** sits at any
of levels 1 to 6, a **Diploma** at 5, 6 or 7, and secondary school spans 1 to 3.
Only four of the eight named one level. Three qualifications that do name one
were missing altogether: Graduate Certificate and Graduate Diploma (7),
Bachelor Honours and Postgraduate Certificate (8).

That matters because INZ states points and requirements **by level**. A
certificate at level 2 and one at level 6 are different visas, so a field
recording "Certificate" recorded nothing an application could be built on.

The dropdown is now the level itself, 1 to 10, with the qualifications that sit
at each named beside it. The qualification's own name stays in the box next to
it, where it already was. Secondary school and an unassessed overseas
qualification are still there, without a level, because neither has one.

**An award date on an education row.** *"we also need the award date."* A
qualification is conferred on a day that is often months after the last exam,
and it is the conferral an application asks for. It had nowhere to go before.

**A date in a history may now be just a year.** You could already write
`2019-03-15` or `2019-03`. Now `2019` as well — because an old certificate
frequently gives only the year, and writing `2019-01` would be the register
inventing January. This applies to employment and travel dates too, not only
education.

**Nothing you have already entered changes**, and your own register had no
education rows at all, so there was nothing to convert. If you had edited the
education list yourself, yours is kept as it is.

## 1.63.0 — 12 September 2026

### Added
**A machine can be trusted for 40 days, so it stops asking for the six-digit
code every time.**

*"allow for 40 days of authentication memory on a machine, not every time. it is
annoying. so the machine should become trusted and only reset on the 41st day"*

When you enter the code there is now a box, already ticked: **Remember this
machine for 40 days**. Tick it and that machine asks for your password only,
until the fortieth day. On the forty-first it asks for the code again.

**Your password is still asked for every single time.** The box skips the code
and nothing else — it does not keep you signed in, it does not make a session
last longer, and on its own it opens nothing.

**The forty days do not move.** They run from the day you entered the code, not
from the last time you used the machine. Using it every morning does not push
the date out. The database refuses to move the date, so that stays true whatever
anybody writes later.

**My account → Devices** lists every machine you have remembered, when it
expires, and a Forget button. It is forgotten everywhere automatically when:

- you change your password, or an administrator resets it;
- you turn two-factor off, or turn it on again;
- your account is suspended;
- you use a recovery code — that means your phone is gone, so every machine
  trusted on the strength of it stops being trusted, and no new one is granted
  on that sign-in.

And it is checked again, from the register, every time it is used: the machine
is still remembered, the day has not passed, the account is still active, and
two-factor is still on and still the same authenticator. A cookie sitting on a
laptop for forty days is a credential, and a credential is checked where it is
spent.

**Settings → Security** now has *Days a machine stays trusted*. It starts at 40,
can be set to 0 to ask for the code every time, and cannot be set above 90.

**Do not tick the box on a shared or public computer.** It is said next to the
box as well.

**Nothing to do.** Nothing changed for anybody who does not tick it.

## 1.62.1 — 12 September 2026

### Fixed
**A high-priority matter is now tinted on the list, like an urgent one.**

*"high status should have yellowish background as a general rule, urgent ones -
reddish as they do."*

Urgent matters have always had a red row. High ones carried an amber badge but
sat on a plain row, so the badge called them out and the row did not. Both marks
now come from the same place, so they cannot disagree again.

**Three matters in the try-it caseload showed a code instead of a name.** One
said `awaiting_information`, one said `open` — neither is a real status — and
one showed `sv_student` in the Type column, which is a visa a client *holds*
rather than a kind of work. They are now a PPI, a matter being prepared, and a
student visa application.

Only the demonstration caseload was affected. Nothing in your own register
showed a code, because its matters are real ones you entered.

The test written the day before to catch exactly this had passed, twice over: it
*required* one of the invented statuses, and its check on types read the whole
vocabulary file rather than the list of matter types, so a key from the wrong
list looked right. Both now check against the register's own lists.
## 1.62.0 — 12 September 2026

### Removed
**Nothing can put invented clients into your register any more.**

*"yes, remove it, no need for the test data to be loaded into the live
register."*

Two things went, and they were the last of one story.

**The "Demonstration data" button in the build pipeline.** Built in August,
before the register held anything real. Anybody with access to the repository
could press it and write twenty invented clients straight into your live
database. It has been replaced for weeks by Settings → Test data, which lives
inside the register, marks every row it creates, and can take them out again.

**The "Remove all demonstration data" card on Settings → Maintenance.** That
card existed to clean up after the button. It only appeared when such rows were
present, and there are none — your register holds 245 clients and 199 matters,
every one of them real, and the trial holds none at all. So it could never
appear on either register, and a card nobody can ever see is a thing to delete
rather than carry.

**Nothing to do, and nothing was deleted from your register.** Your own way of
loading a caseload to practise on — Settings → Test data — is untouched and is
now the only one.

## 1.61.0 — 12 September 2026

### Fixed
**The client's acceptance link is shown only to somebody who may send a
quotation.**

When you email a quotation, the client gets a link. That link is the whole of
what proves they may accept — it has to be, because they have no account with
you and nothing else to sign in with. Anyone holding the address can accept the
quotation in their name.

Until today that address was printed in full on the quotation page, which
everybody who may read a quotation can open — including somebody on "Read only",
whose whole point is that they change nothing. So a person who is not allowed to
send you a quotation could copy the link off the screen and form the contract in
your client's name, with an acceptance the register says cannot be undone.

Nothing was broken about the permissions. The page is one those people are meant
to be able to read. What was wrong was printing the key on it.

Now: the address itself is shown to whoever may send a quotation — the owner, an
administrator and a specialist. Everybody else still sees **that** the client has
their link and **when** it went out, which is what that part of the page is read
for.

**The same for a knowledge-base article shared with a client.** The share address
is shown to whoever may create one. Read only is told the article is shared and
when, without the address. Nothing can be accepted or agreed through one of
those, so this is about keeping your material where you put it, not about a
contract.

**Nothing to do, and no link changed.** Every link that has gone out still works
exactly as before. This is only about who can read one off a screen.

## 1.60.1 — 12 September 2026

### Fixed
**Only the people who work the inbox can make an upload token.**

An upload token is the credential an Apple shortcut carries when it sends a
file into the register. Until today anyone who could sign in could make one —
including someone on "Read only", whose whole point is that they change
nothing. A token is a way of putting files into the practice's inbox, so that
was a way of writing to the register that their role should not have had.

Making one now needs the same permission as working the inbox: owner,
administrator, specialist and assistant. Read only sees the page and is told
why the button is not there.

**And a token already made now stops working if its holder moves to "Read
only".** The first version of this fix only guarded the button. That was not
enough: a token lives on a laptop and does not disappear when somebody's role
changes, and because a token can only be cancelled by the person who made it,
the practice had no way to take it back short of suspending their whole account.
The check is now made when the token is *used*, so a change of role stops it at
the next file sent, with nothing to remember to do.

**Revoking a token is unchanged and deliberately not restricted.** The screen
where somebody cancels their own token keeps working whatever their role.

**What you need to do: nothing, unless somebody in the practice is on "Read
only" and has an upload token.** Their shortcut will stop working — which is
the point. Everyone else's tokens are untouched and none were cancelled.

### Added
**A test that checks every route against every role.** The register has 233
routes and five roles, and until now three tests checked that a route refused
the wrong person. A route added without its permission check was invisible
until somebody with the wrong role opened it. The new test reads the routes out
of the running application, insists every one of them names the permission it
needs, and then signs in as each of the five roles in turn and proves that every
combination which should be refused really is.

## 1.60.0 — 12 September 2026

### Added
**See your quote and your letter of engagement before you send one.** *"in the
settings quotes and Letter of engagement - there should be a button to preview
these two documents or how they appear?"*

The wording of both is edited as boxes of text under Settings. A box of text is
not a document, and until now the only way to see what a change actually looked
like was to go and find a real quotation.

There is now a **Preview** button on each of those two settings pages. It draws
the real document, with your wording as it stands, on your **most recently sent
quotation** — so nothing on it is invented. If you have not sent one yet it uses
the newest quotation on the register and says so; if there are no quotations at
all it says that in words, rather than showing an error.

The preview writes nothing. No record of a document being printed, no change to
the quotation, no client link. It is reading, not sending.

**It is a real client's quotation**, so their name is on it. A band at the top
of the page says so — and that band prints, so a printout can never be mistaken
for the document itself. Only somebody who can already open Settings can open a
preview.

## 1.59.0 — 12 September 2026

### Changed
**Quotations expiring are off the calendar.** *"we do not need quote expiry date
in calendar, can be removed. if client does not acept - fine - they can get back
to us and we will review there and then."*

Every other date on the calendar is one you have to act on — a decision due, a
visa expiring, an invoice due, a deadline that closes. A quotation lapsing needs
nothing done. A calendar carrying dates nobody acts on teaches you to ignore it,
and then it fails on the date that mattered.

Nothing else changes. The quotation still stands for its period, still expires
overnight, and still shows its date on the quotation itself and in the quotes
list.

### Added
**A watcher on the register, through every deployment.** You have seen the
register refuse to load for under a minute and then come right. I offered an
explanation, fixed it, and it happened again — so the explanation was wrong.

Rather than guess a third time, every deployment now watches the register for
two minutes and writes down every answer it gets, including the reference number
Cloudflare's own records can be searched by. If it happens during a deployment,
it will be caught in the act.

It does not affect the register and cannot hold up a deploy. It only watches.

## 1.58.0 — 12 September 2026

### Changed
**The practice caseload you can load to try the register is rebuilt.** *"give it
20 cases, varied, with people from different countries, make 5 simple ones and
10 complicated and 5 unusual applications."*

Twenty matters now, in that mix:

- **Five that are simply done** — a further student visa, a passport transfer, a
  dependent child, a visitor visa, a post study work visa.
- **Ten that are work** — an AEWV renewal with the partner filed alongside,
  residence from work for a couple, an accreditation renewal, a job check held
  up waiting on the employer, a residence application stuck on a medical waiver,
  and a partnership residence that was **declined** with the appeal clock
  running.
- **Five that are unusual** — a section 61 request after an overstay, a visitor
  visa declined on bona fides and the reconsideration of it, a ministerial
  intervention with no appeal rights left, and a response to a deportation
  liability notice with a fourteen day deadline.

Sixteen people, fourteen nationalities, and the twenty matters sit on **eleven
files rather than twenty** — eight of those files carry more than one matter and
one carries three. A file with a single matter on it shows none of what the
register is actually for.

### Fixed
**Six kinds of matter were showing a code instead of a name.** The old caseload
used case types that are not in your own list — so those matters read
`advice_general` or `rv_skilled` on screen, where every other matter reads
"OT. Advice Only" or "RV. SMC". Every type in the new caseload is one your list
carries, and the tests now read your list and refuse anything that is not on it.

It only ever affected the caseload you load to try the register. No real matter
was affected.

## 1.57.0 — 12 September 2026

### Added
**The register backs itself up every night.** *"lets build auto back up on the
main."*

Until today the only backup was the button you had to remember to press. A
backup that depends on somebody remembering is a backup that exists until the
week they are busy — which is the week they need it.

From tonight it happens on its own, at 7pm, as part of the run that already
expires quotes and sets your reminders. It writes a copy of the whole register
into storage, **reads it back to check it is really there**, and keeps the last
30. The newest is never deleted, whatever the setting says.

**Go to Settings → Exports and backups to see whether it is working.** It shows
a date, not a tick. No backup for two nights and there is a red band. That is
the page to look at if you ever wonder.

**What it protects you from:** rows deleted by mistake, a bad change, the
database itself lost. That is the likely bad day.

**What it does not:** losing the Cloudflare account, because the copy is kept
inside it. For that, press the button on the same page now and then and keep
that file somewhere else — that one is the whole register including the
documents.

The nightly one leaves the documents out on purpose. They already sit in the
same storage the backup is written to, so copying them there again protects
nothing — and an archive that grows with every document uploaded is one that
works every night until the night it quietly stops.

**Two settings**, under Settings → Nightly backup: whether it runs, and how many
to keep.

### Note
**The trial register has no automatic backup yet**, and its Exports page says
so in those words. It has no file storage, and that is what a backup is written
to. Creating it is the step that turns its backups on.

## 1.56.0 — 12 September 2026

### Added
**Read a document into a client's file.** *"Read a document into this matter
section in cases must also be available for clients as well - as we have a lot
of info to add to clients. probably more than we have for cases."*

The same card that was on a matter is now on the client too, above Files. Drop a
document in, tick one already on their file, or point it at Google Drive — then
the same review screen, the same list of what it would fill, and the same press
before anything is written.

You were right that a client holds more: name, title, gender, place of birth,
national identity, passport, visa, INZ number, nationalities. All of those can
now be filled from a document without opening a matter first.

**Nothing is lost where there is no matter.** If the document also mentions an
application number or a lodgement date, there is no box for it on a client — so
it goes into the file note, saying what it was and that it belongs on a matter.
It is never simply dropped.

**A client can only be pointed at their own documents.** Not another client's,
and not the ones filed to their own matters — a document filed to a matter was
filed there on purpose.

The file note now says which file it was read into, because a file note cannot
be corrected afterwards.

### Changed
This is the same code as the matter's, told which file it is working on, rather
than a second copy. Fault 26 in the specification is this register's own record
of what a second copy costs.

## 1.55.0 — 12 September 2026

### Changed
**Surnames come first.** *"can we make sure that this such places the surnames
are before the names?"*

A matter used to be called **RV. Partner — Bao Long VUONG**. It is now
**RV. Partner — VUONG, Bao Long**. Same for quotations, and for every list of
clients you pick from. Lists now read down the surname, the way a file drawer
does — before this, a list of two hundred was sorted by whatever came first in
the name, which is usually not the surname anybody is looking for.

The visa type stays at the front. That was asked for in September and sorting
by name still groups by kind of work.

The client's own record still reads **Bao Long VUONG**, in the natural order,
because that is the order a letter is addressed in. Two jobs, two orders.

Companies are untouched. There is no surname in a registered name to bring
forward.

Migration 0092 renamed the 189 matters and the quotations already in the
register. A quotation a client has already accepted keeps the name it was
accepted under.

### Added
**Boxes you can type into instead of dropdowns you have to scroll.** *"it is
just impossible to search through this! we need a better system."*

The matter box on a new quotation held seventy lines. The client box holds two
hundred and forty-five. Neither could be searched: pressing a key in a dropdown
looks at the first letter of the line, and every line began with the visa type.

Those boxes now take typing. Type part of a surname, a reference, or a kind of
work, and the list narrows to what matches. Click the arrow and the whole list
is still there.

Where this now applies: new quotation (matter and client), edit quotation, new
matter, edit matter, adding a party to a matter, new invoice, new inquiry, edit
inquiry, and converting an inquiry. The matter box on an invoice was left as a
dropdown — it only ever holds that one client's matters and is short already.

**It refuses rather than guesses.** Type something that fits two matters and it
says so instead of picking one. A quotation attached to the wrong file is not a
mistake worth saving a keystroke for.

No JavaScript is involved, so it still works with scripting switched off.

## 1.54.0 — 12 September 2026

### Added
**A date in a history can be just a month.** *"can we allow filling in only the
Month and year if the date is not available?"*

Write `2019-03` where you only know the month, or `2019-03-15` where you know
the day. Both in the same box. A month shows as **Mar 2019**, so nobody later
reads a day the register was never told.

This is the ordinary case rather than the exception — a person remembers leaving
a job in March 2019, the forms ask MM/YYYY, a reference letter says *"June 2015
to August 2018"*. Until now the guidance was to use the 1st, which is the
register writing down a day nobody said.

**The gaps still read correctly.** A period that started in March began at the
start of it; one that ended in March ran to the end. So leaving a job in March
and starting the next in April is not a gap, and is not drawn as one.

### Fixed
**A wrong date no longer half-saves a history.** The save wrote one row at a
time, so a mistake on the fourth row landed after three had already been
written. Nothing is written now unless every row is right.

## 1.53.1 — 12 September 2026

### Fixed
**Cases, Quotes, Passports and Certificates are open when a client's page
loads.** Closing everything went a step too far. Files, the histories, Military
records and File notes still start closed — those are what you go looking for.

**One line down the middle of Key details.** The card is several lists under
several headings, and each was sizing its own label column, so the values
started at three different places. They start at one now.

**The warning band is brighter.** The red it was using is the one chosen to be
readable as text; as an edge it looked dark. The band has its own now.

**An x-ray takes "Submitted with an application on" too.** It was only offered
where the date *moved* the expiry, which confused what the register records with
what it calculates. The day a document went in with an application is a fact
about any document.

Its expiry does not move, because an x-ray's is the one you typed — and the note
on the file no longer says it did.

## 1.53.0 — 12 September 2026

### Changed
**A client's page is a list of headings, in the order you asked for.** Cases,
Quotes, Passports, Certificates, Files, the histories, Military records, and
File notes at the bottom. Every one starts closed — click a heading to open it.

File notes last because it is the longest block and the one that grows for ever;
anything under it would be unreachable in practice.

The summary down the right — who they are, their dates, their fees — stays open.
That is the part you read to know where things stand, and collapsing it would
open the page on nothing.

A link that points at a block now opens it. *Add a passport* from the client's
own form lands on Passports, open.

**A certificate says the date its rule works out to.** *"'Submitted 12 Aug 2026
· 24 months from issue' should also say the actual calculated end date."*

It now reads **Submitted 12 Aug 2026 · 24 months from issue · expires 29 Jun
2028**, on the one line, with the red and the "in 4 months" on it where the
certificate is the one being watched. The date is no longer adrift in a column
of its own. X-rays get the same line, since they have no rule to sit beside.

### Added
**Education history: whether the course was finished.** Completed, Not
completed, or Still studying. It is most of the point of an education history —
a qualification claimed on an application has to be finished, and a year
abandoned is still a year to account for.

**Travel history: a purpose you pick, and how they travelled.** Purpose is now
Family, Holiday, Business, Work, Study, Transit or Other. Beside it, **By** —
Air, Sea or Land.

All three are lists you can edit yourself under **Settings → Lists and
dropdowns**, like every other dropdown here.

**The right-hand column is one card again: Key details.** Name at the top, then
Contact, Immigration, Passport, Certificates, English, Personal.

The old split was *Identity and compliance* beside *Contact*, and it did not
survive being looked at: the given names and family name sat under Contact,
which they are not. Eighteen undifferentiated rows is a list nobody reads to the
end of.

One change to the order asked for: **Immigration comes third**, before the
passport. A visa expiry is the most-looked-at fact on a client and it was
fourteen rows down.

**An English test now says how long it is accepted for.** Two years from the
test date, worked out rather than typed, with the same colour as every other
expiry once it is close.

**More options for how long a warning stands.** Permanent, 30 days, 3 months, 6
months, a year, 18 months, 2 years, 3 years, or a date you choose.

*Permanent* replaces *Until it is taken down* — the same thing, in words you
would actually pick for a character concern that must be in front of whoever
handles the next application. Warnings already raised are unaffected.

**Border alert** is now one of the warning kinds. On this register the list is
already yours, so add it under **Settings → Lists and dropdowns → Warning
kinds** with the line `border | Border alert`.

**The warning band is loud now.** Bright red edges fading into the amber
centre, so the eye catches it before anything else on the page. It was the same
weight as a card heading.

### Fixed
**Countries are named, not abbreviated.** A Tongan passport and a Tongan police
certificate were both headed **TO**. They say **Tonga**. So does the alerts
page, which was showing *Passport (TO)*.

## 1.52.1 — 12 September 2026

### Fixed
**Saving a client no longer loses what you typed.** Reported the same day,
filling in a client's details: *"this is what appeared when i pressed save -
annoying."*

The database refused the save, and it was right to: the visa expiry on file was
before the visa start date being typed, and a visa cannot expire before it was
granted. What was wrong was everything after — an error page, a reference
number, and a form's worth of typing gone.

Now the two dates are checked before the save. You get **A visa cannot expire
before it was granted** against the expiry box, with everything else you typed
still in front of you, and the one date to change beside the message.

**And a net under the whole form.** Any other rule the database enforces now
comes back as a plain sentence on the form rather than an error page. The rules
still live in the database, which is the point of them — this is so that the
next rule added there costs somebody a sentence rather than an afternoon.

A real fault is still a real fault: it still gets the error page and the
reference number, because that is what a reference number is for.

## 1.52.0 — 12 September 2026

### Changed
**Help is in parts now.** Asked for in the middle of taking explanatory text off
the screens: *"re Less on the screen - i believe it is good time to thoroughly
review and update the help section."*

What was wrong with it was not the writing. All twenty-eight sections and
**every release ever made** were on one page — about eleven thousand words of
guidance and twenty-two thousand of release notes, on the page you open when you
are already stuck.

Now: six tabs, grouped by when you would be asking rather than by which part of
the register the answer lives in — **Day to day**, **Dates and documents**,
**Money**, **Work coming in**, **Running the practice**, **Settings and setup**,
and **What changed**. Inside a tab each section is a heading you open. A tab is
a short list of questions instead of a wall.

The biggest tab is now about three thousand words, and closed until you open
something. It was thirty-four thousand.

**Recent changes shows the last twenty**, and says how many there have been in
all. It was showing all 200.

### Added
The guidance now covers everything that shipped today, none of which it
mentioned: correcting a certificate and the note it writes, the submitted box
that goes away, how a certificate's expiry works itself out, visa conditions and
stay limits, the three histories and how a gap is drawn, the military records
placeholder, the five blocks on a matter that start closed, recording an INZ
extension without a status change, the practice caseload and why there is no
trial-only login, the new editable lists, and a calendar decision saying which
way it went.

## 1.51.2 — 12 September 2026

### Fixed
**A decision on the calendar says which way it went.** It now reads
**Approved — …** or **Declined — …** rather than *Decided — …*.

*"On its own 'Decided' is useless. It should be either approved or declined or
something else."*

The word comes from the matter's status, not from the outcome box. The outcome
box holds a record of the grant — *"Approved. AEWV granted 17 August 2026;
multiple entry; must arrive before 17 January 2027 …"* — and a calendar row
carrying a paragraph would be a worse version of the same complaint.

Where a matter was decided and later closed, the status no longer says which way
it went; the first few words of the outcome are used if they are short enough to
be a label.

**Lodged and Decided are back on the calendar.** 1.51.1 took them off it. That
was a misreading of the complaint — the objection was to the word, not to the
rows — and it lasted about twenty minutes.

## 1.51.1 — 12 September 2026

### Fixed
**The calendar opens on what is coming.** Reported the same day: *"why do i see
in calendar a useless status 'Decided'??? how does that help?"*

It did not help. **Lodged** and **Decided** are the only two kinds on the
calendar that are in the past by nature — a decision cannot be entered before it
arrives. So they filled the month in front of you and could never appear in the
month ahead.

Both are now off unless you tick them on. Everything still ahead — decisions
due, tasks, expiries, quotes, invoices, warnings — is unchanged.

They are still there to tick, because there is one real use: looking back at a
month to see what went in and what came back. That is something to go and ask
for, not something to have in the way meanwhile.

Nothing is remembered between visits. The calendar opens the same way every
time, rather than however you last left it.

## 1.51.0 — 12 September 2026

### Added
**A practice's worth of invented files, to learn on.** Settings → Test data now
has **Load the caseload**. It lays down twelve invented clients with families,
matters, quotations, passports, certificates and histories — about thirty
matters in all, none of it real.

It is deliberately not tidy. Between them those files carry a declined
application, a section 61 request, an expired police certificate beside a
current one, a passport renewed in the middle of an application, a visa with no
fixed expiry date, a gap in an employment history, a quotation accepted and one
declined, and a matter waiting on an RFI. A caseload where everything goes right
teaches nobody anything, because the awkward files are what the register is for.

Every row is marked as test data on the way in, so it is in the list on that
same screen and goes with one press.

**Put it back as it was.** The same screen. It deletes everything marked as test
data and lays the caseload down again, so whatever somebody added while trying
things is disregarded.

**It can put itself back on a timer.** Settings → Practice caseload → *Put the
caseload back every … days*. **This is zero — never — unless you set it**, and
on this register it should stay at zero: the records marked as test data here
are the ones you marked by hand to rehearse quotations with, and a timer would
delete those one night without asking.

### Note
**A login that can only see the test data is not built, and should not be.** The
reason is in `docs/operations.md`. In short: the only way to hold a trial user
inside the test data in *this* register is to add "and only the test data" to
every one of the register's queries, and the one that gets missed shows a real
client file. A person trying the register gets their own copy of it instead —
which is the same answer the practice already chose for a second practice.

## 1.50.0 — 12 September 2026

### Added
**Employment, education and travel history, on a client.** Three new blocks
under Certificates, each closed until you open it. None of them is compulsory
and most clients will have none.

Each is a table you edit all at once, the same way quotation lines work: type a
number in the **#** box to move a row, tick the red cross to take one out, press
**Save the table**. Nothing happens until you save, so a slip can be untitled.

**A period of unemployment is a row like any other.** Choose what the period
was — employed, self-employed, unemployed, studying, caring for family — and
leave the employer blank. That list is yours to edit under Settings → Lists and
dropdowns, along with the education levels.

**A gap in an employment history is drawn, not complained about.** Where two
periods do not meet, the space between them shows as a shaded line saying how
many months. It is never refused and never alerts: a gap is a question to
answer, and often the true answer.

**Military records** is a block and nothing behind it yet, which is what was
asked for. What a military record should hold is the part nobody has decided,
and guessing now would mean rebuilding.

## 1.49.0 — 12 September 2026

### Changed
**Less writing on the screen, everywhere.** Asked for on 11 September: *"too
much of explanatory text — must be deleted, and not just here, but everywhere.
It can get too busy on the screen … the app should look like an app and not an
annotated form."*

About seventy paragraphs of explanation are gone or cut to a line, across
clients, matters, quotations, invoices, the inbox, the assistant, tasks, the
calendar, the knowledge base and Settings. Field names and the small notes under
a box are untouched — those tell you what to type. What went was the writing
that explained why the register works the way it does. The reasoning is all
still written down, in the code, where it was always meant to live.

Two paragraphs that show on every file note and every warning went with it.
Those were the most-repeated writing in the register.

### Added
**Certificates can be corrected.** A police certificate, medical or x-ray now
has an **Edit** button. Change the issue date, the country, the reference, the
note — anything but which kind of certificate it is.

Every change is written to the client's file as a note saying what moved, and to
the audit log. That is what makes it safe on a certificate an application has
already relied on: nothing is quietly different, and nothing has to be deleted
and retyped.

The expiry still looks after itself. Move the issue date and the deadline moves
with it.

**The "Submitted with an application on" box goes away once it has been used.**
Asked for the same day. It did its job; changing the date afterwards is a
correction, and corrections go through Edit, where they are written down.

**A date is printed once.** The expiry appeared twice on every certificate and
every passport — in the small line underneath and again in the column at the
right. The column keeps it, because that is where it carries its colour and its
"in 4 months".

## 1.48.0 — 12 September 2026

### Added
**Visa conditions and stay limits, on a client.** Two new boxes on the
Immigration tab. Conditions is what the grant allows and forbids, in INZ's own
words. Stay limit is the line you would otherwise write in a note — *"4 months
per entry, 6 months in any 12"*.

Neither is counted from and neither raises an alert, on purpose. A stay limit
only becomes a date when the person crosses a border, and the register has no
way of knowing when they did. A date the register guessed would be worse than no
date, because a date is what the alerts read. The visa's own expiry is still the
only date watched on a visa.

Both are plain words, which is what lets a reading of an approval letter fill
them in.

### Changed
**Five sections on a matter now start closed.** Read a document into this
matter, Brief me on this matter, Files, File notes and Tasks. Those are the
things you *do*; click the heading and they open. Everything you *read* — status,
parties, key details, the next action — is still open when the page loads.

**Your name is on your own account page.** It showed the email address and the
role and left out the name.

## 1.47.1 — 12 September 2026

### Fixed
**Test data opened, instead of showing an error.** Clicking **Test data** under
Settings gave *Something went wrong*, every time, since the page was added in
1.40.0.

The page lists every record you have marked as a test, across six kinds —
clients, matters, quotations, inquiries, invoices and tasks. To name each one it
has to read a different column from each table, and it asked the matters table
for a column that lives under another name there. The database refuses the whole
question before it looks at a single row, so the page failed even with no matter
marked at all.

The six columns are now written out one table at a time, and a test marks a row
in each of the six and reads the list back — so the same fault cannot return
quietly for one table.

## 1.47.0 — 12 September 2026

### Added
**File note kinds are now a list you can edit.** Asked the same day as the case
statuses, and this one is yes: *"same for this one? cannot use dropdown?"*

**Settings → Lists and dropdowns → File note kinds.** Rename Consult, add
Site visit, drop Message if you never use it. No deployment.

The two lists are different things, which is why the answers differ. A case
status decides what the register *does* — which matters count as open, which
carry a deadline, which raise an alert. A note kind is what you call your own
work, and it decides nothing.

**Three kinds stay out of your hands** — system notes, and email in and out.
Those are what the register writes about itself, not words you choose. They
cannot be added to the list, so a note claiming an email was sent cannot be
written by hand.

**Removing a kind does not rewrite old notes.** A note filed as a Consult stays
a Consult — file notes can never be changed. What it loses is its label, and
the register shows the stored word rather than pretending the note has no kind.

The groundwork for this was laid a while back and never finished: migration
0064 removed the database's own check on note kinds precisely because *"that
list is configuration"*. Until now the list still lived in the code — two
places describing one idea, which is the fault that migration was written
about. There is one place now.

## 1.46.0 — 12 September 2026

### Added
**A response or decision date can now be changed on its own.** Reported: *"i
just received an extension from INZ of time to file an australian PC for a
client... and I need to record that - Due Date Extended - and enter the new
date - but I cannot."*

The date was locked behind the status. "Move to" was required, so the only way
to record an extension was to pretend the matter had moved somewhere it had
not.

Now the status box says **Leave as it is**. Change the date, add a note saying
who granted the extension and why, and press Save. The status stays where it
is, the change is written on the file, and any INZ follow-ups move with the new
date.

### Why the status list is not editable, unlike the other dropdowns
The practice asked, and guessed right. A status is not a label. Fifteen of them
drive behaviour: which matters count as open, which carry a deadline that must
not be missed, which are with INZ and so raise the no-acknowledgement alert,
and which record a decision date of their own accord. A status added from a
settings page would belong to none of those lists and would be invisible to
every alert — worse than not having it.

Almost every other dropdown in the register *is* editable, and where one is
not, it is for this reason.

## 1.45.0 — 11 September 2026

### Added
**Two ways to get a client's documents into a matter without typing anything.**

**1. Send a file straight from your Mac or your phone.** Set up under **My
account → Sending files in**. You build a small button once in Apple's own
Shortcuts app; after that, select files in Finder, right-click, and send them.
Same from the share sheet on a phone. They land in **Incoming**, exactly where
emails land, and you file them to a matter as usual.

This works from *any* folder — iCloud, Proton Drive, Google Drive, a memory
stick — because you are pushing the file out rather than the register reaching
in. Apple offers no way for a website to read iCloud, and this is the way
around that.

The button carries a **token**, because a shortcut cannot sign in. It is shown
once, stored scrambled, and you can revoke it. If it ever leaked, the holder
could **only drop a file into your inbox** — no client records, no quotations,
no reading anything. Step-by-step instructions are in the register and in
`docs/apple-shortcut.md`.

**2. Read documents straight out of Google Drive.** On a matter, paste a Drive
folder or file address. The register lists what is there and you tick what to
read. It reads them, proposes the details, and you approve as before.

**The file is not kept.** What stays is the details you approved, a file note
naming what was read and when, and a link back to the Drive copy. That was the
practice's own design: *"could they be fetched, read, case created and they are
then discarded from the system to only remain in the gdrive?"* Storage stays
near nothing.

**A "keep a copy" tick, per file, off by default** — for a signed letter of
engagement or an INZ decision, where the file disappearing from Drive would
matter.

Google Docs, Sheets and Slides are exported before reading; a Sheet gives its
first tab and says so. A link that stops working is a real risk and the page
says so: the file note is the part that lasts.

Setting Drive up is a one-time job in your Google account — the steps are in
`docs/integrations.md`. Until then the feature simply does not appear.

## 1.44.1 — 11 September 2026

### Fixed
**An empty amount box on a payment schedule quietly put the old amount back.**
Reported: *"i am trying to adjust the bottom to make it match but it does not
let me."* A schedule stood at $11,382.70 against a quotation of $3,959.40 — the
fee lines had been lowered underneath it — and every attempt to bring it down
was refused.

Clearing a stage's amount box did not set it to nothing. The register could not
read an empty box, so it wrote that stage back exactly as it was, and the old
figure still counted. The practice was told the schedule came to more than the
quotation, with no hint that the boxes they had emptied had been refilled behind
them. The message that would have said so came after the total check and never
ran.

Now an empty box refuses the save, names the stage, and says what to type: **an
empty box is not nil — type 0 to set a stage to nothing.** It is checked before
the total, because a total containing a figure nobody typed is not worth
arguing about.

The fee lines have always named the lines they could not read, so the same trap
was visible there. Their message now says the same thing about typing 0.

## 1.44.0 — 11 September 2026

### Added
**A document that arrived by email can be read into the matter where it sits.**
Until now the reading only took an upload, so a passport a client emailed had to
be downloaded and put back before it could be read. That was the one missing
step in what the practice described: *"we need to make it easier for the client
- so they email us docs and we extract the data with AI systems."*

The reading screen now lists the documents already on the matter and on the
client's file. Tick as many as you like and read them together. Nothing is
copied or re-attached — they are read where they sit.

The review screen says **which document each proposed value came from**, and the
file note names what was read. Where several documents are read at once and you
need to be certain which said what, read them one at a time; the screen says so.

A document the reading cannot open — a spreadsheet, a link to a file in a drive,
anything over 8 MB — is listed with the reason rather than silently ignored. A
reading that found nothing says so instead of showing an empty screen.

**Only this client's own documents are ever offered**, and posting another
client's document id reads nothing.

## 1.43.0 — 11 September 2026

### Fixed
**A quotation could only ever go to one person.** The compose box has invited
several addresses since 8 September — *"Several addresses, comma or semicolon
separated"* — and nothing below it knew. A second address was refused outright
as "invalid recipient address", and the one provider that did accept it was
handed `a@b.com, c@d.com` as a single address. It has never worked. Found while
building the recipient list, which would have made adding a second address easy
and walked straight into it.

Every address in a field is now checked and sent on its own. One bad address
still refuses the whole message rather than quietly dropping it: a message you
believe went to three people and went to two is worse than one that did not
send.

### Added
**The compose box knows who you write to.** *"is this not a case that 99% of
emails from the system are to be sent to those who are already in the register?
... should we not be able to find the email that is already in the system and
the name of the person holding it?"*

Yes — and the register's own data settled it. Every genuine recipient it has
ever sent to is already a client record, agencies included. So there is **no
new address book**: the To and Copy-to boxes now offer the people already in
the register, as *Name — address*, with this quotation's own client and the
people on it first, then the matter's parties, then everyone else. You can
still type an address that is not there.

**And when you send to an address on no client record, the preview says so** —
naming it, with a link to find who holds it or add them — rather than
remembering it somewhere else. The name then lives in one place and stays
right.

**The flat facts an application form asks for** (migration 0084), the ones the
pipeline note said needed no decision beyond doing them: **title**, **gender**,
**relationship status**, **other names ever used**, **place of birth** (country,
region and town) and **national identity number with the country that issued
it**. All on the individual half of the client form; a company has none of them.

Gender, title and relationship status are **lists you can edit** under Settings,
not fixed choices in the program. The database refuses a national identity
number without the country that issued it, and refuses either country field
unless it names a real country.

The document reading fills them too, and reports a value that is not on your
list as a gap in the file note rather than writing it raw.

*Not built, deliberately: the histories — countries lived in, employment,
education, travel — and the character and health declarations. Those need
decisions that have not been made, and the pipeline note says why.*

## 1.42.0 — 11 September 2026

### Added
**Read a document into a matter that already exists.** Asked on 11 September:
*"do we have any ways of supplementing the case data / filling in the existing
field in a case automatically after case creation? - give AI data, point to a
case and ask it to populate all possible fields, and those that are not
available - save the data as a file note?"*

Half of it existed. **Open a matter from what you already have** reads a
document and fills the form — but only when a matter is being created. Now the
same reading can be pointed at a matter already on the file: drop the documents
in, and you get a screen listing every box it could fill.

**Nothing is written until you press the button**, and **nothing that already
has a value is ever overwritten**. Boxes that are already filled are shown, so
you can see what the document said, but they are not offered — what is there
wins, always. You tick what you want.

**What it could not place goes into a file note**, which was the best part of
the request. An occupation, a visa type that is not in your list, other people
named in the document, values that disagree with what the record already holds
— all of it is written to the matter as a note, attributed to the reading and
worded as a record of what the document said rather than as something the
register is asserting. Nothing found is lost merely because there was nowhere
to put it.

It fills six boxes on the matter and nine on the client. Deliberately not:
anything the database works out for itself — the certificate dates especially,
which the database has owned since the forty-five-clients fault — anything the
decision screen owns, the fees, and the status. Each exclusion is written down
with its reason.

If the document turns out to be about somebody other than this matter's client,
it says so and writes nothing to the client at all.

## 1.41.0 — 11 September 2026

### Added
**Every email the register has sent can now be read back.** Asked on 11
September: *"files notes in quotations? why do we not have the entire email
that was sent out in the file note, recorded as an email?"*

It was always there. The register stores each outgoing email in full —
recipients, copies, reply-to, subject, the formatted body, the plain-text body,
attachments, when it went and what the provider said. What was missing was any
way to look at it: the file note gave the address and the subject and stopped.

Now the file note is a link. Open it and you see the letter exactly as the
client received it, formatted, with the plain-text copy one click away. The
quote page also carries an **Emails sent** list.

**This reaches backwards.** Nothing was rewritten to make it work — file notes
are append-only and stay that way. The link is worked out when the page is
drawn, by matching the note to the stored email, so a quotation emailed weeks
ago is readable now. Where two letters answer one note, the link goes to the
record's list rather than guessing which.

Reading a sent email needs the same permission as sending one. A sent email can
carry a client's whole matter and, in a copy line, somebody else's address —
more than a read-only account exists to see. Someone without it sees the file
note as before, with no link, rather than a link that refuses them.

### Changed
**The quotation email goes out formatted unless you say otherwise.** *"make the
formatted version of my email as a default when i want to email quotation and
LoE, can switch to plain text whenever needed."* The plain text is still sent
alongside it, so a client whose mail reader will not show formatting still gets
a readable letter. The choice now also survives **Back to edit**, which used to
reset it.

**The quotation is about a tenth shorter on the page.** *"make the lines
slightly more compact otherwise, except for where the headings sit - so the
whole takes less space on the screen vertically."* Row padding, paragraph
spacing and line heights are all trimmed a little between the headings; the
extra room above the headings, added earlier the same day, is untouched. About
90px on screen and 12mm on paper for a typical quotation. Nothing changed size,
weight or colour — vertical spacing only.

**The accept button and its tick boxes are one green.** *"accept this quotation
button should be the same green as the one saying Go to accept"* and *"the tick
colours should be the same green."* They differed because of where each sat:
the sticky bar took the practice's own theme colour, while the button sits
inside the document, which sets its own palette. Both are now pinned to one
fixed green — which also means a client's copy of a contract does not change
colour when the practice changes their theme. It is the green of the ACCEPTED
stamp the document wears afterwards.

## 1.40.0 — 11 September 2026

### Added
**Test data can be marked, and deleted in one go.** Asked for on 11 September:
*"i, the admins and owners, must be able to use a 'test' tick or mark to mark
any data as test data - so it can be deleted later on without any further
questions."*

The register has held the practice's real client files since 30 August. There
is nowhere else to try things, so things get tried here, and until now nothing
told a rehearsal apart from a real file.

Open any client, matter, quotation, inquiry, invoice or task and there is now
**Mark as test data**. A marked record wears an amber band saying so, and shows
a **Test** badge in the lists. **Admin → Test data** lists everything marked,
by name, and deletes the lot on one confirmation.

**Only an administrator or owner can mark or delete** — nobody else sees the
control.

**The mark travels down a file and never up.** Marking a client marks their
matters, quotations, inquiries and invoices, and anything filed under them
afterwards is born marked. Marking one quotation says nothing about the client
it belongs to, which is what makes it usable on a real client's file.

**A quotation cannot be unmarked**, and this is deliberate. The mark is what
releases a quotation from the freeze that makes an accepted one a contract. If
it could be lifted again, somebody could mark a signed quotation as a test,
un-accept it, change the fee, accept it again and remove the mark — which is
the exact thing that freeze exists to prevent. So marking a quotation destroys
it as a contract, permanently and visibly. Everything else unmarks freely.

**A test quotation can be sent and accepted as many times as you like.** The
original request: *"can you mark them so that I can reinstate them to
unaccepted state to test? so i can send them and accept them many times."* An
accepted test quotation now offers **Unaccept and start again**.

**What the delete cannot take:** the audit log, which is append-only in the
database and remains the register's account of what people did — afterwards it
still records that these records existed. And emails already sent: a quotation
emailed to a real address was really emailed. File notes are the one narrow
exemption, and go only with the test record they are filed against.

### Changed
**Accepting a quotation is now a more deliberate act.** *"the date must be
fixed - it cannot be selectable... need another line 'The above name is
correct' and a tick box - so it is more deliberate action of accepting. and if
not ticked - will not accept."*

- **The date is no longer a box the client can change.** It was an editable
  date field defaulting to today, so a client could put any date they liked on
  a contract. It now shows the moment of acceptance as the register sees it,
  with the time and the time zone, and that is what is recorded. A date posted
  in the form body is ignored.
- **Two ticks, not one.** "The above name is correct." sits above "I have read
  the quotation and the letter of engagement, and I accept them." Both must be
  ticked, and this is checked on the server — an unticked box comes back as a
  plain sentence asking for it, not an error.

**A money column heading now sits over its own figures.** *"the column heading
shifted."* The figures were right-aligned and the headings were not, so Qty,
Unit, GST and Amount each drifted left of their column — further, the wider the
window.

**The quotation totals lost three rows.** *"are these lines superfluous? the
body of the quotation already says what is what - why do we duplicate it?
clients can calculate subtotals themselves - lets save some space."* They were.
Every line already says whether it is a professional fee or a disbursement, so
the two subtotals restated the column beside them, and Subtotal restated Total
payable minus the GST directly under it. **GST** and **Total payable** remain,
on the quotation page and on the printed document alike.

## 1.39.1 — 11 September 2026

### Fixed
**A plain-text fee quote was reaching the client with `**` in it.** Spotted on
the new preview screen: *"what are the ** characters in the body?"*

They are the bold marks from the practice's own letter of 9 September. Sent as
a formatted email they become bold, which is what they were for. Sent as plain
text — which is the register's default — the letter was going out as written,
so the client read `**fee quotation and Letter of Engagement**`, asterisks and
all.

The letter is now written once and rendered twice: formatted, the marks become
bold; plain, they come off. Bullets and web addresses are left exactly as
typed, because that is already how a list and a link are written in a
plain-text letter. What is stored is still what a person wrote, so the compose
box and the audit log are unchanged.

**The preview shows the plain-text letter with the marks off**, because a
preview that does not match what is sent is not a preview.

**The list of brace-words beside the compose box stopped cutting mid-date.** It
was ending "open for acceptance until **16 September 20", which reads as a
wrong date rather than a shortened one. It now cuts at a word and says so with
an ellipsis.

### Added
**The email signature is now yours.** *"where did you take this signature
from?"* From three settings glued together with newlines — the practice name,
the email and the phone. That is a placeholder, not a signature: a sign-off is
a name, a title, a mobile and usually a confidentiality notice, and none of
that can be worked out from what the register happens to know.

**Settings → Practice → Email signature** now holds it. Paste it in as plain
text, exactly as a client should read it; blank lines are kept. Left empty, the
register signs off with the practice name, email and phone as before, so
nothing changes until it is set.

Anything the letter already says is better left out of the signature than said
twice — the link to the terms of engagement, for instance, is already a
paragraph of the letter.

## 1.39.0 — 11 September 2026

### Added
**Nothing typed is lost to a closed tab.** Asked for on 10 September: *"i also
want to add automatic saving of details entered - say every 1.5 minute after
the change - possible?"* — and narrowed the same day to the two answers that do
not write to the register on their own: *"build both, 1 and 2, do not build
3."*

**A draft, kept in the browser.** Ninety seconds after a change, and again
whenever the tab is hidden or the page is about to go away, whatever has been
typed is written to that browser's own storage. Reopen the page and a bar at
the top of the form says so, with **Put them back** and **Discard them**. It is
offered, never applied by itself — somebody else may have saved the record
since, and quietly overwriting their work with an old draft is the sort of
thing nobody notices until it matters. If the draft matches what is already on
the page, nothing is said.

**A warning before leaving with changes not yet saved.** The browser writes the
wording, not us; every browser refuses a custom message, because a page that
could write its own would be used to frighten people into staying.

On ten forms: the client, the case, both inquiry forms, the invoice, both
knowledge-base forms, both quote forms, and the task. Not on search boxes,
sign-in, or one-click actions.

**What was deliberately not built** is the third option — writing to the
register every ninety seconds by itself. A register that saves without being
told to has no moment where a person decided the record was right, and the file
note, the audit line and the alerts all hang off that moment. It would also
record half-typed values as facts.

**The cost, said plainly.** While a draft exists, part of a client's record is
on the disk of whatever machine it was typed on. So: passwords, files and
hidden fields are never written; a draft goes when the form is submitted, when
the person signs out, and in any case after twelve hours; and it never leaves
the machine. Written up under *Data* in `docs/security.md`.

Tested by running `public/app.js` itself against a small stand-in for a
browser, rather than by reading the file and asserting a line is in it — the
drafts are a state machine, and a text assertion would pass while every one of
its states was wrong.

## 1.38.0 — 11 September 2026

### Added
**The quotation email is now a letter the practice owns.** Asked plainly:
*"where do i change my email template when quotation is going out to client?"*
The answer was: nowhere. The covering letter was written in TypeScript, and the
only way to change a word was to retype it in the compose box for that one
client — where it was forgotten again by the next quotation. That is the
standing rule broken, since a covering letter is about as practice-specific as a
thing can be.

Both the **subject line and the body** now live under **Settings → Quotes**, and
what is saved there is what the compose box opens with every time. The letter
that was in the code is the starting text, so nothing reads differently until
somebody changes it.

A word in braces is filled in from the matter — `{client_name}`, `{quote_ref}`,
`{total}`, `{link}` and the rest, listed beside the compose box and again on the
preview screen. There are no conditions and no loops: a template language grows
until somebody needs a debugger to see why a client got a blank paragraph, and
this is a letter, not a program.

**A misspelled placeholder prints as written.** `{clietn_name}` comes out as the
literal text `{clietn_name}` rather than quietly disappearing — a letter with a
visible fault is safer than one that reads almost right and has a hole in it.

**Nothing goes out unseen.** The compose box's button now says **Preview**, and
the preview screen shows the letter exactly as the client will receive it — To,
Cc, subject and body — with **Send** and **Back to edit** beneath it. Any word
in braces the register cannot fill is named there before the letter leaves the
office.

## 1.37.0 — 11 September 2026

### Fixed
**Forty-five clients' police certificates were invisible to the alerts.** Found
while chasing the opposite complaint — *"an old certificate bugging me!
especially where there is a new one already in place. no doubt it created an
alert"*. It had not created an alert; that client's record was right. But the
check run to prove it found **45 clients holding a police certificate whose
expiry the register was not watching at all**. One expired fifteen months ago
and had never once appeared on the alerts page. They were not being nagged —
they were being ignored.

The cause: the expiry dates shown on the client list and watched by the alerts
are a copy, kept up to date by the code that adds a certificate. Every one of
those places was correct. The certificates loaded in bulk on 1 September never
went through any of them, and an empty copy looks exactly like a client who
holds no certificate.

**The database now keeps that copy itself** (migration 0082), so it follows the
certificates whatever writes them — the application, a bulk load, or somebody
typing SQL by hand. The migration also repairs every client.

**Client links no longer show the register's own web address.** The public web
address is set to `https://app.immigration.kiwi`. Every link written from now
on — fee quotes, letters of engagement, document lists — uses it.

### Changed
**A superseded certificate no longer looks like a problem.** It kept its expiry
in alarm red with "472 days ago" beside it, even with a current certificate in
place. The red and the countdown are now for the certificate the register is
actually watching. A superseded one keeps its date, quietly, because a matter
lodged in March relied on what was held in March.

### Added
**An alert when a client is running out of time for Skilled Migrant residence.**
*"we could probably create an alert about approaching the age of 56 — when
Skilled Migrant RV application cannot be filed — so maybe give an alert when the
person is 53, and 54 years old — the user will decide whether to advise the
client or not."*

It appears for a month after the 53rd birthday and again after the 54th — two
months of visibility across three years, rather than a row that sits there every
morning until it becomes furniture. It never rises above the quietest severity:
nothing is late, a door is closing, and whether that is worth a telephone call
is your decision.

It stays silent for anybody who already holds residence or citizenship, for a
company, for an archived or inactive client, and — most importantly — for anyone
whose date of birth is not recorded. An alert built on a guessed age would be
worse than none, because it would be believed.

## 1.36.0 — 10 September 2026

### Added
**A client's visa now records when it was granted, not only when it ends.**
*"how did this happen that in a client under immigration I am not able to enter
their NZ immigration status??? type of visa they hold, issue date and expiry
date?"*

Two of the three were already there — the visa type is a dropdown from your own
list, and the expiry has its own field and its "not yet fixed" rule. **The issue
date had never been built.** It is now beside the expiry on the Immigration tab,
and shows under the visa on the client's page.

It matters for more than tidiness: maximum continuous stay is counted from the
start of a grant, reading an interim visa needs both ends, and "how long have
they held this" was being answered from the file notes. The certificates on the
same record have carried a date *and* an expiry since they were written; the
visa was given only an expiry, and nothing had asked for the other half.

Migration 0081 adds two refusals — a visa cannot expire before it was granted,
on insert and on update.

## 1.35.0 — 10 September 2026

### Added
**A document list can now be sent to a client by link.** *"ideally I should be
able to share those lists with clients if necessary — and it is often
necessary."* Open a knowledge base article and press **Create a link**. The
address goes in an email or a message; the client opens a clean page with the
list under its own headings, made to be read on a phone and printed on paper.
No sign-in, nothing to install.

Two things worth knowing:

- **Whatever you edit afterwards is what they see.** Correct a list and the
  correction reaches everybody holding the address. That is the reason for
  doing it this way instead of pasting the text into an email, where every
  client ends up holding a different version frozen on the day it was sent.
- **The link can be stopped.** Press **Stop sharing** and it dies immediately,
  including for clients already holding it. Sharing again makes a fresh
  address; the old one stays dead. Nothing is readable from outside until
  somebody presses the button on that particular article, and the register
  records who pressed it.

The client's page is served without the application's JavaScript — it has no
forms on it, so there was nothing for six hundred lines of script to do on
somebody's phone.

Four new database refusals (migration 0080) hold the rules: a link is at least
32 hexadecimal characters, no two articles answer to one address, and a shared
article always records who shared it and when.

### Fixed
**Client links were carrying the register's own address.** *"the links we are
sending to clients — quotes, invoices, anything — should not be exposing our
internal worker domain."* They were. Every client link is built on the **Public
web address** in Settings → Website, and that box is empty, so the register fell
back to whatever address it was opened on — its own `workers.dev` name.

This cannot be fully fixed from inside the register: a link only works at an
address that actually points here, so setting the box to a domain that has not
been pointed at the register would replace an ugly link with a dead one. What
has changed is that the fallback is no longer silent. The quote email page and
the article share panel now say, before anything is sent, which address the
client will see and where to change it. The setting's own help says what it
does to client links.

**To finish it:** point a domain at the register in Cloudflare, then put that
address in the box. Every link written afterwards uses it.

### Documentation
**The specification is now written by one command, and there are three more of
it.** *"make sure all of this is documented so when we are architecting the
system — every single bit of it is known to the minute feature and detail"*, and
*"not just this issue, but all other issues with the client register we came
across and overcame."*

`npm run spec` rewrites six documents from the code itself: the features, the
data model, the routes, the database's refusals, and — new — every setting an
administrator can change and the permissions matrix. Three of them already said
they were generated and one had drifted anyway: the front page claimed 195
routes while the routes document said 178. A test now fails when what is on disk
is not what the command would write.

The mistakes ledger grows from 28 entries to 38, covering everything found since:
a client page silently behind a sign-in because of mounting order, an accepted
quotation guarded by a permission that cannot express state, a branch of
rewritten history that would have deleted four releases, a print size that never
reached paper, a page shipped without being looked at, a fallback web address
that leaked in silence, and four smaller ones. Each says what happened and the
rule that replaced it.

### The lists themselves
Six document lists are now in the knowledge base. **Relationship documents** in
**English, Russian and Vietnamese** — the practice's own template, unchanged,
so the right one can be picked for the client. And first drafts of **AEWV**,
**RV Partner** and **VV General**, which are marked as drafts and say on their
face that they have not been checked.

## 1.34.0 — 10 September 2026

### Added
**The age now sits beside the date of birth.** Half the thresholds in the
instructions are ages — a dependent child under 25, a parent for the Parent
Category — and working one out from a date in your head, on a page you opened
for something else, is where a mistake gets made. Counted by calendar, so a
29 February birthday turns over on 1 March.

### Changed
**The right-hand column of a client's page, reordered.** *"see what details you
can add or rearrange on the actual client page — on the right side panels — to
make it more efficient."*

- **Identity and compliance leads**, above Contact and Fees. The dates that
  expire — visa, passport, police certificate, medical — are why the file is
  open.
- **The INZ client number leads that card**, above nationality and date of
  birth. It is quoted on everything sent to INZ about the person, and the note
  beside it already claimed it came first.
- **Contact reaches them first.** Phone, then email, then WhatsApp, Telegram and
  address; the name parts follow. Three rows of given, family and preferred
  names used to stand between the reader and the phone number, on a page whose
  heading says the name in full. They stay, because an INZ form asks for them
  separately — they simply stop leading.
- **The phone number and WhatsApp number are now links**, as the email address
  already was.
- **Tags move to the bottom**, matching matters.

## 1.33.0 — 9 September 2026

### Added
**The client's phone and email now show on the matter.** *"add their phone and
email there — so if I open the case I can see those details without the need to
jump into the client."* Both are in Key details, and both are drawn even when
empty: a blank row says nobody recorded a number, where a missing row says the
register was never asked. The phone dials and the email opens a message.

### Changed
**Key details now leads with the numbers you quote.** The client's reference had
been sharing a line with their name — *"there is the client's name and the case
number immediately after that — not good"*. The panel now reads **Client,
Client number, INZ client no., Case number**, one to a row, then phone and
email, then the matter itself. **Opened** now sits above **Lodged**: a file
exists before it is filed.

**The client is noted as the principal applicant in Parties.** The row added in
1.32.1 now says so. It is the register reading the file rather than a role
recorded on it — record a role for the client and that row is drawn instead,
saying whatever was recorded.

## 1.32.1 — 9 September 2026

### Changed
**The client now appears in the Parties panel on a matter.** *"i see the
principal applicant is noted in the right side, but i would love to see them in
the main screen as well — under Parties — just above the secondary applicants."*
A partnership matter was listing two dependent children and a supporting partner
and nobody for them to be dependent on or supporting. The person the matter is
for now heads the list, badged **Client**, linking to their page.

Shown, not stored: `cases.client_id` stays the one owner of who the client is.
Writing a second copy into `case_parties` would be two records of one fact, free
to disagree. Where the client already has a party row of their own they are
listed once, under the role recorded there, and there is no way to take them off
their own matter.

**Tags moved to the bottom of a matter's side column.** *"tags in a case should
move to the bottom, Key Details are much more important."* The panel a person
opens a matter to read — client, type, status, INZ numbers, what is due — was
sitting below a box that held a single word. The order is now Key details, Next
action, Summary, Tags, and a test asserts that rule rather than the appearance,
so a later restyle cannot quietly put it back.

## 1.32.0 — 9 September 2026

### Fixed
**An accepted quotation could still be edited.** Reported within the hour of
acceptance going live: *"once accepted the quotation should not change, right?
is there a block for that?"* and then, having tried it: *"in quote 12 I managed
to delete a line! should not be possible."*

There was no block. The only guard on any of it was `quote:write`, which asks
whether somebody may edit quotations **at all** — never whether *this* quotation
is still theirs to edit. So an accepted quotation could have its fee lines
changed, its schedule rewritten, its parties swapped and its total moved, after
a client had put their name to it. That is not an editing mistake; it is a
contract being altered after it was formed, by the party who wrote it.

**Migration 0079 freezes it in the database**, not on the screen — eleven routes
write to a quotation, and a rule added to each of them is eleven chances to
forget. What freezes is everything the client agreed to: the fee lines, the
payment stages, the people named, the figures, the kind of work, the dates,
whether a letter goes with it, and the note under the schedule. The status
freezes too: there is no honest way to move a quotation off *accepted*.

What does not freeze: the practice's own note on the file, which is not printed
on the document and is not part of what anybody agreed.

The buttons now disappear rather than appearing and failing — but the screen is
the courtesy and the database is the guarantee. Ten refusals, each attacked
directly before a line of the application was touched.

### Added
**Two emails go out when a client accepts.** Asked for: *"the client did not
receive a confirmation email... remember, two emails should go out — one to the
client confirming acceptance, and one to the lawyer confirming acceptance."*

They are different letters because they answer different questions. **The
client's** says what they agreed to, for how much, when, and gives the link
again — with the promise that the document will not change now, which migration
0079 is what makes true. **The practice's** says it arrived, who accepted, and
what it means: that the quotation is now fixed, that a change means a new
quotation, and where to read it as the client sees it. If the client has no
email address on file, the practice's letter says so rather than letting them
assume the client was written to.

Neither can hold up an acceptance. A contract is formed by the client's act, not
by our bookkeeping, so a mistyped address six weeks ago cannot turn accepting
into an error page.

**Where the practice's copy goes** is a new setting — Settings → Practice — so
it can reach an assistant or a shared inbox without changing the address clients
see. Left empty it goes to the practice email.

**A full note on the quotation's own file.** Asked for: *"there is a note in the
right side panel, but there should be a comprehensive note in the file note as
well once it is accepted."* The panel is the record's current state; the file
notes are what happened to it, which is what somebody reads a year later. It
carries who accepted, the date they gave, the moment it arrived, where from, the
total, whether a letter went with it, and that the quotation is now fixed.

## 1.31.0 — 9 September 2026

### Added
**The covering email is the practice's own letter.** Given as a template:
*"use this as a template for the emails to the clients... adapt it but I like
the contents so keep them as much as possible."* So the words are theirs, with
the figures, the dates and the address filled in — including the paragraph they
added by hand, that **acceptance is not a guarantee of any immigration
outcome**, which is a professional matter and not a wording preference.

Five places adapt, because a sentence of theirs would otherwise be untrue of a
particular quotation:

- **"and Letter of Engagement"** comes out when the quotation goes without one.
- **"inclusive of GST"** comes out for a practice that is not GST registered,
  and **"and the disbursements specified"** when there are none. Both are
  statements about a figure on a contract.
- **The capacity sentence** uses the practice's own setting where they have
  written one, and their sentence from this letter where they have not, rather
  than saying it twice.
- **The closing date** is left out entirely when a quotation has none — but the
  capacity sentence stays, which the first draft got wrong: it dropped both
  together, so a quotation left open indefinitely was also the one that never
  told the client the engagement could still be declined.

**A green ACCEPTED stamp at the head of the quotation.** Asked for: *"once it is
accepted there should be a green stamp at the top stating ACCEPTED and date and
time and name."* On the document itself rather than on the page around it, so it
appears wherever the quotation is rendered — the client's link, the practice's
print view, and the paper. Dark green on pale green with a solid border, which
survives a greyscale printer as a bordered band rather than vanishing.

### Fixed
**The quotation and the letter were different widths.** Reported: *"why are they
of different width??"* The letter was set to 46rem, a measure chosen for prose,
and the quotation to 210mm, a measure chosen for paper. Invisible while each was
on its own page; obvious the moment the client's page put one under the other.
Paper wins — they are printed on the same sheet and read in the same envelope,
and 170mm at 8.5pt is about sixty-five characters a line, which is where prose
wants to be anyway.

**And they were touching.** There is 26mm between them now, which is what a
reader needs to see two documents rather than one long one.

## 1.30.1 — 9 September 2026

### Fixed
**The invoice's letterhead now matches the quotation's.** Two gaps, both of
which only showed once the header was swapped to put the title top left — and
both of which I shipped without rendering an invoice, which is the actual fault
here.

- **"INVOICE" is the size of a document title**, as "FEE QUOTE" is. It had been
  an ordinary heading. They sit in the same corner of the same letterhead, and a
  client often holds both.
- **The practice's contact lines are labelled** — Mobile, Email, GST. The
  quotation started labelling them on 9 September and the invoice was left
  behind, so the same firm's details appeared two different ways on two
  documents in the same envelope.

## 1.30.0 — 9 September 2026

### Changed
**Quotations and invoices are set close to the practice's own Xero invoice.**
Asked for, with one of theirs as the example: *"see how small and nice the font
is, aim at compact format — our quotations and invoices must be close to that."*

Measured off that file rather than eyeballed:

- **8.5pt body** on paper, against the example's 8pt and the 9.5pt it had been.
  The floor the test kept was 9pt, set from my own judgement about legibility;
  a document the practice already sends to clients outranks that, so the floor
  moved to 8pt and the reason is written into the test.
- **Hairline rules between rows**, so the eye tracks along a line of figures
  without the row heights having to do it.
- **The totals gather to the right.** The rules above and below them span only
  the figure columns, not the width of the page — the detail that does most of
  the work in the example, because a full-width rule under "Subtotal" cuts the
  document in half while a short one gathers the numbers into a block.
- **Section headings are smaller, in the practice's accent, with a rule under
  them**, which is where that document uses colour.
- **No shaded bar behind the total.** The general table shades a totals row so
  it can be found in a long list on screen; on a document the rules do that, and
  a grey band running the width of the page under a figure ruled only at the
  right is two different ideas about where the total is.

The invoice takes all of it too — it is the same document furniture.

**The header is swapped to match too** — "FEE QUOTE" (and "Tax invoice") top
left, the practice's name and contact details top right. That reverses a layout
settled by hand an hour earlier, so it was put to the practice rather than
assumed from an example offered for its density; they chose to match.

Two details went with it. The reference block's labels align **left** on this
side: they were set labels-right in 1.22.1 at the practice's instruction —
*"align it to each other in the middle"* — which is right against the right
margin, where the values end flush and the labels reach in towards them. Moved
to the left margin it inverts, and the labels' left edge goes ragged against the
margin, which is the fault that instruction was fixing. Every label now starts
flush at the margin and the values meet them on a shared axis, as the practice's
own invoice sets it.

And the swap is done by reversing the *layout*, not by moving the markup, so the
practice's own details are still read first by anything reading the page in
order — a screen reader, a plain-text renderer, an email client stripping the
styling. Whose document this is should not depend on a stylesheet arriving.

**The letter of engagement does not take the swap.** A letter's letterhead
belongs at the top left, and the block on its right is a date and a reference,
not a title.

## 1.29.0 — 9 September 2026

### Added
**A quotation the client can open, read and accept.** Asked for after a test
quote went out as plain text: *"the quote is not acceptable. no link, no nice
formatted page, no ACCEPT button, no letter of engagement — where is the rest of
the mechanics of it all??"* There was no rest of it. This is the rest of it.

**One link, one page.** The quotation, then the letter of engagement beneath it,
then the panel that accepts them both. They are one engagement — the letter
states the terms and points at the quotation for the parties, the scope and the
fees — and two links would mean two chances to accept having read half of it.

**The documents are the same documents.** Not a second rendering: the quotation
and the letter were moved into one template each, and the practice's print view
and the client's page both call them. Two templates for one contract would agree
the day they were written and drift the first time only one was corrected.

**Where the Accept button sits.** At the foot, after both documents — not
floating over them. A button that follows the reader can be pressed on the first
screen, and what that records is a click, not a reading. What does follow the
reader is a quiet bar saying the quotation has not been accepted yet, with a
link to the panel. It needs no scripting at all, which matters here more than
anywhere else in the register: this is the one page opened by somebody the
practice cannot help if it fails.

**Accepting** takes the client's full name, the date, and a tick to say they
have read the documents. What is recorded is that, plus the moment the register
received it and the address it came from — the typed date is the client's word
and the received moment is the register's, and both are kept because a document
recording only one of them would be less use in the argument it exists for.

It writes a **file note on the matter** and an **audit row** naming the client
rather than a user, moves the quotation to Accepted, and shows the practice who
accepted and when. **An acceptance can never be changed or removed**, by
anybody, including the owner — it is the moment a contract was formed. A
quotation accepted in error is answered with a new quotation, exactly as on
paper.

**The link** is 128 bits, unguessable, minted when the quotation is emailed and
fixed thereafter. There is no account: a client who has to register to read
their own fee quote will telephone instead. An unknown link and a link that was
never ours get the same answer, so nobody can learn which quotations exist by
trying.

### Changed
**The covering email is a covering email.** It used to type the whole quotation
into the body — every line, the subtotal, the GST — padded so the figures lined
up in a plain-text mail client. It now says the total, gives the link, names the
Letter of Engagement and the Standard Terms, asks the client to read them, and
asks them to sign at the foot of that page if everything is acceptable — with an
invitation to reply first if anything needs explaining, which is the thing a
client most needs permission to do before signing a contract.

### Fixed
**The Money menu opened on its own.** Reported: *"the Money menu keeps opening
on its own — why?"* Because it did: a group was rendered open whenever the page
you were on sat inside it, so every visit to Quotes or Invoices arrived with a
panel hanging over the page and covering the search box. The intention — showing
where you are — was right, but a dropdown is positioned over the page, so "open"
meant "covering it". Where you are is now said by the heading being marked
current, as every other item in the bar says it.

**Two warnings that read as a contradiction.** A refused save talks about the
schedule you typed; the warning under the schedule talks about the one that is
saved. Without a sentence joining them they looked like the register arguing
with itself. The refusal now says what the schedule below is still showing, and
why.

**"FEE QUOTE" was 2mm from the edge of the paper** on a document printed with
the browser's margins set to Minimum. The margin loss is the print box's doing
and no stylesheet can prevent it — but the title had also been lifted 9px for
the screen, and it should not be spending the little that is left. That lift is
gone.

**The printed quotation is tighter again**, at the practice's instruction:
*"reduce the line spacing but keep it as is where the subheadings are."* So the
rows lose their air and the headings keep theirs — the space before PROFESSIONAL
FEES is what tells the eye a new group has started.

## 1.28.1 — 9 September 2026

### Changed
**The head of a quotation, settled.** Three corrections from looking at a
printed one:

- **"FEE QUOTE" in capitals**, and at twice its original size rather than three
  times — three was too big on the page. The capitals come from the stylesheet
  rather than the markup, so the words a screen reader announces, and the words
  somebody copies off the page, are still "Fee quote" and not nine separate
  letters.
- **Raised above the practice's name** beside it, with **four clear lines**
  underneath, so it reads as the title of the page rather than as a label on the
  reference block. The reference block stays where it was rather than rising
  with it, and the title is still 18mm clear of the top of the paper.
- **The "Re" line is gone.** *"remove the Re RV. Partner bit completely — the
  body of the quote is telling enough."* It had already been narrowed that
  morning, from "RV. Partner — <the client's name>" to the kind of work alone,
  because the client is named at the head of the document. The next observation
  was the obvious one: the items below name the work, line by line, with a
  figure against each, so a heading reading "RV. Partner" above a list beginning
  "RV. Partner" is the document repeating itself.

The block still says which quotation, when it was issued and how long it stands,
and there is a test that says so — losing the Re line must not quietly lose the
rest of it.

## 1.28.0 — 9 September 2026

### Added
**A schedule of payments cannot promise more than the quotation does.** Asked
for: *"make sure that it also tells how much is left to allocate, and that it
does not allow for allocating more than the total fee from the fees and
disbursements section."*

Both halves:

- **What is left to allocate** now sits under the schedule, beside what has been
  allocated — the figure a person is actually working out in their head while
  they type, and the one number the page did not show. It says *"$4,000.00
  allocated of $7,632.70. $3,632.70 left to allocate."*, and says the whole
  quotation is allocated when it is.
- **Over-allocating is refused**, by the database (migration 0077) rather than
  by the form, because four routes write payment stages and a rule in one of
  them holds until somebody writes a fifth. Stages that came to more than the
  fees and disbursements would ask a client to pay twice for part of the work,
  in a document that is a contract.

Saving the whole schedule now reads the form before writing any of it, so a
schedule that would go over is refused whole and nothing is half-applied — and
so that a **rebalance** is not refused in the middle of itself. Moving $1,000
from the last stage to the first, row by row, briefly asks for $1,000 more than
the quotation; the save now takes every stage to nil and builds it back up.

One direction is deliberately not blocked: lowering a fee line under a schedule
already written. That guard would have to sit on the quotation and would block
an ordinary correction to an item until the schedule was taken apart. It is
reported under the schedule instead.

### Changed
**"Fee quote" is the size of a document title.** Asked for. It sits at the head
of the right-hand column, flush to the right margin above the reference block,
at roughly two and a half times its old size. It had been set at the size of an
ordinary heading, which made it read as a label on the reference rather than as
the name of the document.

**The word "Remove" is a small red cross everywhere it appeared.** Asked for:
*"wherever there is a word remove — needs to be redone like this."* Seven
places: a party on a matter, a fee line on an invoice, a party's share of an
invoice, a passport, a certificate, a file on a knowledge article, and the
tick-to-remove boxes in both editing tables on a quotation.

Every one keeps a real name — "Remove this passport", "Remove *the line*" — as
the button's accessible name and its tooltip, because a symbol on its own reads
out as "times" and several of these delete something off a contract. The tag
crosses that were already crosses gained the same spoken name.

The tick boxes stay tick boxes underneath, because those are a batch: nothing
happens until you save, so several rows can go at once and a slip can be
untangled by unticking it. The cross **fills solid red when ticked**, so what is
about to go is visible before saving.

### Fixed
**The money columns sat in a different place on every quotation.** Reported:
*"the money figures move from one quote to another — slightly — why? They must
be fixed, but the columns must be flexible when changing the width of the
window."*

Because the columns were sized by their contents: a quotation whose largest
figure is $598.00 gave its money columns less room than one whose largest is
$7,000.00, so the same column landed in a different place each time — and they
are read side by side.

They are shares of the table now rather than pixels, which is what makes both
halves of that true at once: the same proportions on every quotation, and still
giving and taking as the window changes. Description takes whatever is left,
because it is the one column whose content genuinely varies. Checked at two
window widths across two quotations: identical to a tenth of a percent.

## 1.27.1 — 9 September 2026

### Fixed
**A gap in the middle of the letter, from justifying it.** The paragraph naming
the standard terms carries a web address, and a web address cannot be broken
between words — so the line before it was stretched to the full measure around
whatever few words fit, and read "…whose current edition is published" then most
of a line of white, then "at".

Justification is for prose, and a paragraph carrying an address is only mostly
prose. That one keeps its ragged edge. Found by looking at the rendered page in
a browser rather than at the rule that produced it, which would not have shown
it.

## 1.27.0 — 9 September 2026

### Fixed
**The black pages, for the third and last time.** A quotation printed today came
out with a near-black rectangle over both pages, at 8.5mm margins.

1.23.0 had already answered a black PDF by moving the paper palette onto the
document itself, so it would not depend on the print stylesheet running. That
reasoning was right and did not cover this. **The print stylesheet did run** —
the application's header and buttons are correctly absent from the file — and
the document itself was white. What was black was the **canvas**: the sheet
behind the page, which a browser paints from `color-scheme` on the *root*
element. The print rule set it on the body, which cannot reach the canvas. Tick
**Background graphics** in the print box and that dark sheet is printed, under
a document that is correctly white.

**So the fix is not another print rule.** A page carrying a document is now
served in light mode. There is no dark canvas to print, in any medium, and
nothing left for a render path to skip — and the practice sees on the screen
exactly what comes out of the printer, which is the property that was wanted
all along. The sign-in page is unaffected; it is not a document.

Verified in Chromium with **Background graphics on** — which is what the
practice had — through the print path and through the path that ignores print
styling entirely, from a browser forced into dark mode: six files, **no dark
fill anywhere**, and 20mm on every edge of the printed ones.

### Added
**Every document says which printing it is.** Asked for: *"it is better if —
when Print button is clicked — a clean PDF is generated with full date and time
stamp."*

At the foot of the quotation, the letter of engagement and the invoice, above
the buttons (which are not printed):

> Printed Wednesday, 9 September 2026 at 11:40 pm NZST

Long-form on purpose. It is read off paper by somebody who may be holding two
copies of the same reference, so the day is named, the month is in words, the
time is to the minute and the zone is said rather than assumed. It is written
by the server at the moment the page is asked for — there is no script on these
pages and the register does not read the reader's clock — and it is New Zealand
time, not the machine's.

It shows on the screen as well as on the paper. A document that shows one thing
on screen and another on paper is the fault the whole day has gone into
removing.

## 1.26.1 — 9 September 2026

### Changed
**A quotation now names all three documents it is subject to.** The practice's
own sentence, replacing one that named a single set of terms:

> This Quotation (fee quote) is subject to the Letter of Engagement, Short Form
> and **Standard Terms of Engagement**. Please read them before accepting.

A client is held to three documents — the covering letter, the short-form terms
printed under it, and the standard terms published online — and only the last of
them was being named, because it is the only one with an address. "Subject to"
also says what the sentence is there to say: "given on" describes how the price
was arrived at, not what is being agreed to.

**Standard Terms of Engagement** is the hyperlink, since it is the one of the
three the client does not already have in their hand. The address still prints
underneath on paper, where a hyperlink is worth nothing.

The same sentence now appears in all three places that describe the engagement —
the printed quotation, the covering email drafted with it, and the note on the
quotation screen — because they reach the client together and must not describe
it differently.

## 1.26.0 — 9 September 2026

### Fixed
**The totals under a quotation's fee lines were sitting under the wrong
column.** Reported: *"you swapped the columns but left the totals under gst —
not acceptable."* Exactly right. Amount was moved to the right of GST earlier
the same day and the totals block kept its old width, so the professional fees,
the disbursements, the subtotal, the GST and the total payable all printed one
column to the left of the figures they were adding up — under the GST heading.

Two facts had to agree and each was written down separately, which is the
arrangement that guarantees they will eventually disagree. There is one now: the
columns are named in a single place and the totals take their width from it, so
moving a column moves the totals with it. Pinned by a test that renders the page
and counts the cells, rather than one that checks the code against itself.

**The payment stages were formatted badly and disagreed with the paper.**
Reported: *"do not like how this is formatted in the register."* Three faults,
compounding:

- The figure was the **net** amount with "+ GST" beside it and the inclusive
  figure in grey beneath. The printed quotation had stopped doing that earlier
  the same day, so the screen and the paper gave different numbers for the same
  five payments — and the screen is where they are checked before they go out.
  The screen now shows what the client pays.
- It **broke across three lines**: "$2,000.00 +" / "GST" / "$2,300.00 incl." is
  not a price. And "Stage 1" was splitting after "Stage". Both are held on one
  line now.
- **"+ GST" was untrue** of the INZ fee, which is GST inclusive — nothing is
  added to it. What is under the figure now says how much of it *is* tax, which
  is true whichever way a stage is treated.

### Changed
**A line comes off a quotation with a small red cross**, not the word "Remove".
Asked for. On a table of fee lines the word was the widest thing in its column
and repeated down the page, drawing the eye to the one thing on the row that is
not a figure. It stays a real button with a real name — "Remove *the line*" is
its accessible name and its tooltip, because a symbol on its own reads out as
"times" and this one deletes a line off a contract.

**The fee lines and the payment stages are compact.** Asked for: *"think of
making things compact."* Density only — the type is the size it was, so nothing
is harder to read; what goes is the air. The five totals read as one block
rather than five ruled-off things. The items card is about a third shorter.

**Colour on the invoice, and on the headings that name a document.** Asked:
*"what about the theme colours in the invoice and letter of engagement?"* The
release that put the colour back reached the section headings and stopped there
— so the invoice, whose only section headings are "To" and "For", came out
almost entirely black, and so did *Tax invoice*, *Short Form Terms of
Engagement* and the addendum's title. Those now carry the accent. The practice's
own name at the head of the paper stays in ink, where it should be the first
thing read.

## 1.25.0 — 9 September 2026

### Changed
**The letter of engagement is justified — set flush to both margins.** Asked
for: *"justify the text on both sides in the letter of engagement."* It is how a
New Zealand legal document is set, and a straight right edge is most of what
makes a page read as a deed rather than as a printout.

Only the running prose. Justification works by stretching the spaces in a line,
and there is nothing to gain by stretching a name, a date or a salutation — and
a great deal to lose on a two-word line. So the address block, the RE line,
"Dear …,", the signature and every heading keep their ragged edge, the rule
between the covering letter and the terms stays centred, and a last line is
never stretched. **The quotation is deliberately left as it was**: it is a table
of figures with short descriptions beside them, and a justified two-word cell is
a row of gaps.

**The margin is 20mm, down from 25mm.** Asked for in the same breath, and it is
the same two numbers as before — the page's top and bottom, and the document's
own side padding. 25mm was the figure named while documents were coming out at
8.5mm and the number had to be unmistakably generous; now that the margin is
actually being applied, 20mm is the width the practice wants, and is still ample
for a hole punch and a staple. It applies to the quotation, the letter of
engagement and the invoice alike, because they are one document family and a
practice's paper should not change width between them.

The two halves are now asserted against a single figure in `test/css.test.ts`
rather than against a floor each, so they cannot drift apart — which is the
fault that suite exists to catch, and one nothing on screen would show.

## 1.24.0 — 9 September 2026

### Added
**`**bold**` in your own wording.** Asked for while writing a twenty-five item
list of acknowledgements: put two asterisks around a phrase and it prints in
bold. It works in the clauses, the opening and closing, the scope of the
retainer, the addendum and the acknowledgements.

Two asterisks and nothing else — no italics, no links, no headings. A contract
is not a document anybody should be able to restructure by accident, and every
other syntax somebody might type stays visible as the characters they typed. The
text is escaped first and the tags are added second, so the only markup that can
ever come out is the emphasis itself.

**A heading you own for the acknowledgements.** It was fixed at "What you
confirm by accepting"; it is a setting now, so it can read "Client
Acknowledgements and Consents" or whatever the practice writes.

### Fixed
**Pasted numbering no longer numbers the list twice.** The list prints numbered,
so a list pasted from a document where the items were already numbered came out
as "1. 1. acknowledges…". Leading numbering is taken off — "1.", "2)", and a
stray bullet in front of a number, which is what pasting from a word processor
does. A number that is part of the sentence is left alone, and a line that is
only a number is dropped rather than printed empty.

## 1.23.2 — 9 September 2026

### Fixed
**The administrative team prints as it is typed.** Reported: *"not acceptable
formatting on the print — they must appear in the same way as in the back end."*

This was cleverer twice and wrong twice. Read by position, a line typed the
natural way lost both email addresses off the letter. Read by recognising the
parts, the addresses came back — printed gathered onto their own "Mobile:" and
"Email:" lines at the foot of the section, which is not what anybody wrote.

The second version was the first mistake with more machinery: the register was
taking a sentence apart in order to put it back together differently from how
somebody wrote it, and nothing else needed the pieces. **One line in, one line
out.** Whatever the practice writes about how to reach somebody is between them
and their client.

- **"Quotation" is capitalised** where the letter points at it. The opening
  defines it as a term, and a defined term is capitalised wherever it appears.
- **The colour is back.** *"i like some theme colours in it — did not mean to
  get rid of colour completely."* Fair: the document went black and white when
  it was made to stop printing in the dark theme, and that threw out the colour
  along with the problem. Section headings are in the practice's accent again
  and links keep it; what stays black is the body text, which is what "readable"
  actually meant. The small print is darkened rather than flattened.
- **The address of the standard terms is a live link**, and still shows the
  address as its own text — a printout of "click here" is worth nothing.
- **Tighter again**: line spacing 1.3, and paragraph and section gaps reduced
  once more.

## 1.23.1 — 9 September 2026

### Fixed
**"What the client confirms" now takes 10,000 characters**, up from 4,000. The
practice's own list of confirmations had outgrown the box and it was refusing
the rest. It is one item per line and the list keeps growing, so the cap is the
thing that moves rather than the list that gets cut.

## 1.23.0 — 9 September 2026

### Changed
Four more corrections to the fee documents, all from reading real ones.

- **On a quotation, "Re" now names the kind of work and not the client** — *RV.
  Partner*, rather than *RV. Partner — <client>*. The client is already at the
  head of the document, so a reference line repeating them said nothing new. It
  is worked out from the kind of work recorded on the quotation rather than cut
  off the front of its name, because splitting a name on an em dash works until
  somebody's matter has one in it.
- **Amount now sits to the right of GST** on the items table.
- **The unit can be cleared.** *"for some reason cannot remove 'item' word even
  if i edit it"* — and it could not be removed by anybody: both routes that
  wrote the column ended in "or the default", so an empty box was
  indistinguishable from an absent one and became *item* again on the way to the
  database. Clearing the field and saving looked exactly like not having tried.
  An empty unit now stays empty, and a line reads "1" rather than "1 item".
- **"Our reference" is shortened to "Our Ref"** on the letter of engagement.
- **The payment stages show what is payable**, not a figure plus a promise of
  tax. Each row read "$2,000.00 + GST" while the total beneath them was already
  inclusive — so the rows and their own total were in different currencies, and
  a client had to do arithmetic on a payment schedule before it meant anything.
- **"The Lawyer" and "The Client"** are capitalised on the quotation as they are
  in the letter, where they are defined terms.
- **"Nominated representative for all parties" sits beside the name**, in
  smaller type in brackets, rather than on a line of its own beneath it, where
  it read as a second fact about the person rather than a note about which name
  this is.
- **The type is slightly smaller again** on printed documents and on the
  document preview.

### Fixed
**The documents were printing in the dark theme, and that is why two releases of
margin fixes had done nothing.** A PDF of a letter sent by the practice had a
near-black rectangle covering all four of its pages, with margins of 4.2mm. Both
facts had a single cause: whatever produced that PDF **never applied the print
stylesheet**, so the document came out in the application's dark palette *and*
without any of the print margins.

Every margin fix so far had been written inside `@media print`. A document that
needs the print stylesheet to run in order to look like a document is one render
path away from reaching a client as white text on black.

**So the paper is no longer a print-time idea.** A quotation and a letter of
engagement now carry their own palette — black on white, A4 measure, real
margins — in *every* medium: on screen, printed, saved as a PDF, screenshotted,
or rendered by anything else. The print stylesheet is left with only the page
around the document.

Verified by producing the PDF **both ways** — the ordinary print path, and the
path that ignores print styling entirely, which is the one that produced the
black pages — from a browser forced into dark mode. Identical: A4, no dark
areas at all, 25mm on every edge of every page.

- **A4 is now named explicitly**, at the practice's instruction. It had been
  left to the printer, on the reasoning that forcing a size makes a printer
  loaded with anything else scale the page and shrink the margin with it. A New
  Zealand legal document silently arriving as US Letter is the worse of the two.
- **The shaded block behind the quotation reference is gone**, along with the
  rest of the dark furniture. Clean rules and black type.

### Added
**A home for the Law Society information.** Asked: *"where do we attach this
to?"*, with the Rules of Conduct and Client Care information a client must be
given — fees, the Fidelity Fund, who is responsible, complaints, client care and
service, limitations on liability.

Nowhere, was the answer: the letter ended at its signature. It is an **addendum**
— not this practice speaking to this client about this matter, but what every
client of any New Zealand lawyer must be told — so it now follows the letter,
after the signature, starting a page of its own. Settings → Letter of
engagement, empty until written.

### Changed
**The administrative team box now reads what you actually type.** Written as
`Name | Short name | Mobile | Email` and read by position, so a line typed the
natural way —

    Ms A B Example, Mobile: +64 21 000 0001 | Email: ann@example.test; and

— gave a name with the number stuck to it, and **lost the email address off the
letter entirely**: the second field is only ever printed in brackets beside a
number, and with no number it was never printed at all.

That is a fault in the format, not in the typing. The line is now read by
recognising what things are: anything labelled `Email:` or containing an `@` is
the address, anything labelled `Mobile:`/`Phone:`/`Tel:` or that is otherwise
just digits is the number, and what is left is the name. Commas, pipes and a
trailing "; and" all work. The four-field form still reads exactly as it did.

## 1.22.1 — 9 September 2026

### Changed
Four corrections to the head of a printed document, all from reading a real one.

- **Date, reference and matter now line up with each other**, and each label
  ends with a colon. Both columns had been right-aligned, so the labels ended at
  a ragged left edge and the values at a ragged one of their own — three pairs
  that never quite met. Labels right, values left, meeting on a shared axis.
- **The practice's contact lines are labelled** — `Mobile:`, `Email:`, `GST:`.
  A bare address and a bare number under a firm's name are two lines a reader
  has to work out.
- **The GST number is on the letter of engagement too.** It had been on the
  quotation only, and it is the other thing a client copies off a fee document.
- **"(Direct Access)" is off the terms heading**, which now reads simply
  *Immigration Legal Services* under *Short Form Terms of Engagement*.

A line the practice has not filled in is left out rather than printed as a bare
label with nothing after it.

## 1.22.0 — 9 September 2026

### Added
**Every new quotation can start from the practice's own shape.** Asked for while
looking at a real one: *"I would like to have its stems to be a default template
for all, without the money figures, so each new one can be adjusted with ease."*

Open a quotation whose shape is right and press **Use as the template**. Its
lines and its payment stages — the wording, the kind of each line, and how GST
applies to it — become the starting point for every quotation made afterwards.
The text is stored under Settings → Quotes, so it can be read and edited there
without pressing the button again.

**No amount is ever part of it.** A template carrying figures would put one
client's price on another's quotation, and the first time somebody did not
notice would be the time it was sent. Every row arrives at nil, the totals read
zero, and the file note on the new quotation says it started from the template
and is unpriced.

The stages are the part that was actually being retyped: case review, the
progress payments, the INZ fee, the balance on approval. That wording is what a
client is held to, and something retyped from memory is something that drifts.
The lines come too because one of them carries the tax treatment that is easy to
get wrong and expensive to get wrong — an INZ fee is GST **inclusive** while
professional time is exclusive.

Two things it deliberately does:

- **The button is behind Settings permission, not quote permission.** Pressing
  it changes what every future quotation starts from, which is a configuration
  act wearing the clothes of a quotation one. An adviser can quote; only an
  administrator or the owner can change the shape.
- **A quotation with nothing on it cannot become the template.** The first
  version of this saved before it counted, so pressing the button on an empty
  quotation would have silently replaced the practice's wording with nothing —
  found by the test that says so, before anybody could press it.

A practice that sets no template gets the blank quotation it always got.

## 1.21.0 — 9 September 2026

### Added
**The letter now shows where the covering letter ends and the terms begin.**
Asked for with a line drawn across a screenshot: everything above it is the
covering letter, everything below is the practice's short-form terms. Two
documents on one page, and nothing said where one stopped.

It matters beyond tidiness. The letter points at a **second** set of terms —
the Standard Terms of Engagement, published at a web address further down — and
a client who cannot see that the page in their hand is itself a set of terms has
no way to tell the two apart. There is now a rule across the page headed
**Short Form Terms of Engagement / Immigration Legal Services (Direct Access)**,
and both lines are settings you can reword or clear.

**A place for the scope of the retainer**, immediately under the block that
points at the quotation — the block says where the work is written down, this
says the limits of it. Settings → Letter of engagement.

**It ships empty on purpose.** This is the paragraph that tells a client what
their lawyer will and will not do, and the register does not compose that for
anybody, the same as the opening and the closing. Nothing prints until you write
it, and the heading does not appear above an empty section.

### Fixed
**The 25mm margin was still not happening, and now it is.** A letter printed
within an hour of the last release measured 8.5mm at the sides — byte for byte
what it had been before the fix. The stylesheet was live and uncached, so the
rule was there and was ignored.

`@page` is a request. Chrome's print dialogue has a **Margins** control, and
every setting but *Default* overrides the document; 8.5mm is about what its
*Minimum* gives. A margin a contract depends on cannot sit behind a preference
in somebody's print box.

The margin is now split between the two mechanisms, each doing the half it can
actually hold:

- **The sides are padding on the document**, which no print setting can reach.
- **The top and bottom stay with `@page`**, because padding cannot do them: a
  block's padding falls at the start and end of the *document*, not at each page
  break, so a two-page letter got 25mm at the top of page one and **0.8mm** at
  the top of page two. That was measured on the way to this, not reasoned about.

Verified by generating both documents twice — once letting the stylesheet decide
and once asking for no page margin at all — and measuring every edge of every
page: 25mm on all four, both times.

**What this still cannot do** is force a top margin when the dialogue is set to
anything but *Default*. Nothing in a stylesheet can. The print page now says so
on screen beside the button, where somebody is actually standing when they press
it, rather than only in Help.

### Changed
- **Smaller type, tighter spacing.** The printed document had been inheriting
  the interface's 14 pixels; it is now 10pt — set in points, so it is the size
  it claims to be on paper — with line spacing of 1.38 against the screen's 1.6
  and paragraph gaps a little over half what they were. A five-page letter loses
  about a page to this without a word being cut. Greys are printed black: grey
  on white loses more to a printer than it gains on a screen, and some of it is
  the client's own contact details.
- **"Letter of engagement" is off the top right corner.** The document says what
  it is twice already — the RE: line names it, and the rule below heads the
  terms — and a third label only competed with the practice's own name beside it.
- **The quotation block is now headed "The Parties, the Scope of Work, the Fees
  (Legal and Disbursements) and the Payment Terms."** "The work, the parties and
  the fees" was too narrow for a document that also settles who the parties are
  and when the money falls due.
- **The client is named as "FOR: …"** The block sits between the practice's
  contact details and the client's, and a bare name between the two does not say
  which it belongs to.
- **"Telephone" is now "Mobile"**, which is what the number actually is.

## 1.20.0 — 9 September 2026

### Added
**The letter of engagement can name your administrative team.** Asked for: the
letter says day-to-day contact is with an administrative team whose role is
limited to support — that they give no legal advice, exercise no professional
judgement, and do not act as the client's representative. A paragraph saying
that has to name people, and the people change while the paragraph does not.

So they are split. **The paragraph is yours**, written as a clause under
Quotes → Letter clauses like every other. **The people are settings**, under
Settings → Letter of engagement: a heading, the line that introduces them, one
person per line as `Name | Short name | Mobile | Email`, and a last item for
"or any other person nominated by them".

The letter prints them as a lettered list with the mobiles and emails gathered
onto one line each, in the order entered. Only the name is required — somebody
with no mobile recorded is simply absent from the mobile line rather than
leaving a gap in it, and a line with no name at all is dropped rather than
printing an empty item on a contract.

**They are on the letter and not on the quotation**, by the same instruction:
the quotation is the work and the fees, and who answers the telephone is a term
of the engagement.

No name goes into the code for this. They live in the register, which is also
what makes them per-practice for free the day a second practice has a database
of its own.

### Fixed
**A web address was breaking in the middle of "http".** Reported from a real
letter, where the terms URL split as `http` / `s://…` — in a contract.

The cause was `word-break: break-all`, which breaks at whatever character the
line happens to end on with no preference for a sensible one. The rule that was
wanted is `overflow-wrap: anywhere`: the browser first tries to move the whole
address to the next line, and breaks inside it only when it genuinely will not
fit, which on a phone it sometimes will not.

## 1.19.1 — 9 September 2026

### Changed
**The letter of engagement now greets the client, and stops asking for their
postal address.** Two corrections from reading a real one:

- *"the letter of engagement must start with `Dear CLIENT'S FULL NAME,`"* — it
  opened straight into the first paragraph under a bare name, which reads as a
  form rather than as a letter from a person. The salutation uses the full name
  as the register holds it, so it matches the name on the quotation beside it
  and the name the client signs under. A client with no name recorded is not
  greeted at all, rather than being sent *"Dear ,"*.
- *"The address is not required - it should only have email and phone number."*
  It is a letter that goes by email, to clients who are often between
  addresses — one live record's address reads *"(joint tenancy address; full
  address not stated)"*, which is a note to the file, printed on a contract.
  The block now carries email and telephone. The address stays on the client's
  own record; it is only this document that stops carrying it.

### Fixed
**Printed documents were leaving almost no margin.** Reported from a real
quotation: *"the margins are too thin. they must be at least 25mm all around."*

Measured on the file sent: **8.5mm at the sides, 5.8mm at the top.** The cause
was that the register had no `@page` rule at all — it had never said what margin
its documents wanted, so the browser's print dialogue decided, and whatever it
was set to last is what the client received. A quotation carrying the letter of
engagement is a contract; it gets filed, punched and photocopied.

Now **25mm on every edge, on every printed page** — quotation, letter of
engagement, invoice alike. Verified by generating the documents through the real
print route and measuring the result rather than trusting the stylesheet, and
pinned by a test, because this is invisible on screen: nothing looks wrong when
the rule is missing, and it only shows up on paper after the document has gone.

Two deliberate limits, both stated in Help:

- **The paper size is not forced.** Naming A4 would make a printer loaded with
  anything else scale the document down and take the margin with it — the same
  fault arriving by another road.
- **The browser can still override it.** Chrome's print box has a Margins
  control, and *None* ignores the document. It has to stay on *Default*.

## 1.19.0 — 9 September 2026

### Added
**A matter or a client created by mistake can be deleted.** Asked for: *"owner
must be able to delete a case - i have just created one - a duplicate!"*, then
*"the same for clients - must be able to delete"*. An intake that ran twice had
left a duplicate matter and three empty people, and there was no way to remove
any of them.

The button is at the foot of the **Edit** page, for the owner and administrators
only. It always says what deleting would take with it, in numbers, and it asks
you to type the reference — not to click "yes", which is not a decision.

**What cannot be deleted, and why.** These are refusals the database makes, not
checks on a screen, so a second button cannot forget them:

- A matter with an **invoice** against it. An invoice has to say what it was for.
- A matter or client with a **quotation already sent or accepted**. That letter
  is a contract.
- Anything holding **documents**. Remove them first, one at a time — otherwise
  the files stay stored with nothing pointing at them.
- A **client who still has matters**. Those come off one at a time, each its own
  decision.
- A **client anybody has written a note about**. Archive them instead, which
  keeps the file and stops the alerts.
- A **client named on somebody else's matter**.

**What happens to the file notes.** They are not destroyed. When a matter is
deleted its timeline **moves onto the client's own file**, word for word. The
duplicate that prompted this carried a file note written four minutes earlier,
from a consultation; deleting the matter must not be the thing that loses it.

That was not a design decision so much as a discovery: the first version of the
migration tried to delete the notes with the matter, and the database refused
the whole deletion, because notes have been append-only since migration 0014.
Rehearsing it is what found that. The rule is now stated more exactly — **what a
note says is frozen; where it is filed is not** — which also means a note filed
against the wrong matter can be moved at all, which it could not before.

### Fixed
**The specification was understating the register's own rules, and had been
since it was written.** `docs/spec/invariants.md` claims to list everything the
database refuses, in its own words, and a test holds it to that. Both the
document and the test read only the **first** refusal in each trigger — so a
trigger that refuses six things was documented as refusing one.

Four of the five reasons an inquiry cannot be deleted had never been written
down. The count moves from 71 to 85; nine of the fourteen are new rules from
this release and five were always there, kept by the database and missing from
the document that exists to describe it.

## 1.18.0 — 9 September 2026

### Added
**A backup button.** Settings → Export now has, for the owner only, one button
that downloads the entire register as a single dated zip file.

`docs/operations.md` has carried "there is still no automated backup" as the
largest single risk since the register went live on 30 August. This is not that
— a button somebody has to press is not automatic — but it is what makes the
risk survivable today, and it is the piece an automatic backup would call.

What is in the file:

- `schema.sql` — every table and index.
- `data/NNN_<table>.sql` — every row, as `INSERT` statements, numbered in the
  order they load in.
- `triggers.sql` — the register's rules, to run last.
- `tables/<table>.json` — the same rows again, for reading with anything else. A
  practice that has lost its register should not also have to parse SQL to find
  one client's address.
- `files/<key>` — the documents themselves out of R2. A `documents` row naming a
  file the archive does not hold is a reference to nothing.
- `manifest.json` and `README.md` — what was taken, when, by whom, and how to
  put it back.

**The shape above was arrived at by restoring one**, which is the only way any of
it could have been known, and the first three attempts each failed differently:

1. Alphabetical data files put `case_parties` before `cases`. 36 of 51 tables
   were refused on foreign keys and the restored register had **no clients in
   it**. The files are numbered in dependency order now, worked out from what
   each table references, so `for f in data/*.sql` is enough.
2. Two clients can point at each other — an organisation names its main contact,
   and that contact's organisation is the organisation. No order restores that
   pair, so those columns go in empty and are set by an `UPDATE` at the end of
   the same file, which is what a database's own dump tool does with a loop.
3. Creating the triggers before loading the data meant today's rules judging
   the practice's own history. They go on at the end now, over a database that
   is already whole.

A restore is now rehearsed on every test run — the archive is replayed into an
empty database with foreign keys **on**, and the records are counted back — so a
change that quietly breaks it fails here rather than in the week it is needed.

**It includes passport numbers**, which the CSV exports deliberately do not. The
distinction is what the file is for: an export is read somewhere else, a backup
puts the register back, and one missing a column cannot. The practice was asked
in those terms and decided it on 9 September 2026.

Three consequences follow from that, and all three are built in:

- The permission is new (`backup:take`) and belongs to **the owner alone** — not
  to an administrator, who can otherwise do everything else in Settings.
- It is a form with a token rather than a link, so it cannot be triggered by a
  link somebody was sent.
- Taking one writes an audit row saying what was taken — how many tables, rows,
  files and bytes — not merely that something was.

The zip is written by hand (`src/core/zip.ts`): there is no zip in the Workers
runtime and no dependency here that provides one. Deflate comes from the
platform's `CompressionStream`. The tests take the archive apart from its
end-of-central-directory record backwards, the way a stranger's tool would,
rather than by reading back the object that wrote it.

One more fault came from pressing the button rather than from a test: D1 keeps
its own `_cf_METADATA` table, which `sqlite_master` lists and which D1 then
refuses to read, so the first press returned a 500 while every test passed. D1's
own tables are excluded, and the test suite now creates one so the exclusion is
a rule it can check.

### Fixed
The Export page still described passport numbers as "the one field the register
encrypts". They have been stored as written since migration 0042 on 30 August.
The reason they stay out of the CSVs is unchanged and is now stated as what it
actually is: a spreadsheet in a downloads folder is the copy that escapes.

## 1.17.0 — 9 September 2026

### Fixed
Four faults found by an audit of the previous two days' work. All four are the
same species: **a guarantee that lived in one screen's code rather than in the
database**, so it held until somebody wrote a second screen.

- **A failed "Open the matter" left a half-made client behind.** The Owner box
  offered "Nobody yet", but a matter must have an owner and the database refuses
  one without — after the client, their nationalities, their INZ number and a
  file note had already been written. You saw an error, pressed again, and got a
  second client with a second CL- number. The owner is now checked before
  anything at all is written, and the box no longer offers a blank.

- **A quotation could be moved on to a different client than its matter's.** The
  letter of engagement would then print that client's name and address above the
  old matter's reference, with the old matter's clauses — on a document that is
  a contract. Refused now by the database, not by the screen, and the message
  says what to do instead: take the matter off first.

- **The letter of engagement was still leaving out clauses.** It read the kind
  of work from the matter *or* from the fee lines, never both, so a quotation
  covering a partnership application and a dependent child got the clauses of
  whichever won. And the visa type chosen on the New quote form was thrown away
  after naming the quotation, so a quotation with no matter and no case-type fee
  line had no kind of work recorded anywhere and printed with none of its
  clauses. All three are now recorded and all three are read.

- **Converting an inquiry still named the matter after its own description.**
  The third place that did this; the other two were corrected on 8 September and
  this one was missed, because the test guarding the rule only read the file
  that had been fixed. It reads all three now.

## 1.16.1 — 8 September 2026

### Fixed
- **A new security advisory was blocking every deploy.** `sharp`, an image
  library the local development runtime pulls in, was found to have two
  vulnerabilities in the image decoder it uses. Nothing here calls it and it
  never reaches the live register — it is a development tool — but the rule is
  that nothing deploys with a known high-severity advisory anywhere in the
  dependency tree, and the rule is right to be blunt about it.

  Wrangler is updated and `sharp` is pinned to the patched version. The register
  itself is unchanged.

## 1.16.0 — 8 September 2026

### Changed
- **Incoming opens on the Inbox, and the Inbox tab comes first.** Asked for:
  *"move the Inbox before the Inquiries and default it to Inbox."* The figures
  agree — 122 pieces have come through the inbox against 4 open inquiries, so
  the tab you land on is now the one with the work in it. Inquiries and
  Conversations are one click away, as before.

  A role that may not triage still lands on Inquiries: `/inbox` sends it there
  rather than refusing, so the one menu entry serves both.

- **File selected and Delete selected have moved above the list, and appear
  only once something is ticked.** Asked for: *"these two buttons need to move
  up and appear only when user selects an item or items."* Below seventy
  messages they were a scroll away from the boxes they act on, which is the
  wrong way round.

  The bar now says how many are selected, and it is not there at all until one
  is. With scripting switched off it is simply always visible, exactly as it was
  — a control that exists only when a script runs is a control a blocked script
  takes away.

## 1.15.1 — 8 September 2026

### Fixed
- **Nine real names had been used as examples in the code, and are gone.** Found
  by an audit of the last two days' work, not by anything in the register.

  Six clients and three companies on your register had been used as worked
  examples — in test fixtures, in migration comments, on the Help page, in this
  changelog and in commit messages. Every one of them looked like an invented
  name, which is exactly the difficulty: a plausible name is what a real name
  looks like. They have been replaced with names checked against the register
  first, and a test now fails if any of the nine comes back.

  **The commit messages cannot be cleaned the same way.** Rewriting them means
  rewriting published history on a protected branch, which is a decision for the
  practice rather than something to do quietly.

  The rule this broke was already written down, which is the part worth saying
  plainly: it is recorded in the mistakes ledger as having happened twice
  before.

## 1.15.0 — 8 September 2026

### Fixed
- **The matter's summary was the file note over again.** Reported on looking at
  a matter the assistant had just opened: *"the summary and the note are
  identical - this should not be the case - it does need to be a summary. for
  full details i can go to notes or ask the ai to read this file and brief me."*

  Quite right. One field was being written into both places, so the Summary card
  at the top of a matter held three pages of prose — identical to the file note
  directly beneath it, and pushing everything else off the screen.

  They are two things now and the assistant returns both: a **summary** of at
  most four sentences — who this is for, what they are applying for, and the one
  thing that decides it — and a **file note** carrying the whole of what the
  document said. The note is append-only and is the record; the summary heads
  the matter and is read at a glance. The check-it form has a box for each.

  Matters opened before today keep the long text in both places. The summary is
  editable on the matter; the note is not, and should not be.

- **Quotes and Invoices sit together on a matter, quotes first.** Asked: *"why
  do i see quotes in the right side line? why is it not with invoices? above
  them. good reason exists?"* None did — they were in different columns for no
  reason anybody had recorded. They are one subject read in one order: a
  quotation is what a matter is billed from, an invoice is what came of it.

## 1.14.0 — 8 September 2026

### Changed
- **A quotation is now named, not described.** Asked on looking at the New quote
  form: *"this field called Scope seems superfluous. why do i need to enter
  details in it when that will be in the quotation?"*

  Half right, and the halves are worth separating. The *paragraph* it printed on
  the quotation was superfluous — the items are the scope, and a sentence beside
  them can only repeat them or disagree with them. That section is gone, and the
  name now heads the document as **Re**, the way a letter's subject line does.

  But the value itself is the quotation's **name**: the quotes list, the quote's
  own heading, the dashboard, search, the expiry alert, the email subject, the
  invoice raised from it and the bulk export all read it. So it stays — and
  stops being typed. It is composed the same way a matter's name is: **a visa
  type, an optional word or two, and the client**, giving *"VV. Parent
  Grandparent — Larisa MIKHAILOVA"*. Type first, so sorting by name still groups by
  kind of work.

  The New quote form can also be pointed at a **matter** now. Choose one and the
  quotation takes its name, its type and its client from the matter — so a
  quotation can no longer name one person and bill another.

- **One list of the work the practice does.** Asked a moment later: *"the field
  From the catalogue — where does it feed from? ... quotation is for precisely
  visa types or case types we are working on so why not?"* and *"these two lists
  may create confusion — should they not be the same?"*

  They should. The catalogue held a **copy** of the case types made once by
  hand: 67 of its 74 rows were a name the register already had, none of them
  carried a price, and the copy had already drifted — **two live case types had
  no catalogue row**, one of them the very work being quoted when the question
  was asked. The case types are now read straight from the vocabulary, so a type
  added under Settings → Vocabulary is quotable the same minute.

  Not merged both ways, deliberately. The seven rows that stay are two fee items
  and five disbursements — Police certificate, Translation, Immigration New
  Zealand fee and levy and so on. Those are things you charge for, not kinds of
  matter, and offering them when opening a new matter would be wrong.

### Fixed
- **The letter of engagement was silently dropping its work-specific clauses**
  on any quotation not attached to a matter — which is all five of them. The
  clauses are chosen by the kind of work, and the quotation's lines were
  carrying a catalogue id (`svc_t_vv_partner`) where the clause list holds the
  vocabulary's own key (`vv_partner`). They could never match. The duplication
  above was the cause, so the same change fixes it.

## 1.13.0 — 8 September 2026

### Added
- **Two more ways to say who somebody is on a matter: Partner, and Family
  member.** Asked for while looking at the assistant's intake screen: *"someone
  who is partner but not party to the application, not a supporting partner,
  just partner"*, and then *"and one more — Family member"*.

  The list had only **Supporting partner**, which means something narrower than
  it looks: the partner an application actually turns on, whose relationship
  Immigration New Zealand will assess. A partner who is simply on the file, and
  a parent or sibling named in the documents, had nowhere to go but "Other
  party" — which loses the one fact the role exists to record.

  So there are now three, and they sit next to each other in the list because
  choosing between them is the point:

  | Role | What it means |
  |---|---|
  | Supporting partner | The application turns on this relationship, and INZ will assess it |
  | Partner | The applicant's partner. Not applying, not relied on |
  | Family member | Any other relative in the same position |

  The assistant can propose them too, and is told the difference: where a
  document does not show the relationship is being relied on, it takes the
  weaker of the two, because a person correcting it can see the document and it
  cannot.

## 1.12.0 — 8 September 2026

### Added
- **Every client carries their own INZ client number.** Asked for urgently:
  *"every individual client must have INZ Client Number - implement for all now
  please."* There was no column for it on a client at all. It lived on the
  matter, so the same person's number was typed again on every file they had —
  and the bulk export already gave the game away, reassembling a client's number
  by collecting the distinct values off their matters. A value that has to be
  reassembled from four rows has the wrong owner.

  INZ issues one client number per person and it does not change, so it now
  lives on the person: entered on their page, read from there by every matter,
  and searchable, so a letter quoting nothing but a client number finds the
  file. The matter form no longer offers a box for it.
  `inz_application_number` genuinely is per-application and stays where it is.

- **Alerts lists everybody still missing one.** The instruction cannot be a
  column that refuses to be empty — a first-time applicant has no number until
  INZ issues one, and a database refusing such a record would turn "every client
  must have one" into "no new client may be entered". So it is a list that can
  be worked through: every individual with a live matter and no number, clearing
  as each is entered.

### Changed
- **The database now refuses a client number that is not one.** Six to twelve
  digits and nothing else, so "N/A" and a pasted line of a letter cannot become
  one, and no two clients may hold the same number — which is how the same
  person entered twice gets caught. Typed with the spaces it is read aloud in,
  it is stored without them.

### Fixed
- Migration 0073 carried 64 of the 67 numbers in the register across. **Three
  could not be, and are flagged on the file rather than guessed at:** two
  clients whose own matters disagree, and two records sharing one number, which
  turn out to be one person entered twice. Every number that could not be
  carried is written into an append-only file note first, so nothing was lost.

## 1.11.0 — 8 September 2026

### Added
- **Tags on clients.** Matters have had tags since the register was built and
  clients never did, for no reason anybody recorded. A client page now has a
  Tags card, the client list filters by tag and shows each row's tags, and the
  tag list itself is shared with matters — a tag invented on a matter is the
  same tag on a client, so there is one list to keep in order rather than two.

  The tag counts shown in the picker now count clients as well as matters. They
  counted matters alone, which would have shown a tag used on forty clients as
  "(0)" — and a tag that looks unused is a tag somebody deletes.

  `case_tags` and `client_tags` are the same join written twice. One table keyed
  on the kind of record is the better shape and is recorded in the pipeline as
  its own change, deliberately not folded into this one.

### Changed
- **Writing an email is laid out as a mail client lays it out.** The quotation
  email screen was on the ordinary three-column form grid — right for entering a
  client's details, wrong for writing a message. To sat in one column, Copy to
  and the message in a second, the subject in a third, and the formatting
  buttons floated away from the box they act on.

  It is now one column: the addresses stacked at the top with their labels
  beside them, the subject under those, then the message filling the width with
  its toolbar attached to it, the buttons below, and the explanation of
  *Formatted* folded away under them rather than sitting between the writer and
  the box.

- **To and Copy to take several addresses**, separated by commas or semicolons.
  Duplicates are dropped. One address that is not an address refuses the whole
  list rather than being quietly skipped: a message the practice believes went
  to three people and went to two is worse than one that did not send.

## 1.10.0 — 8 September 2026

### Added
- **The letter of engagement.** A quotation now carries a mandatory choice when
  it is made — does this go out with a letter? — and where the answer is yes,
  there is a letter to read, print and send.

  The letter states **no parties, no scope and no fees**. Those are the
  quotation's, and the letter refers to it: *"These are set out in quotation
  Q-0001, which accompanies this letter and forms part of it."* A covering
  letter that restates a fee schedule is a document that can disagree with its
  own attachment.

  What it carries instead: who it is to, the practice's own opening, the clauses
  that belong on this kind of matter, the terms of engagement, what the client
  confirms by accepting, and a signature.

  The choice has no default and cannot be skipped. A letter must never be
  omitted by oversight, nor sent by one.

### Fixed
- **Every document page was being printed in a 400-pixel column.** The layout
  used for pages with no navigation — the sign-in screens, and also the
  quotation, the invoice and now the letter — capped itself at the width of a
  sign-in card. So a quotation on a laptop screen was set in a narrow ribbon
  down the middle, and had been since the print view was built. Found by opening
  the new letter in a browser.

- **Three buttons under a document no longer scroll it sideways on a phone.**
  The row had two and gained a third; 468 pixels of buttons in a 390-pixel
  window moved the whole page.

## 1.9.0 — 8 September 2026

### Added
- **The assistant now fills in everything it read, not a subset of it.** Asked
  for: *"the assistant should be populating all the known details it extracted
  from the brief for the client and case, including contacts and other details —
  as seen in the respective pages for clients and cases."*

  The gap was at both ends. Some of it was never extracted; some of it was
  extracted and then had nowhere to go — the reading found the employer's
  registered office on the first page of the employment agreement and this form
  had no box for it, so it was typed again from the same document.

  Now read and offered: **an address** for every party, **a company's NZBN**,
  and **what the document says happens next** on the matter, alongside its
  priority and a date for it. An NZBN is tidied and checked before it is stored
  — read off a document it can arrive spaced or simply not be one, and stored as
  read it is refused the first time somebody opens the record, which is a worse
  place to find out.

  For a client already on the register, every one of these fills a box the
  record has left empty and never writes over one it has. That rule has not
  changed; it now covers everything rather than the visa alone.

  Passport numbers stay out, as they always have: extracting one would write it
  into the run log on the way past.

## 1.8.0 — 8 September 2026

### Added
- **The assistant now recognises everybody it has seen before, not just the
  client.** Reported with a screenshot of two HARBOURSIDE PROTEINS LIMITEDs
  forty minutes apart: *"the assistant just created a duplicate organisation.
  Does it check if it already exists??? Same needs to be true for clients so as
  to avoid duplication."*

  It did not check, for two separate reasons.

  **A company could never match.** The name test wanted a given name and a
  family name to agree, and a company has one name in one field — so no
  employer ever matched anything, on any reading. A whole company name matching
  exactly is not the coincidence a shared surname is: it is the same company.

  **Only the client was ever looked for.** Every other person a reading named —
  the employer, the partner, the adviser — was created afresh on every reading,
  however many times they were already on the register.

  Each person the reading names now carries the same choice the client has:
  *use the record already there*, or *create a new one*. Keeping the existing
  record leaves it untouched, fills in only what it had left empty, and links it
  to the matter.

### Fixed
- **Given names are recorded in ordinary case: Van Hung, not VAN HUNG.** Asked
  for, and the mirror of the surname rule. A passport prints the whole name in
  capitals and so does an INZ letter, so everything the assistant reads arrives
  shouted end to end — and capitalising only the family name is what makes it
  legible at a glance which half is which. "Thi Kim Oanh DOAN" tells you;
  "THI KIM OANH DOAN" does not.

  Only a name entirely in one case is touched. *McKenzie*, *de Jong*,
  *Anne-Marie* and *d'Angelo* are decisions somebody made, and re-casing them
  would be the register inventing a style the person did not use.

## 1.7.2 — 8 September 2026

### Fixed
- **A client record the assistant reuses is put into the house style.** Reported:
  *"case CASE-26-210 was just created through the assistant and the surname was
  not capitalised, I did it manually."*

  The assistant had not failed to capitalise anything — it matched an existing
  client, correctly, and used that record as it stood. The record had been
  loaded on 1 September, before the rule reached it. Every one of those 34 was
  corrected minutes later by the repair in 1.7.1, so that record is right now.

  What was not fixed by a repair is the hole it came through: **the register
  never tidied a record it merely reused.** Another load or import and the same
  thing happens again, and the matter named from that record carries the old
  spelling into every list. Opening a matter onto an existing client now puts
  that client's surname into capitals, renames their matters to match, and
  writes a line on their file saying so. It is a house-style correction and not
  a change of fact — `LE` and `Le` are the same surname, which is why it is safe
  to do without asking.

## 1.7.1 — 8 September 2026

### Fixed
- **Every family name is in capitals, including the older records.** Asked for
  directly. Saving a client has capitalised the surname for a long time — all
  five places that create one do it — but 34 of the 211 people on the register
  were loaded before that rule reached them, and nothing revisits a record
  nobody opens. Those 34 are corrected, and the matters named after them follow.
  Companies are left exactly as they are: a registered name is copied from the
  register that holds it, not restyled.

- **An invisible carriage return has been taken out of 190 matter names.** This
  morning's renaming read the case-type list with a database function that
  strips spaces and *only* spaces; the list is saved from a browser, so every
  label came through with a line ending still attached — `RV. Partner⏎ —
  BUI, DUC MANH`.

  Nothing showed it: that character is invisible on a web page. It was in the
  CSV export, in searches, and would have been in the letter of engagement. The
  register's own reader was never wrong, so only the copy of that rule written
  in SQL was — and the tests guarding it all passed because their sample list
  used tidier line endings than the real one. That is now recorded as a fault
  in its own right, and the test uses the line endings the setting actually has.

## 1.7.0 — 8 September 2026

### Added
- **A company read out of a document is created as a company.** Reported by the
  practice after opening a matter from a Peak Seasonal Work Visa file: *"I
  cannot even ensure that the employer company IS A COMPANY and not an
  individual — how come??"*

  Because every party the assistant proposed was created as an individual — the
  word was hard-coded. So HARBOURSIDE PROTEINS LIMITED arrived on the register
  as a person with a very long family name, with no way to say otherwise on the
  form, and the only remedy was to notice afterwards and edit the record.

  The reading now says which each party is, and the form has a **Person or
  company** box on every one of them, so it can be corrected before anything is
  written. A company gets no date of birth, nationality or visa, whatever the
  boxes carried. Its registered name is kept as written rather than shouted,
  which is what the client form has always done.

- **Who to ring at the company.** The other half of the same report: *"for a
  company I need a contact person's name as well, or at least be able to link a
  name from clients/contacts."* Every party now has a **Works for** box — or
  **Main contact there**, for a company — offering the other people named in the
  same reading and every organisation already on the register.

  Choosing one writes both directions: the company records who to ring, and the
  person records where they work and what they do there. Those columns have
  existed since migration 0008 and nothing on this form could reach them.

### Fixed
- **A matter opened by the assistant is named the way every other matter is
  named.** The naming fix in 1.4.1 corrected the New matter form and missed this
  route, which was writing the description into the name as well — carrying a
  comment claiming that was done "from one place", which it was not. Both now
  compose the name from the same function.

## 1.6.0 — 8 September 2026

### Added
- **The assistant keeps the file it read, and puts it on the matter.** Reported
  by the practice, who noticed the notice: *"I think the notice to the right is
  outdated — and we should be storing the files for the cases and clients it
  proposes to create."*

  They were right on both counts. "Open a matter from what you already have"
  read an upload, opened a matter from it, and dropped the document — the IEA
  letter, the job token, the decision letter. The page explained why: there was
  nowhere to keep it until file storage was switched on. **Storage was switched
  on on 29 August**, and five documents had been stored through it since. The
  sentence had been untrue for ten days, and nothing checks a claim written on a
  page.

  Now: the upload is stored the moment it is read, the review page lists what is
  about to go on the file, and pressing **Open the matter** puts it there — the
  same file, not a copy. Read something and never press the button, and the copy
  is deleted a week later, because a client's document sitting in storage with
  nothing pointing at it is not something to keep by accident.

  The file has to wait in between because at the moment of reading there is
  nothing to attach it to: the client and the matter do not exist until the
  press. That waiting room is what the register now has, and what the nightly
  housekeeping clears.

  The stored type is what the bytes say rather than what the browser claimed —
  a Word document usually arrives claiming nothing at all, and a file stored
  under a type it is not is a file that is handed back wrongly one day.

## 1.5.0 — 8 September 2026

### Added
- **Where the letter of engagement keeps the words it says every time.** The
  first half of the letter work, and it is configuration rather than a
  document: nothing is sent yet.

  The practice settled the shape of it: **the letter states no parties, no
  scope and no fees.** Those are the quotation's, and the letter refers to the
  quotation rather than repeating it — a covering letter that restates a fee
  schedule is a document that can disagree with its own attachment.

  What is left divides in two. **Settings → Letter of engagement** holds the
  frame: how the letter opens, what the client confirms when they accept, how
  it closes and who signs it. **Quotes → Letter clauses** holds the body — the
  headed sections, in your order, each of which can be limited to certain kinds
  of matter, so the partnership assessment does not appear on an employer
  accreditation.

  Nothing is supplied. The register ships no wording for a contract between a
  lawyer and a client: a letter carrying terms the register invented would be
  worse than one that went out empty, because the empty one is obvious.

  A clause is switched off, never deleted — one withdrawn from new letters must
  not vanish from the letters already sent. Only an administrator can edit
  them: writing a quotation is daily work, rewriting the terms a client accepts
  is not.

### Fixed
- **Tick boxes on three forms had no styling behind them at all.** The class was
  written on the quotation's people list and on the new clause editor, and no
  rule existed for it, so the box was drawn at the right size and its words fell
  underneath it. An unstyled class is invisible in a diff and looks fine until
  somebody opens the page.

- **The wording about the terms of engagement was half wrong, and is corrected.**
  1.2.2 changed "download the terms" to "read the terms" on the reasoning that
  they are a page rather than a file. The practice pointed out what is actually
  at that address: a page whose only content is a button that downloads the
  current edition. So neither word alone is honest, and the quote and its
  covering email now say the address is where the current edition is published.

## 1.4.1 — 8 September 2026

### Fixed
- **A matter is named again, instead of being described twice.** Reported by
  the practice from the dashboard: *"when narrowing the window the text is
  hiding"*, and the matter names were *"too long — not acceptable"*.

  Two faults, one cause. The New matter form asked one question — what the
  matter is about — and wrote the answer into both the name and the
  description. Measured before fixing it: **194 matters, all 194 with the two
  identical**, averaging 84 characters, 161 of them over sixty. So every list
  that showed a matter's name and its description showed the same sentence
  twice, and then ran out of room for the reference and why the row was there.

  A matter is now named **"Partner Resident Visa — Bao Long VUONG"**, from
  its type and the person it is for, and the description you wrote is the line
  underneath. Nobody has to rename anything: migration 0066 rebuilds the names
  of the matters already in the register and does not touch one word of the
  descriptions. A matter you named yourself is left alone.

  The name follows what it is made of: correcting a client's spelling renames
  their matters, and the change is noted on the client's file. That is the
  drift that caused this in the first place — a name that stops matching the
  record it names.

- **The people on a quotation are printed on it.** They could be recorded but
  the document did not say them, which would have left the letter of engagement
  referring to a quotation that named nobody. The printed quotation now has a
  "The parties" section: the lawyer, the client, the applicants and associated
  parties with their relationship and date of birth, who is nominated to give
  instructions, and — where there is an agency contact — what that contact may
  and may not do.

- **Nothing on the dashboard or the alerts list is cut off any more.** Rows were
  clamped to two lines, and two lines hold fewer characters as the window
  narrows — with nothing to say the rest was there. A row that needs three
  lines now takes three lines. Checked in Chromium at 390, 700, 1000 and 1400
  pixels.

## 1.4.0 — 8 September 2026

### Added
- **A quotation can name everybody the engagement is with.** It named exactly
  one person — the client. A real letter of engagement names five: the client,
  a partner, a child, and two administrative contacts at an agency. Four of
  those five had nowhere to live in the register, so they were retyped into
  Word every time.

  A quotation now carries the other applicants, the associated parties whose
  details the application needs, and the agency contacts who may be told how it
  is going. Each says what they are on the engagement, their relationship in
  the practice's own words, and their date of birth. One person may be
  nominated to instruct on everybody's behalf; when nobody is, it is the
  client, which is what the letter says by default.

  This is the first piece of the Letter of Engagement, which will name nobody
  itself: the quotation is the substance and the letter refers to it.

  The rules sit in the database rather than in the form, because acceptance
  will write these rows too and will not go through it: a party needs a name,
  an organisation has no birthday, a date of birth is a real date in the past,
  an administrative contact has an email or a phone, somebody who may not
  instruct cannot be the one nominated to instruct, and there is at most one of
  those per quotation.

## 1.3.1 — 8 September 2026

### Fixed
- **Reminder emails now open the register at the practice's own address.** The
  practice put the register on `app.immigration.kiwi`. Every link the register
  builds for itself — the nightly automation emails and reminders — was still
  built from the workers.dev name it was first deployed on, so a reminder about
  a client's deadline opened a different address to the one the practice signs
  in on. The workers.dev name still answers, deliberately: it is the way back
  in if the domain ever breaks.

## 1.3.0 — 8 September 2026

### Added
- **Several messages can be filed onto a matter or client at once.** Asked for
  directly, and the word used was critical. The post arrives in runs — six
  documents for one application land in six emails — and filing them one at a
  time meant six searches for the same matter, which is the point at which
  somebody stops filing and the matter stops being the place the file lives.

  The tick boxes that were there for deleting now do both: **File selected**
  beside **Delete selected**. Filing shows what is about to be filed, asks for
  one matter or client, and writes **a note for each message** rather than one
  note listing six — a file note is evidence of one thing that happened, and a
  summary of six is evidence of none of them. Nothing is deleted or moved: the
  messages stay in the inbox under Filed and each one can be put back.

  Both steps are POSTs, the search included, because the selection travels as
  hidden fields and two hundred message ids do not belong in a URL. The form's
  own action is the filing one and Delete carries a `formaction`, so the press
  that happens by accident — Enter in the form — is the one that writes a note
  rather than the one that destroys a message.

  A message that became an inquiry can now be selected. It can be filed; it
  still cannot be deleted, and the delete confirmation names it and leaves it
  alone. The only thing filing refuses is a message already filed, because
  notes are append-only and a second one could never be taken off.

- **"Status query" is a kind of file note**, and "Preliminary consultation" is
  now **"Consult"**. The two email kinds are no longer offered when writing a
  note by hand — a filed message still records itself as correspondence.

### Fixed
- **Lead or client is now on the first tab of the client form.** It was there
  all along, on the fifth tab under "File management", where nobody creating a
  client would look. A control you cannot find is a control you do not have.

- **A note kind the forms offered was refused by the database.** "Preliminary
  consultation" was added to the list on 1 September and could never be saved:
  the list of kinds lived in two places — the application and a database
  constraint written in migration 0002 — and only one of them grew. Anybody who
  picked it got an error instead of a note, and nobody found out for a week.

  The constraint has gone (migration 0064), which is the same decision the
  register already made for knowledge base article kinds: a list of words a
  practice uses to describe its own work is configuration, and configuration in
  a database constraint means rebuilding the table every time somebody changes
  their mind about a word. The forms still refuse anything not on the list.

  Rebuilding that table meant copying every one of the 883 file notes and
  putting the append-only guards back. The rehearsal is kept as a test, so
  every build proves the rows survive the copy and the guards still guard.
## 1.2.2 — 8 September 2026

### Fixed
- **A quote and the letter of engagement now send the client to the same
  terms.** The Letter of Engagement asks the client to confirm they have read
  the standard terms *set out online at* `www.immigration.kiwi/terms`. The
  register pointed every quote at a PDF file at a different address on the same
  site. Both were the practice's own, so nothing was broken — but a client asked
  to accept terms, who finds the quote and the letter naming two different
  documents, has been handed a question about their engagement.

  The live setting has been changed to `https://www.immigration.kiwi/terms`
  (recorded in the audit log and in `docs/operations.md`), and the address the
  register ships with is now the same one.

- **The quote no longer calls the terms a download.** Three places — the drafted
  email, the quote page and the printed quote — told the client to download
  them. They are a page on the practice's own site; a client told to download
  something that opens in a browser wonders whether they got the right thing.

## 1.2.1 — 7 September 2026

### Fixed
- **A failed reading now says what went wrong.** The practice pasted a case
  handover into Open a matter, waited 48 seconds and got six words: *"model
  returned no structured output"*. They read it as having run out of quota. It
  was not that.

  What had happened: the model was cut off part-way through writing its answer,
  because the register only allowed it 4,000 word-pieces — and the summary it is
  asked for can be 8,000 characters on its own, before the model's own reasoning
  is counted. The allowance is now 16,000, which is Anthropic's own
  recommendation for a request of this kind and well inside what every model in
  Settings permits.

  More to the point, **every way a reading can fail now says which way it was**,
  in a sentence: cut off part-way (and what to send less of), the model declined,
  the account is out of credit, the account has been asked too much too quickly
  (*"a limit on the Anthropic account, not a fault here"*), Anthropic is
  overloaded, the key was refused. The provider's own words still travel on the
  end for whoever has to work out why, along with the model that ran and the
  request id, so a run can be traced months later.

- **Certificate expiries worked out from an unconfirmed date have left "Needs
  you today".** Asked for directly: eleven rows pasted back with *"please
  suppress these"*.

  Eight of them were the same thing — a police or medical certificate whose
  expiry the register had calculated from an issue date nobody had read off the
  certificate, and which said so in its own line. Measured against the live
  register that morning, **that was every certificate alert overdue: five
  police, three medical, not one of them confirmed.**

  They are not suppressed, they are filed correctly. A date that was worked out
  cannot tell you a certificate has expired; it can only tell you nobody has
  checked. That is a different job with a different urgency, so it now has its
  own heading on the Alerts page — **Worked out, never confirmed** — with its own
  count, and it is out of the list a morning is worked from. Confirm the issue
  date on the client page and it returns as a real expiry, on the real date.

## 1.2.0 — 4 September 2026

### Added
- **A knowledge-base article can carry files.** Asked for on the New article
  page, in front of a form with a "Source link or citation" box and nowhere to
  put the PDF that box was describing: *"i must be able to add a file here, why
  not??"*

  The form now takes files — several at once, because an instruction usually
  arrives as a set — and the article itself has a Files panel to add more later,
  read them back, and remove one. Files are stored in R2 and streamed through
  the register, so every read stays inside the session and in the audit log.

  **Why it needed a new table, `kb_documents`.** The obvious move is a row in
  `documents`, and it is not available: that table restricts what a file may
  hang off to a client, matter, inquiry or quote, and SQLite can only widen that
  by rebuilding the table. Migration 0044 already established that the rebuild
  cannot be done here — D1 will not let a migration switch foreign keys off, so
  dropping `documents` fires `ON DELETE SET NULL` across `entries.document_id`,
  and the append-only trigger on file notes rightly refuses. Measured rather
  than assumed: the live register holds 5 documents and every one of them is
  referenced by a file note. Migration 0063 names the accommodation and says
  what would remove it.

  What is *not* duplicated is the part that matters for safety: how a supplied
  filename is reduced and what content type a file is served back with now live
  once, in `src/core/files.ts`, and both sets of routes call it.

- **"General practice note" as a kind of article** — the catch-all for what the
  practice does about something, as opposed to what somebody outside has
  instructed. Kinds are a setting, so a practice that has customised its own
  list adds it under Settings → Knowledge base.

### Fixed
- **File downloads keep their own security policy.** A document or an
  attachment is served with the strictest policy there is, because it came from
  outside the register — and the middleware that hardens every response was
  overwriting it with the *page* policy, which permits same-origin script. It
  now applies as a default rather than an override. The rest of the hardening
  was holding, so this was a wall behind a wall; it was still not doing what the
  code said. Fault 22 in `docs/spec/mistakes.md`.

- **The specification says what the database actually does.** `data-model.md`
  still described two tables dropped in 1.1.0 and had never heard of the one
  added in their place; `invariants.md` counted 39 refusals where there are 51.
  Both corrected, and a test now holds them against the built schema — the
  documents claimed they *could not* drift, which was a claim rather than a
  fact. Fault 23.

## 1.1.2 — 4 September 2026

### Fixed
- **The whole navigation is on the screen on a phone again.** Reported by the
  practice: *"Where are the invoices and quotes? Cannot see them on my phone.
  Shouldn't there be a separate menu called Money?"*

  There was a Money menu, and there still is — on a wide screen. On a phone the
  bar was a single strip that scrolled sideways, with no scrollbar and no fading
  edge to say so, and it stopped after *Cases*: Calendar, Tasks, Quotes,
  Invoices, Knowledge and the Assistant were all past the right-hand edge.

  Worse, the four inside a menu were not merely off the edge. The menus were
  flattened into the strip with `display: contents` so their items would sit in
  the run — but a browser renders nothing inside a *closed* `<details>` whatever
  its display says, so those four links were never drawn at all. Two tests
  guarded this and both passed, because both asserted what the stylesheet said
  rather than what the page did. Written up as faults 20 and 21 in
  `docs/spec/mistakes.md`.

  The bar now wraps onto a second row instead of scrolling, and keeps its Money
  and Tools menus, which open into the bar rather than over it. All nine
  sections are on the screen at 360px and up; at 320px it takes a third row.

- **The bar's stated height matches the bar.** `--topbar-h` tells sticky table
  headings where to stop. The bar had gained a row at two breakpoints since it
  was last measured, so every one of its figures was wrong — on a phone a
  sticky column heading sat 27px behind the bar. Re-measured in Chromium at
  every breakpoint, and the test now pins the one thing that can be checked
  without a browser: a bar that wraps can only get taller as the screen narrows,
  so the number may never fall.

- **The Invoices pages highlighted *Quotes* in the menu**, left over from when
  an invoice could only be reached through a quote. On a phone, where the menu
  opens into the bar, that put the highlight on the wrong word directly beside
  the right one.

## 1.1.1 — 4 September 2026

### Fixed
- **The demonstration seed works again.** It had rotted in four separate ways,
  none of them noticed because nothing had ever run it: a column dropped a
  fortnight ago, country names where the database now insists on ISO codes, no
  owner on a matter (which a trigger has long refused), and writes to the two
  fee tables removed yesterday. Each would have surfaced the first time somebody
  set up a demonstration — which is the worst moment to find out.

  It now runs as part of the test suite, against every migration with the
  triggers on, so it cannot rot silently again.

- **Demonstration data can be taken out again.** Running the removal script
  rather than reading it turned up a real fault: an issued invoice's lines could
  not be deleted even when they were demonstration rows, because `invoice_items`
  was missing the exemption that invoices and payments both carry. A register
  holding real client files cannot also hold demonstration records nobody can
  remove.

### Removed
- **Dead encryption code** (`sealField` / `unsealField`), unused since the
  practice decided in August that passport numbers are stored as written. They
  still stay out of bulk exports, which is the control that actually matters.

## 1.1.0 — 4 September 2026

### Changed
- **Money lives in quotes and invoices. There is no third place.** Asked
  directly: *"why do we need fees section at all?? should there just be quotes
  and invoices… why complicate things??"*

  There was no good answer. The register held 3 fee lines across 2 matters and
  no invoices at all — a whole section, three tables and a module, for three
  lines, while the invoice machinery that does the same job properly sat unused
  because the only way to reach it was to write a quote first.

  **The Fees section is gone.** A matter now shows **Invoices**: what has been
  billed on it, what is paid, what is outstanding, and a button to raise one.
  Quotes keep their own card, as before.

  Nothing was migrated, on instruction. The fee lines and the 42 splits were
  written out to a file first and then dropped.

### Added
- **A bill can be divided, on the invoice, behind a control that opens when you
  want it.** Asked for exactly that way: *"the bill split should be a button
  that opens the options… good if they are available but not always visible."*

  It divides professional fees only, GST-exclusive, by default — a disbursement
  is money passed through on the client's behalf, and apportioning an INZ fee
  would hand somebody a share of INZ's money. The base is a setting.

  A split is set while the invoice is a draft and freezes with it. If there is
  one, it has to come to 100% before the invoice can be issued — the database
  refuses otherwise, so it holds whatever writes the row. Most bills are not
  split, and that stays the easy path: no split at all issues freely.

- **Choosing from the price list works on an invoice with scripting off.** That
  guarantee was written for the Fees panel and came across with the money. A
  price list only reachable by script is a price list this register could not
  offer, since it runs with no script at all. What you type still wins over what
  the list says, so a fee that differs on a particular matter is yours to
  change.

### Fixed
- **An invoice and a quote must say what they are for.** Both descriptions were
  `NOT NULL`, which permits an empty string — the application refused one in two
  places and the database did not. Now it does.

## 1.0.3 — 4 September 2026

### Added
- **An invoice can be raised on its own.** Until now the only way to bill
  anything was to write a quote first and convert it — a fair description of how
  the work usually goes and a poor description of the times it does not. An hour
  of advice given and charged for needs a bill, not an offer followed by a bill.

  **Invoices → New invoice.** Choose the client, optionally a matter of theirs,
  say what it is for, and it starts as a draft. The lines go on next and nothing
  is fixed until it is issued — from that moment the database stops accepting
  changes, exactly as for an invoice raised from a quote.

  It refuses two things outright: an invoice addressed to nobody (a quote may sit
  against an inquiry that is not a client yet; a demand may not), and a matter
  belonging to a different client — the kind of mistake nobody spots until they
  go looking for the money.

  Part payments needed nothing built. An invoice has always taken as many
  payments as you like, each with a date, method and reference, and none of them
  can be edited or deleted afterwards — a wrong amount is corrected by a further
  entry.

## 1.0.2 — 4 September 2026

### Fixed
- **A dependency check that failed on a bad night rather than on a
  vulnerability.** Four builds went red on 3–4 September because npm's own
  registry was returning 503 — each after minutes of retries, and each time the
  very same commit passed the very same step on a parallel run. The practice was
  told twice that a run had failed, about something that had nothing to do with
  the code, and two merges were held up behind it.

  `npm audit` exits non-zero for two quite different reasons: a dependency
  carries an advisory, or npm could not be reached. Those are now told apart.
  A high or critical advisory stops the build exactly as before — nothing is
  skipped because it is inconvenient. An unreachable registry is retried three
  times and then reported, in a banner nobody can miss, as **did not run**:
  not a pass, because nothing was checked, but not a failure of this code
  either.

### Added
- **A prompt for turning a working conversation into a file note**
  (`docs/case-note-prompt.md`). The practice works cases with Claude, and some
  conversations end up knowing a great deal about a matter. Paste the prompt at
  the end of one and it produces three things: a file note written as a lawyer
  would write it, the register's own fields for the facts that were actually
  settled, and — the part worth reading first — a list of what is missing,
  uncertain, or worked out rather than read.

  It carries the practice's case types and statuses inside it, so it works in a
  conversation with no access to anything. And it proposes: the intake tool
  reads it and shows every field for checking, and nothing is written until
  somebody presses the button.

## 1.0.1 — 4 September 2026

### Changed
- **One word for one thing: file notes.** The practice, looking at a client
  page: *"Timeline section — what is that? is it the File Notes section? this is
  confusing."*

  It was, and the register was disagreeing with itself. The matter page called
  the panel **File notes**, search results grouped hits under **File notes** —
  while the client, inquiry and quote pages called the same panel **Timeline**,
  with a button reading "Add to timeline". They all say File notes now, and the
  button says "Add a note".

  The table underneath holds more than notes — calls, emails, system lines — so
  "Timeline" was accurate. It was also not what a practice calls the running
  record on a file, which is the only thing that matters here.

### Added
- **"File note" as a document category**, so a note written up as a file can be
  filed as one. Note that the categories are a list an administrator edits under
  Settings, so a register whose list has already been changed keeps its own —
  this one has been added to the practice's list directly.

## 1.0.0 — 4 September 2026

### Fixed
- **A matter that says it was decided now carries the date it was decided.** The
  practice entered a newly granted matter and found the file saying "Decided —"
  beside a status of Approved. Both had been written by the same press, and they
  disagreed.

  The rule existed — in the status-change handler, which stamps the date when a
  matter moves to Approved or Declined. What it did not cover was a matter
  *entered* at one of those statuses through the intake tool, which accepts any
  status and never wrote the column. There was no field anywhere through which a
  person could write it either, so nothing could be corrected.

  **Nine matters in the register are in that state** — seven approved, two
  declined — and every one has been raising a contradiction alert nobody could
  act on. They are left exactly as they are rather than stamped with today's
  date, which would be a worse record than an honest blank; they are named on
  the alerts page one by one, and can now be filled in.

  The database keeps the rule now, so it holds whatever writes the row — the
  create form, the status card, the intake tool, a bulk load, or a statement run
  by hand. It fills a blank and never corrects one.

- **"Decided on" is a field you can type.** On the matter form, beside the
  lodgement date. Use it when a decision arrived before the file reached the
  register, or to correct a date the status button stamped as today.

### Changed
- **The Key details panel says what happened, not just when.** Asked for
  directly: *"Decided there does not say much — it is either approved or
  declined."*

  - **Decision** now names the outcome and the date together — "Approved · 04
    Sept 2026" — and adds the recorded outcome when it says more than the status
    already does. An undecided matter shows its **Status** instead.
  - **Due** appears only while something is still awaited. On a decided matter a
    date under "Due" read as a missed deadline.
  - **Took** / **Waiting** is new: how long INZ held it, or has held it — counted
    from lodgement, which is when the waiting starts.
  - **Priority** appears only when it is not Normal. A row that says the same
    thing on every matter is a row that says nothing.

## 0.99.3 — 4 September 2026

### Fixed
- **Column widths that were being silently ignored.** Noticed on the inbox: the
  tick-box column was taking a sixth of the table for a box 16 pixels wide.

  A column width has to be written as a CSS class, because the content policy
  forbids an inline style. That is fine until a table asks for a width nobody
  wrote a class for — then the `<col>` carries a class matching nothing, the
  browser sizes that column itself, and under a fixed table layout it takes an
  equal share of whatever is left. Nothing warns and nothing fails.

  **Eleven of the register's seventeen tables were asking for at least one width
  that did not exist** — the inbox, the alerts list, the case list, both client
  lists, the conversations list, three money tables, the workflow list and the
  export preview. Every whole percent is now written out rather than the handful
  somebody happened to need, so those tables get the proportions they were
  always asking for.

  A test now fails if any width used anywhere in the application has no matching
  class, so the silent version of this cannot come back.

- **A tick-box column is now the width of a tick box**, not a share of the
  table. A share was the wrong tool for it: 4% of a wide screen is far more than
  a checkbox needs and 4% of a narrow one is less. Affects the inbox and the
  "Finished with?" client list.

## 0.99.2 — 3 September 2026

### Changed
- **Choosing a look is now the whole action.** The appearance card made you pick
  a theme and then press Save — two decisions where there is only one, and in
  between, a theme you had chosen and could not see. The practice compared it
  with another of their applications, where a theme is simply selected and is
  working right away, and asked for the same here.

  Press a palette and the page you land on is drawn in it. Same for light and
  dark. There is no Save button, because there is nothing left to save.

  With no script on any page, "applies at once" has to mean the press *is* the
  submit — so each option is its own submit button carrying its own name and
  value. The browser sends only the button pressed, which is why one form
  serves twelve choices and why pressing a theme leaves your light/dark choice
  exactly as it was. The one in use is marked three ways over — a ring, a filled
  tick, and `aria-pressed` for a screen reader — because this is the one card in
  the register where the colours are the subject and a colour difference alone
  will not do.

  Still saved against your account rather than in the browser, so it follows you
  to any device you sign in from.

## 0.99.1 — 3 September 2026

### Changed
- **The calendar's controls, rearranged.** The views now read **Week, Month,
  Year** — shortest span first, so the row is one scale opening out rather than
  an arbitrary order.

  The button that used to float on the far right, named for whatever period was
  on screen ("This month", "This week", "This year"), has gone. In its place a
  single **Today** sits with the three views, where the rest of the calendar's
  controls are. It lands on whichever period contains today *in the view you
  are already in*, and keeps your filters and the Everyone/Mine choice.

  Today is deliberately never highlighted as the current tab: it is a jump, not
  a view. An earlier note here argued that "Today" would be read as the day
  rather than the period, which is why the button was named for the period
  instead — the practice asked for it back with the group, and the convention
  every other calendar follows settles it.

  The tests for that row read the page as it is drawn rather than the source
  that draws it, for the reason recorded in `docs/spec/mistakes.md`.

## 0.99.0 — 3 September 2026

### Added
- **A way to find the clients the practice has finished with, and archive them
  together.** Raised by the practice: *"some of the visa expiries we cannot
  handle — as the clients move on."* An expired visa on somebody who left the
  country two years ago goes on raising an alert for ever, and there was no way
  to say so except one client at a time.

  A fifth view on Clients, **Finished with?**, which appears only when there is
  somebody in it. Three things have to be true together, and all three are
  needed:

  1. **No live matter** — not merely no open case, but nothing at any working
     status. A matter still being prepared means the person is here.
  2. **At least one expired document** — otherwise a client taken on this
     morning, with nothing on file yet, is proposed on their first day.
  3. **Nothing still in date** — a passport good until 2029 says somebody
     expects to use it. One live document keeps a person off the list.

  Documents means all three kinds that carry a date: the current visa, a
  passport still held, and a certificate.

  Archiving is a status change, not a deletion: the file, the matters, the notes
  and the history all stay, and changing the status back brings everything with
  it. Each client archived gets the same note on the file and the same audit row
  that archiving them by hand would have written, marked as part of a batch.

  Two steps, both a page rather than a dialog, because the register works with
  scripting switched off. Between them the list is read again from the database
  — somebody may have opened a matter for one of them since the page was drawn,
  and the person pressing the button cannot see that.

## 0.98.0 — 3 September 2026

### Added
- **A week and a year view on the calendar**, alongside the month.

  **The week** is one column a day, and each column is deep enough to show
  everything on that day rather than "+4 more" — which is the whole reason to
  open a week rather than a month. It is named for what it spans, and says both
  months or both years when it crosses one: *31 August – 6 September 2026*,
  *28 December 2026 – 3 January 2027*.

  **The year** is twelve small months. Too small for titles, so a day carries
  only whether anything falls on it, coloured by the **loudest** thing there —
  a day with a deadline and a circular on it is a day with a deadline on it.
  Every month name is a link into that month, and every marked day a link into
  that day.

  All three draw the same events from the same collector; they differ only in
  the range they ask for and how they draw it. Every anchor is carried between
  them, so switching from a week in March to the month view lands on March
  rather than on today. Filters, "Mine" and the agenda work identically in all
  three.

  The week arithmetic is tested where it is easy to get wrong: a **Sunday
  belongs to the week that began six days earlier**, not the one starting
  tomorrow — a mistake that is wrong for exactly one day in seven, which is how
  it survives a casual check. Weeks crossing a month, a year and a leap day are
  all checked for seven consecutive days with no gap.

### Changed
- **How far back the unbilled-work alert looks is now a list rather than a
  number**: off, 30, 60, 90, 120, 150, 200 days, or a year. The useful settings
  are a handful of round periods, and a box that accepts 37 invites a decision
  nobody wanted to make. Widen it as the fees on file get more complete.

## 0.97.0 — 3 September 2026

### Changed
- **Every dashboard card sorts by any of its columns now.** Click a heading to
  sort by it, click again to reverse — on *Needs you today*, *Deadlines* and *My
  open cases*.

  The two whole-card orderings added in 0.95.0 were not enough, and the practice
  said so: *"nothing really changes when switching."* Both were by date, so a
  visa expiry five hundred days overdue led the list either way. What was wanted
  was the ordinary thing a table does.

  One helper serves all three, because three implementations of "click to sort"
  drift into three behaviours — and the one that drifts is always the second
  click. Each card keeps its own place in the address, so sorting Deadlines
  never resets Needs you today. Rows with nothing in the sorted column go last
  in **either** direction: a matter with no next action is not the most pressing
  thing on the list, and reversing should not promote the rows that say nothing.

### Added
- **An alert for work finished with nothing charged for it.** The practice
  asked for it plainly: *"do not want to miss payments for work done."*

  **The window is what makes it usable, and it was measured before it was
  written.** Counted against production: **135** finished matters have no fee,
  no invoice and no agreed fee — because the register was loaded from an archive
  of matters already dealt with, and because fees are entered by hand. An alert
  firing 135 times on the first morning is not an alert; it is a screen nobody
  reads again.

  Two settings narrow it. **How far back to look** (90 days) — older than that
  is history, not a missed payment. **How long to leave it** (14 days) — a
  matter decided yesterday has not been forgotten, it has not been billed *yet*,
  and being nagged on the day is how a page stops being read. Against the same
  data those two turn 135 into **six**, which is a morning's work rather than a
  wall. Set the look-back to 0 to switch it off.

  "Charged for" is read broadly on purpose: a fee line, an invoice, or an agreed
  fee on the matter all count. The practice records money in more than one place
  and the question is whether it was *dealt with*, not whether a particular row
  exists.

## 0.96.0 — 3 September 2026

### Added
- **A calendar.** A month at a glance, an agenda beneath it, and any single day
  on its own — over the dates the register already owns.

  On it: decision deadlines, tasks, visa, passport and certificate expiries,
  invoices due, quotes running out and warnings about to lapse — and, which the
  Alerts page never showed, **what has already happened**: when a matter was
  lodged, and when it was decided. A calendar that cannot show last month is
  half a calendar.

  **It holds nothing of its own.** The practice decided against appointments, so
  every entry belongs to a record and is changed on that record — moving a visa
  expiry on a calendar would not change when the visa expires. Guarded rather
  than intended: a test walks both files for any write statement and fails on
  one, and asserts there is no `appointments` table and no `POST` route.

  **The legend is the filter.** One row of keys under the month, each with a
  colour and this month's count; click a key and that kind comes off the month.
  Not a legend nobody reads beside a filter nobody finds.

  **Everyone or Mine.** "Mine" narrows to matters and tasks assigned to you.
  Client dates — visas, passports, certificates — belong to a client rather than
  a member of staff, so they step aside in that view rather than being listed
  under somebody's name. This is the seed of the per-user calendars the practice
  asked to keep possible: a filter value, not a second page.

  **Modular by construction.** Each kind of date is a source in a registry — a
  label, a colour, and a function returning events between two dates. Adding a
  new kind is one entry in that list, not an edit to a query eleven things
  depend on. A source that fails is dropped and logged rather than taking the
  page down: a calendar missing one kind of date is still a calendar, and a
  blank page is not.

  **No script at all.** Every control is a link — months, filters, days — which
  the content-security policy would require in any case. Below 780px the grid
  steps aside and the agenda takes over: seven columns do not fit a phone.

  The month arithmetic is its own file so the awkward cases could be tested
  directly: a month starting on a Sunday (six leading blanks, not none — the
  case a naive implementation gets exactly wrong), a 31-day month starting on a
  Saturday (six rows, not five), leap Februaries including the 1900 and 2000
  century rule, and the assertion that every day of the month appears exactly
  once. A day dropped from a grid is a deadline nobody sees.

### Changed
- The navigation bar's ceiling moves from eight items to nine, to make room. It
  was raised on a measurement rather than as an allowance: the nine-item bar
  holds a single line at every width from 780px — where the mobile navigation
  takes over — to 1680px, checked in Chromium. The alternative was demoting
  Alerts, which the register's own rule keeps one glance away.

## 0.95.0 — 3 September 2026

### Fixed
- **The dashboard was leading with the least urgent thing on it.** "Needs you
  today" sorted by date alone, so the oldest row came first whatever it was —
  and a matter lodged in 2024 whose record contradicts itself carries a 2024
  date. It sat above a reply due this afternoon, permanently.

  The cause was one field carrying two meanings. An alert's date is a
  **deadline** on a task or an expiry, and merely **when the record was made**
  on a finding that something is wrong. Sorted together, a lodgement date was
  being compared with a due date, which is not a comparison at all.

  Now: everything actually due comes first, most overdue at the top; everything
  that is merely wrong follows, newest first — because a record that went wrong
  last week is likelier to be a live mistake than one that has been wrong for
  two years. **Nothing is hidden**; the complaint was about priority, not about
  wanting those rows gone.

### Added
- **The dashboard cards can be sorted and opened out.** "Needs you today" offers
  *What is late first* or *Oldest date first*; Deadlines offers *Soonest*,
  *Priority* or *Client*, and a choice narrows the order rather than replacing
  it — twenty matters at one priority still read soonest-first. Every control is
  an ordinary link, so they work with scripting switched off.
- **A card no longer stops at a number nobody chose.** Deadlines was capped at
  fifteen in its query and simply ended, with nothing saying there was more; the
  cards now follow the reader's own **Rows per page** preference, show their
  full count in the heading, and offer *Show all*.
- **An alert when mail stops arriving.** The register checks the mailbox every
  few minutes; if the checking is working but nothing has come in for a few days,
  something before it is broken. That is what happened on 3 September — the
  practice's domain had no SPF record, Gmail refused every forwarded message, and
  Incoming quietly thinned out with nothing in the register looking wrong. An
  empty inbox is what a quiet week looks like too.

  Two things had to change. A poll that found nothing previously recorded
  **nothing at all**, so "the poll ran and the mailbox was empty" and "the poll
  is not running" were indistinguishable; each poll now leaves a heartbeat. And
  the alert fires only when the poll is *alive* and nothing has arrived — poll
  running plus no mail is the signature of the delivery path being broken
  upstream, and the alert says to look at forwarding and the domain's mail
  records. How many days counts as quiet is a setting.

### Documentation
- `docs/calendar-scope.md` — the calendar, scoped and not yet built. It records
  that `collectAlerts()` already returns something shaped exactly like a calendar
  event, so the calendar must render that collector rather than write its own
  queries; counts the 190 dated things the register holds today; names the one
  thing genuinely missing (a table for a date the practice *chooses* — a
  consultation, a hearing); and ends in three questions for the practice,
  including why an Outlook-subscribable feed deserves its own decision.

## 0.94.0 — 2 September 2026

### Added
- **Read the post: the AI says what each waiting message is, and which matter it
  belongs to.** The practice's ask — spot a PPI letter as it lands, so the matter
  can be brought up to date before the clock it starts runs down.

  It names the kind (PPI or RFI, a decision, an acknowledgement, a request for
  documents, an interim visa, an INZ investigation, a client's own message, an
  invoice, a circular), the reply-by date where the letter imposes one, which
  matter it concerns, and one sentence quoting what it read that off — so it can
  be checked in five seconds.

  **It writes nothing.** Every finding is a proposal shown beside the message;
  every change to a matter is still a person pressing a button on a page that
  shows them what they are about to do. The register holds live client files,
  and that rule is why this can be pointed at them at all. A test walks every
  write statement in the sweep and fails if one names any table but `ai_runs`.

  **It runs on a button, never on arrival.** A sweep is a model call per message
  against real client correspondence; both the cost and the reading are the
  practice's to choose. One press takes the newest twenty-five waiting messages.

  **The model reads; the register matches.** Which matter a letter belongs to is
  decided in code, by exact comparison on the INZ application number, then the
  client number, then the matter's own reference, then — only if nothing else
  identified it — the sender's address. A model asked to choose between two
  similar files will choose one, and confidently; that is the mistake that
  cannot be undone, so it is never asked. A name never matches, because two
  people share a name and a letter does not say which. Where one number matches
  two matters, both are shown and neither is chosen.

### Fixed
- **A deadline that was not a date could reach a matter.** The model's date was
  cut to ten characters before being checked, which turned `2026-13-45x` into
  `2026-13-45` — the right shape, and not a day on any calendar. It is now
  validated before truncation and against the calendar, so a month of 13 and the
  30th of February are refused rather than shown as "reply by".
- **A provider failure showed the practice raw JSON.** `401 {"type":"error"...}`
  is noise a lawyer cannot act on. What surfaces now is a sentence saying what
  to do; the whole error stays on the run record.
- Two tests that guarded the AI provider asserted "there are three calls" rather
  than "every call is guarded", so adding a fourth failed the test that existed
  to protect it. They now count the provider's own methods.

## 0.93.0 — 2 September 2026

### Changed
- **Everything that arrives now waits in the inbox.** Mail from an allow-listed
  sender was being turned into an inquiry the moment it landed, without passing
  through the inbox, while mail from everybody else waited there. Nothing was
  lost, but the post was in two places and which one a message went to depended
  on a list nobody had in mind while reading. The practice's decision,
  2 September 2026: one place to look, and a person decides what a message
  becomes.

  The setting stays, so it can be turned back on. Two things had to agree for
  the change to have any effect at all, and a test now holds them together: the
  default declared in Settings, and the fallback the pipeline passes when the
  setting has never been saved. **Only the second was actually deciding** —
  nothing writes the setting row until somebody opens that page — so changing
  the first alone would have done nothing. The test caught that on its first
  run.

### Added
- **Several inbox messages can be deleted at once.** A tick box on each row and
  one button, for junk that arrives in runs — the same sender, the same hour —
  which was the job the inbox made hardest.

  It asks first, on a page rather than in a dialog box: the register works with
  scripting switched off, and a dialog is script, so on a destructive action
  reaching this many rows "it silently did not ask" is not an acceptable
  failure. The page names every message about to go, by subject and sender.

  **Two kinds of message are refused**, because something else on the file
  points at them: one that became an inquiry, and one that has been filed onto a
  matter or a client. The file note written when a message is filed copies the
  message and, for a long one, says the full text is kept where it arrived — so
  deleting it would make that sentence untrue. Those rows show no tick box at
  all, and if one reaches the confirmation anyway it is listed under "will be
  kept" rather than failing the batch.

  What goes is the captured copy. The audit log — append-only, untouched by this
  — keeps the record that each message arrived, from whom, and that somebody
  deleted it, written from the row itself before the row goes. The confirmation
  step re-reads every row rather than trusting what the form sent back, because
  between the two steps somebody may have filed one of them.

### Fixed
- **A tick box is a tick box at every width.** Inputs are full-width by default,
  which is right for a text field and wrong for a control the browser draws at a
  fixed size: measured in Chromium at phone width the new selection boxes came
  out 20 by 13 and were awkward to hit. The same rule had already been needed
  once, for the radio buttons in Appearance; it is now general rather than
  waiting for the next control to be squashed.

## 0.92.0 — 1 September 2026

### Added
- **The two exports the intake actually asks for.** The intake prompt tells the
  practice to export two lists before running an extraction — the clients the
  register already holds, and the case-type keys. Neither could be produced. A
  document telling somebody to press a button that does not exist is worse than
  one that says nothing.

  **The clients export now carries the INZ client number.** It belongs to the
  person but is recorded on their matters, which is where INZ writes it, so the
  export gathers it from there. A person with two matters carrying the same
  number gets it once; where two disagree, both come out, because that
  disagreement is exactly what somebody needs to see. Passport numbers stay out,
  as they are from every export.

  **A new export, Dropdown lists**, gives every list an administrator can edit —
  case types, visa types, document categories, English tests — as key and label,
  with a column saying which list each belongs to. Sixty-seven case types, thirty
  visa types. They live as editable text in Settings and change without a
  deployment, so a list written down anywhere goes stale; exported, it cannot.

  Three things about the splitting are easy to get wrong and are each held by a
  test that fails without them: the carriage returns a textarea posts (a key
  ending in an invisible one matches nothing, and nobody reading the CSV can see
  why), the last term when the list does not end in a newline (which would be
  the type most recently added), and blank lines.

### Changed
- The intake prompt now names the two buttons rather than describing files the
  practice had to assemble by hand, and says to export both on the day of the
  run — both change without a deployment, so a copy kept from last time is a copy
  that is wrong.

## 0.91.2 — 1 September 2026

### Fixed
- **A worked example in the intake prompt was copied out of a real file note.**
  "The applicant is paid $27.76 against a visa condition of $27.80" — both
  figures appear once each in the register. No name was attached, which is
  exactly why it got through: it did not look like client data. Replaced with
  invented figures, checked against the register first, and the document now says
  that the check happened and why.

  The mistakes ledger gains the second occurrence, and its rule is widened: no
  real figure or fact about a matter either, and check anything you did not make
  up yourself — a name gets checked because it looks like client data, a wage
  rate does not.

### Changed
- **The intake prompt no longer carries a snapshot of the register.** It opened
  with client and matter counts and the next reference. Every one of those is
  owned by the fresh exports and the loader, the extraction has no use for the
  next reference at all, and a snapshot in a standing document is precisely the
  staleness that killed the separate brief this one replaced. The same applies
  to a count of undated matters further down, now phrased so it stays true.
- **Extraction and loading are no longer both serial.** Only the loads need to
  run in slice order: the loader re-checks every identity against the register in
  both directions at load time, so a person one slice calls new, who arrived with
  an earlier one, is caught when that slice loads. Extraction may run ahead. The
  one thing that genuinely gates a load is an identity the rule cannot settle,
  which needs the practice's answer first.
- **Slice size is stated as the constraint rather than the number.** A slice must
  extract in one sitting and load as one set of files — 150 matters is a ceiling
  taken from the one batch that has been through this, not a target.

### Added
- **Four cautions on reading the PREVIEW**, the first created by the instruction
  to prefer it: a certificate date read off a PREVIEW is `unverified`, never
  `verified`, because a PREVIEW is a form somebody filled in and the register
  computes legal deadlines from certificate issue dates. Also: a folder may hold
  several PREVIEWs and the newest of the relevant application governs; and a
  PREVIEW existing does not mean the application was lodged.
- **Matching a person completes their record; it does not skip their folder.**
  Their matters load like anybody else's. Only a provably identical application
  merges rather than creating.
- **Countries are written as plain English names everywhere** and mapped by the
  loader, which has stored them as ISO codes with a trigger behind them since
  migration 0055. A country that no longer exists goes in a note rather than
  having a successor state picked on the client's behalf.
- Matters with no year sort last in the oldest-first ordering, since they take
  current-year numbers.

## 0.91.1 — 1 September 2026

### Added
- **A test now holds the three edits of a release against each other** — the
  version in `package.json`, the entry in `CHANGELOG.md`, and the line under
  Help → Recent changes. The rule was written down and nothing enforced it, and
  the one that drifts is always Help, because it is the one a developer never
  sees while working.

  It found a gap on its first run: **0.5.0 was on the Help page and missing from
  the changelog entirely**, which jumped from 0.6.0 straight to 0.4.0. That entry
  is now reconstructed from what Help recorded, and says that it was.

### Documentation
- **The intake prompt is rewritten, and there is only one of it now.** A second
  document — a brief for one particular batch — had appeared the same day, and
  within hours the two disagreed about how to identify a person. The standing
  prompt still said *"the passport number is what settled it. Names do not
  identify a person here"*, which is the opposite of the practice's decision of
  1 September, and would have had the next extraction repeat the fault that
  decision was made to prevent. The brief is folded in and deleted.

  Four contradictions were cleared: identity by passport (three places), the
  missing `inz_investigation` status, `opened_on` listed with no provenance and
  no year rule, and a claim to have been through two batches when it has been
  through three.

  New in it: start from the `PREVIEW` PDF each folder holds; what not to read;
  the three-answer identity rule; how a matter gets its year and where that year
  may honestly come from; the warnings convention; what to do when a batch is a
  closed archive, and when it is very large.

- **Corrected the mistakes ledger's rule on client data**, which was stricter
  than the practice and stricter than sense. It banned references outright — but
  a bare reference discloses nothing, and pointing at a client by reference is
  exactly how you write about a real record without naming somebody. What is not
  allowed is a reference *carrying facts about that client*. Examples now use a
  number outside the range the register has issued, so nobody has to work out
  whether a snippet points at a real person. Four such references were replaced
  in the process.

## 0.91.0 — 1 September 2026

### Changed
- **Every list page now wears the same top.** A heading, whatever summary
  figures the page has, then a row of named views with a count on each, then one
  filter bar. Clients already read this way; Cases, the Knowledge base and Fees
  did not, because each was written on its own day and drifted.

  **Cases** gains **Open · Mine · All** across the top, with a count on each, and
  loses two dropdowns from a filter bar that held six controls. "Open only /
  Everything" and "Anyone / Assigned to me" were never filters — they are
  different errands, and an errand belongs in a tab where the count answers the
  question before you click. Filtering inside a view keeps you in it, and so
  does Clear.

  **The Knowledge base** gains **Current · Draft · Published · Superseded ·
  Archived**, replacing the state dropdown. Nothing it could do before was lost.

  **Fees** now shows its figures before the dates that narrow them. The page
  opened on two empty date boxes and the reader had to look past them to find
  the number they came for.

  The row itself is one component (`viewTabs`) rather than markup written out on
  each page, and a test asserts the shape page by page — that the views come
  before the filter bar, that the filter form carries the current view so
  filtering cannot move you, and that a view has not crept back into the bar as
  a dropdown. Seven pages each writing the same shape by hand is precisely how
  the search fault got onto seven pages and had to be found six times over.

  Checked in Chromium at 1400px and 360px, with scripting on and off: the tabs
  are ordinary links, so they work either way. Verified against the database
  that "Mine" genuinely narrows — 222 open matters, 213 of them mine — rather
  than looking as though it does.

### Added
- **The archive load will arrive quiet, and there are now tests that make that
  true.** The practice's instruction is that every matter in the coming archive
  batch is closed and raises no alert and no task — only warnings, where a
  warning is warranted.

  Checking that against the register's own alert queries turned up the one that
  is *not* gated on an open status: a matter recorded as approved or declined
  with no decision date is flagged whatever its status. So an archive matter
  whose folder gives no decision date must be `closed`, not `approved`. The
  register holds seventeen matters in exactly that position today, each one a
  standing alert.

  Expiry alerts are raised per client rather than per matter and skip archived
  clients — all five branches, now asserted branch by branch — so archive
  clients load as `archived` unless they are also a current client.

  Both rules are mutation-tested: remove either guard and the tests fail.

### Documentation
- The intake brief now covers **batches 04 and 05 together**, both tagged
  `Bankside`, and says what to read. Almost every client folder holds a PDF whose
  name begins `PREVIEW` — the application as it stood before lodgement, checked
  by the client — and that is the richest document in the folder and where the
  extraction starts. Submissions, cover letters and the issued visa are read;
  extraneous PDFs and photographs are not, and what was skipped is reported.
- Where nothing else dates a matter, its year comes from the earliest document
  showing the practice at work on it. That is evidence, labelled as evidence —
  not a guess. The caution: a folder's earliest dated thing is often the client's
  own passport or birth certificate, which dates the client and not the work.
- The archive is about 25 GB, so it surveys before it reads, works in slices of
  at most 150 matters that are each finished and loaded before the next is
  extracted, and gives each slice its own id prefix.

## 0.90.0 — 1 September 2026

### Added
- **A client or matter that is removed from the register now says so, in the
  register's own hand.** The database writes the audit entry itself, on an
  `AFTER DELETE` trigger, recording the reference, the name and the moment.
  Nothing can take a record out quietly — not the application, not a bulk load,
  not somebody running a statement by hand at a console.

  This came out of a real gap. On 1 September a client file was removed at the
  practice's instruction with a `DELETE` run straight against production. There
  is no route in the application that deletes a client, so there was no other
  way to do it — and a statement run by hand writes nothing to the audit log.
  The record left and nothing anywhere said so; it was found by counting, when
  the reference sequence showed a gap the audit log could not explain. The
  removal has now been written up in the audit log after the fact, saying which
  file, why, on whose instruction, and that the entry was written late.

  Deleting a client cascades to its matters, so a removal writes one entry for
  the client and one for each matter that went with it. A cascade is precisely
  the case a handler-written audit entry misses, because no handler runs.

  This is the third time an audit entry has been found missing because a route
  owned it rather than the database. Mutation-tested: with the trigger removed,
  every one of the five tests fails.

### Changed
- The mistakes ledger gains its nineteenth entry — *a change made by hand writes
  no audit row* — with both halves of the rule: write the entry yourself when
  you change something by hand, and reconcile the reference count, because an
  unexplained gap is the alarm.
- The 0.84–0.89 progress report no longer prints a client's reference beside
  their years of birth, and records that the practice reversed one identity
  answer the same day it gave it.

## 0.89.5 — 1 September 2026

### Fixed
- **Saving an edited fee line returned "Not found".** So did changing a fee's
  status, and deleting one. The three routes were *defined* but never
  registered: the handler above them — the revenue-split route — was missing its
  closing `});`, so all three sat inside that handler's callback rather than
  beside it.

  That is valid JavaScript, so it compiled. It is valid TypeScript, so it
  type-checked. And no test touched those three routes, so the suite stayed
  green. The register gave no clue beyond a 404 on a form it had just drawn.

  The brace is back where it belongs, and all six fee routes now register.

### Added
- **A test that every route a module writes down is actually reachable.** It
  compares what each module's source declares against the routes the built
  application really has, module by module, and cannot be fooled by nesting —
  a nested route never reaches the router. Twenty-two modules; the fees module
  was the only one affected. Reintroducing the missing brace fails it.

  This is the second fault of this shape. The first — a route shadowed by one
  registered before it — was fixed by ordering. Both are invisible to the
  compiler and to any test that does not ask the router what it holds.

## 0.89.4 — 1 September 2026

### Fixed
- **Showing 250 matters or 250 clients at once broke the page.** Choosing a
  larger page size on Cases or Clients returned "Something went wrong". The
  database refuses a statement carrying more than a hundred bound values, and
  the refusal is an error rather than a short answer: the list fetched the tags
  for the matters it was about to show by passing one bound value per matter
  into an `IN (...)`, so 250 matters meant 250 values and D1 answered *"too many
  SQL variables"*.

  It only appeared once the register was full enough to show that many. At 45
  matters the page never asked for more than 45.

  The same shape was in three places — matter tags, client nationalities and
  knowledge-base article tags. All three now run the list in chunks of ninety,
  through one helper (`allByIds`), so the number of rows on a page and the
  number of values in a statement stop being the same thing. Ninety rather than
  the hundred allowed, so a caller adding a parameter beside the list does not
  tip it over.

  Held by tests that build 250 matters and 250 clients against a wrapper that
  refuses more than a hundred bound values exactly as D1 does, and check the
  *last* row comes back — the tail is what broken chunking loses. Raising the
  chunk size past the limit fails them, and both pages return to erroring in the
  browser.

## 0.89.3 — 1 September 2026

### Fixed
- **A company could not be saved.** "Create client" did nothing at all — no
  error, no page change, nothing. `family_name` carried the HTML `required`
  attribute and lives in the individual half of the form; choosing "Company or
  organisation" hides that half, leaving the browser with a required field it
  could neither satisfy nor display. A browser refuses to submit such a form and
  reports it only to the console, so the button appeared dead.

  The rule it broke, now held by a test that reads both halves of the form: **a
  required field must never sit inside a block that can be hidden.** The server
  still requires a family name for a person, which is where the rule was
  enforced all along — so a person saved without one now comes back with the
  error against the box rather than a dead button.

  Belt and braces alongside it: the script now *disables* the controls in the
  half that does not apply, so the browser neither validates nor submits them.
  Any field added to either half later cannot repeat this.

- **Real client names had been used as worked examples** in code comments,
  tests, the changelog and the Help page, contrary to the standing rule that
  real client data never enters the repository. All replaced with fabricated
  names checked against the register. Two of them were mine, added the same day;
  one had been in `core/names.ts`, the Help page and three test files since the
  commit that introduced family-name capitalisation.

## 0.89.2 — 1 September 2026

### Fixed
- **The rest of the register searches word by word too.** 0.89.1 fixed the
  client list, the top-bar search and the filing picker. Every other list had
  been written the same way, separately, and had the same fault: **Cases**,
  **Quotes**, **Invoices**, **Knowledge**, the **Inbox** message list, the
  **conversations** list and the dashboard's quick lookup all compared the whole
  phrase against one column at a time. Cases mattered most — a matter is found
  by its client's name as often as by its own.

  All of them now match every word independently, in any order, through one
  shared clause. Tasks has no text filter of its own; the NZBN lookup queries
  MBIE's register rather than this one.

- **Quotes could not be filtered by status and text at the same time.** The
  status condition used a plain `?` while the text condition used `?1`. Mixing
  the two is legal SQL and a trap: the plain ones take the next free slot while
  the numbered ones count from the start, so both read the same value. Fixed by
  using one style throughout, and there is now a test that fails if any
  statement mixes them again.

### Added
- **A test that reads the source for the shape of this bug.** Six list pages had
  to be found by hand after the seventh was reported. `%${q}%` — the whole
  phrase, wrapped — now fails the suite wherever it appears in a filter, so the
  next one is caught when it is written rather than when a search quietly
  returns nothing.

## 0.89.1 — 1 September 2026

### Fixed
- **Searching a name only worked if you typed it in the register's order.** A
  name is stored as it is written on the passport — "Maria Luisa GARCIA", given
  names first. The search compared the whole phrase against one column at a
  time, so "GARCIA Maria Luisa" and "GARCIA, Maria Luisa" — the order a lawyer
  writes it, and the order INZ writes it — matched nothing at all, while
  "Luisa" on its own worked. With 231 clients that is a search that cannot be
  trusted.

  Every word is now matched independently and all of them must appear
  somewhere; the order is not the register's business. "GARCIA Maria Luisa",
  "Maria Luisa Garcia" and "luisa garcia" find the same person, and a word can
  match a different column from its neighbour — "GARCIA CL-9001" matches the
  family name and the reference together. It still narrows rather than widens:
  "GARCIA Amaka" is nobody.

  Fixed in one place and applied to all three surfaces that search: the client
  list, the search box in the top bar, and the picker that files an email onto a
  matter.

- **A stray parenthesis in the matters query took the whole Search page down**
  with a 500 while the above was being written. `searchEverything` runs eleven
  queries at once, so one bad query breaks all of them — and nothing executed
  the SQL, so nothing caught it. There is now a test that runs every one of
  those queries against the real schema, for one word, several words, and words
  containing LIKE wildcards, and checks that each query binds a value for every
  placeholder it writes.

## 0.89.0 — 1 September 2026

### Changed
- **Filing something searches instead of scrolling.** "File it on a matter or
  client" was one `<select>` holding every matter and client in the register.
  That was workable at sixty records and unusable at four hundred, which is
  where batch 03 puts it — and a list nobody can scan is a list people file
  into wrongly.

  It is now a search box. Type a family name, a reference, or **the INZ
  application number from the letter** — which is how INZ names the file it is
  writing about, and which appears in no matter title — and pick from what
  comes back. Matters first, then clients; the exact reference sorts to the
  top.

  Closed and withdrawn matters are included now, and marked as closed. The
  dropdown left them out on the grounds that you rarely file onto a closed
  file, but a decision letter on a matter closed last week is exactly the thing
  you do file, and leaving it out made the search say "no such matter" about
  one that plainly exists.

  It works with scripting switched off — that is the rule, and it is why the
  search is a button rather than a keystroke. Where scripting is there,
  `app.js` narrows the list as you type, reusing the same `data-live-search`
  mechanism the Search page already had. All three surfaces that file — the
  inbox, conversations, and inquiries — use the one picker.

### Fixed
- **A date in a page heading is a date again, not tags.** Three pages passed
  `stamp()`, which is markup, into a subtitle typed as a plain string, so the
  heading read `<span class="stamp">29 Aug 2026<span class="stamp-time">, 02:10
  am</span></span>` on screen. `pageHeader` takes markup now; plain text is
  still escaped, and there is a test for each.
- **The radio in a filing choice sat on its own line.** The stylesheet makes
  every `input` full width, which turned each radio into a line of its own with
  the row's text beneath it. Scoped back to `width: auto` inside the picker.

## 0.88.0 — 1 September 2026

### Added
- **A warning can be changed or deleted.** Raising one and taking one down were
  the only two things you could do to a warning, and neither covers the ordinary
  case of getting the wording wrong. "Change it" reworks the body, the kind or
  the period in place. "Delete it instead" removes it outright.

  The two removals mean different things and the wording says so: *taking down*
  says "this was true and no longer applies", and the record keeps it; *deleting*
  says "this should never have been here" — raised on the wrong person, or a
  duplicate from a load — and there is no sense in a file carrying it. Both write
  to the audit log, and both record what the warning said, so the append-only
  half of the history survives either way.

- **A warning says where it came from** — `flags.source_case_id`, added by
  migration 0059. Every warning raised by the batch-03 load restates a fact
  written down in a matter: a decline letter, a PPI response, a line in a brief.
  Read a year later, a warning with no source is a claim you either believe or
  go looking for; with the matter named it is one press to the evidence.

  Nullable on purpose — a warning typed in from a conversation ("do not phone,
  she is in a refuge") has no matter behind it, and that is the ordinary case
  rather than an omission. `ON DELETE SET NULL` rather than `CASCADE`: if the
  matter goes, the warning is still true. It loses its citation, not its point.

### Notes
- The batch-03 loader (outside this repository, as all data tooling is) now
  resolves identity on **name and date of birth**, and a passport number
  corroborates rather than decides — the same person renews a passport and may
  hold a second nationality's, so two numbers do not make two people. Where the
  name agrees but a date of birth is missing on one side, the loader refuses to
  decide and asks. Applying the rule to the joins the extraction had proposed
  rejected two of them and found two it had missed.

## 0.87.0 — 1 September 2026

### Added
- **"Under INZ investigation" is a case status.** Batch 03 turned up a matter
  whose entire file is one audio recording of a voluntary INZ Investigations
  interview, and the extraction had invented a case *type* for it. The
  practice's answer was better: what INZ is doing there is not a kind of work
  the practice takes on, it is a state a file is in, and a file can be in it
  whatever the application underneath was.

  So it is a status, it counts as live work, it can be entered from anywhere
  the file is still live — an investigation does not wait for a convenient
  moment — and it leads back to everywhere the file was going, because it
  interrupts an application rather than replacing it.

## 0.86.0 — 1 September 2026

### Added
- **A fee line can be billed from the price list.** The practice bills roughly
  the same dozen things, and re-typing a lodgement fee, its amount and the fact
  that it carries no GST is how a fee ledger ends up disagreeing with itself:
  two spellings of one charge that can never be counted as one.

  The list is not a new one. `service_items` is what quotes and invoices already
  bill from, and a matter's fee line now bills from the same rows — a second
  list would have been a second answer to the same question.

  It fills rather than replaces. The amount on a particular matter is often not
  the amount on the list, and a form that will not let you change it is a form
  people work around. The type of charge and the GST treatment always come from
  the list, because those are facts about what is being charged rather than
  preferences — and a disbursement left marked as a professional fee goes into
  the revenue split.

  **A price of zero means "not set", not "free".** Most of the practice's list
  is at zero today; taking that as the fee would put a $0.00 line on a matter
  and call it done.

### How it is built
- The script that fills a quote line fills this one — generalised rather than
  copied, because the two forms name the amount box differently and that was the
  only difference between them. The form declares which box it has.
- The handler applies the same row to whatever was left empty, so choosing from
  the list works with scripting switched off, and the page and the handler take
  their values from the same place and cannot disagree.

## 0.85.0 — 1 September 2026

### Changed
- **Invoices is in the Money menu.** The page has existed since 0.66.0 with its
  views, its detail page, issuing, payments, voiding and a printable copy — and
  it was reachable only through a tab on the quotes list, which is to say only
  if you already knew it was there. "What are we owed" is a question the
  practice asks of the register directly, not by way of quotes.

  Placed between Quotes and Fees, which is the order the work happens in: a
  quote before it, an invoice after it, the fee ledger underneath both.

- **The sideways tabs between quotes and invoices are gone.** The tabs on those
  rows are views of the list they sit on — owing, draft, paid. A link to another
  list sat among them because invoices had no place in the menu; now that it
  does, that tab would only be navigation pretending to be a filter.

## 0.84.0 — 1 September 2026

### Added
- **A file can carry a warning.** Asked for on reading a partnership summary
  that recorded an assault reported to Police: a fact that changes how a matter
  is handled, with no column of its own, three screens down in a file note —
  something you find *after* you needed it.

  A flag is a short standing statement about a client or a matter, shown in an
  amber band above everything else on the record. Raised deliberately by a
  person, cleared deliberately by a person; nothing computes one.

  **A warning on a person follows them onto their matters.** The fact is about
  the person, not about one application, and one that has to be raised again on
  every new file is one that stops being raised. The band says whose it is and
  links to where it is taken down.

  **A warning can be given a life.** Some are permanent — a conviction, a
  history. Some are true for a season: "overseas until March", "do not
  telephone". So the choice is "until it is taken down" or a period, and one
  past its date stops showing without anybody remembering.

  **Taking one down asks why, and keeps it.** A warning that stood on a file for
  six months is part of how that file was handled, and why it came down is the
  useful half. Cleared and lapsed warnings sit under "Warnings taken down" and
  any of them can be put back.

  The kinds are vocabulary, editable in Settings without a deployment, like
  every other list the practice uses.

### How it is built
- Migration 0058 gives `flags` its own table and four triggers: a warning must
  say something, it must be on a client or a matter, it cannot be cleared before
  it was raised, and it goes with the record it is about — left behind it would
  warn about nothing, and the next record given that id would inherit it.
- `core/flags.ts` owns what a flag is; `modules/flags` owns raising and taking
  down, in one place, because a warning means the same thing on both pages.
- Deliberately one band and one colour. No severity scale and no icons, and
  nothing at all when there is nothing to warn about: a band on every file
  teaches people to look past it. Amber rather than red, because red on these
  pages already means a deadline missed and two urgent colours rank nothing.
- The manual gains a section, and the file-notes section is brought up to date
  with the five-minute correction window from 0.82.0.

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
  them: *TRUONG, Thi Kim Oanh* sits under T for Truong, not under T for Thi. An
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
  practice's clients have names whose order is not the English one — "Hemi Rangi
  BUI" says which part is the family name where "Hemi Rangi Tawhai" leaves it to be
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
  not the English one: `TRUONG, Thi Kim Oanh` says which part is the family
  name where `Truong, Thi Kim Oanh` leaves it to be guessed, and guessing wrong
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

## 0.5.0 — 28 August 2026

*Reconstructed on 1 September 2026 from Help → Recent changes, which recorded
this release when the changelog did not. The list below is what that page says
shipped; it is not a fuller account, because there is no fuller account to give.*

### Added
- Settings, with tabs for practice details, security, fees, alerts and channels.
- Quotes can be printed, emailed and cancelled, and carry the terms of
  engagement.
- Two-factor authentication can be required of everyone.
- The Help manual.

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
