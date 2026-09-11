/**
 * Module: help.
 *
 * The manual, inside the application rather than in a file nobody opens. It is
 * written for whoever is using the register — an adviser or an assistant — not
 * for whoever maintains it; the developer documentation lives in docs/.
 *
 * Everything here is static, so it costs one render and no queries.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requireAuth } from '../../core/auth';
import { page } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { card, pageHeader } from '../../ui/components';
import { APP_VERSION } from '../../version';
import {
  CASE_STATUSES, CASE_STATUS_HELP, CASE_STATUS_LABELS,
} from '../../domain';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../../core/rbac';

const ROLES = ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const;

interface Section { id: string; title: string; body: Raw }

/**
 * Help, in parts, because the whole of it is a book.
 *
 * **Asked for on 12 September 2026**, in the middle of taking explanatory text
 * off the screens: *"re Less on the screen - i believe it is good time to
 * thoroughly review and update the help section, please do."*
 *
 * What was wrong with it was not the writing. It was that all twenty-eight
 * sections and every release ever made were rendered into **one page** — about
 * eleven thousand words of guidance and twenty-two thousand of release notes,
 * on a page a person opens when they are already stuck. The standing rule
 * covers exactly this: tabs when a page would run past one screen.
 *
 * So: six groups as tabs, and inside a tab each section is a heading you open.
 * A tab is then a short list of questions rather than a wall, which is the same
 * shape as the matter page after this morning.
 *
 * The groups are by *when you would be asking*, not by which part of the code
 * the answer lives in. Somebody looking up how a police certificate expires is
 * thinking about dates and paper, not about the clients module.
 */
const GROUPS: Array<{ id: string; label: string; sections: string[] }> = [
  {
    id: 'day', label: 'Day to day',
    sections: ['getting-around', 'search', 'clients', 'cases', 'notes', 'tasks', 'calendar'],
  },
  {
    id: 'dates', label: 'Dates and documents',
    sections: ['alerts', 'decisions', 'certificates', 'files', 'flags'],
  },
  { id: 'money', label: 'Money', sections: ['fees', 'quotes', 'invoices'] },
  {
    id: 'incoming', label: 'Work coming in',
    sections: ['inquiries', 'conversations', 'intake', 'assistant'],
  },
  {
    id: 'running', label: 'Running the practice',
    sections: ['knowledge', 'automations', 'export', 'website'],
  },
  {
    id: 'settings', label: 'Settings and setup',
    sections: ['account', 'admin', 'lists', 'connecting'],
  },
  { id: 'changes', label: 'What changed', sections: ['changes'] },
];

/**
 * How many releases the Recent changes section shows.
 *
 * Every one of them was being rendered, which by 12 September 2026 was about
 * two hundred releases and twenty-two thousand words of history on the page
 * somebody opens when they are already stuck. Twenty is about a fortnight of
 * this practice's pace — long enough to cover "what changed since I last looked"
 * and short enough to read.
 */
const RECENT_RELEASES = 20;

/**
 * One line per release, for someone who wants to know what changed without
 * reading a developer changelog. The full one is CHANGELOG.md in the
 * repository.
 */
/**
 * Exported so a test can hold it against `package.json` and `CHANGELOG.md`. A
 * release is those three edits agreeing, and this is the one of the three a
 * developer never sees while working, so it is the one that drifts.
 */
export const RELEASES: Array<{ version: string; date: string; notes: string[] }> = [
  {
    version: '1.58.0', date: '12 September 2026',
    notes: [
      'The practice caseload you can load to try the register is rebuilt: twenty matters \u2014 '
        + 'five simply done, ten that are real work, and five unusual ones including a section 61 '
        + 'request, a reconsideration and a deportation liability response.',
      'Sixteen people from fourteen countries, and the twenty matters sit on eleven files rather '
        + 'than twenty, so the files have a history on them.',
      'Fixed: six kinds of matter in that caseload were showing a code instead of a name, because '
        + 'they used types that are not in your own list. Only the try-it caseload was affected.',
    ],
  },
  {
    version: '1.57.0', date: '12 September 2026',
    notes: [
      'The register now backs itself up every night, on its own. It writes a copy of everything '
        + 'and then reads it back to check it is really there.',
      'Settings \u2192 Exports and backups shows the date of the last one. No backup for two '
        + 'nights and there is a red band. That is the page to look at if you ever wonder.',
      'It protects you from a lost or damaged database. It does not protect you from losing the '
        + 'Cloudflare account, because the copy is kept inside it \u2014 so press the full backup '
        + 'button now and then and keep that file somewhere else.',
      'Two settings under Settings \u2192 Nightly backup: whether it runs, and how many to keep. '
        + 'The newest is never deleted, whatever you set.',
    ],
  },
  {
    version: '1.56.0', date: '12 September 2026',
    notes: [
      'Read a document into a client\u2019s file, not only into a matter. The same card, above '
        + 'Files on the client\u2019s page: drop a document in, tick one already on the file, or '
        + 'point it at Google Drive \u2014 then the same review and the same press before '
        + 'anything is written.',
      'It fills the boxes a client has and a matter does not: title, gender, place of birth, '
        + 'national identity, nationalities, passport and visa details, INZ number.',
      'Anything it reads that belongs on a matter goes into the file note instead of being '
        + 'dropped, and says so.',
      'A client can only be pointed at their own documents \u2014 not another client\u2019s, and '
        + 'not the ones filed to their matters.',
    ],
  },
  {
    version: '1.55.0', date: '12 September 2026',
    notes: [
      'Surnames come first. A matter now reads \u201cRV. Partner \u2014 VUONG, Bao Long\u201d '
        + 'rather than \u201cRV. Partner \u2014 Bao Long VUONG\u201d, so lists read down the '
        + 'surname. The visa type still comes first. The client\u2019s own record is unchanged.',
      'The matter and client boxes can be typed into. Type part of a surname, a reference or a '
        + 'kind of work and the list narrows to what matches; the whole list is still there if '
        + 'you would rather scroll.',
      'If what you type fits two matters, it says so rather than choosing one for you.',
    ],
  },
  {
    version: '1.54.0', date: '12 September 2026',
    notes: [
      'A date in a history can be just a month. Write 2019-03 where you only know the month, or '
        + '2019-03-15 where you know the day. A month shows as \u201cMar 2019\u201d.',
      'Gaps still read correctly: a period that ended in March ran to the end of March, so '
        + 'starting the next job in April is not a gap.',
      'A wrong date no longer half-saves a history \u2014 nothing is written unless every row is '
        + 'right.',
    ],
  },
  {
    version: '1.53.1', date: '12 September 2026',
    notes: [
      'Cases, Quotes, Passports and Certificates are open when a client\u2019s page loads. Files, '
        + 'the histories and File notes still start closed.',
      'Key details lines up down one column now, instead of three.',
      'The warning band is brighter at the edges.',
      'A chest x-ray takes \u201cSubmitted with an application on\u201d like the others. Its '
        + 'expiry is still the one you typed \u2014 only a police certificate and a medical work '
        + 'theirs out.',
    ],
  },
  {
    version: '1.53.0', date: '12 September 2026',
    notes: [
      'A client\u2019s page opens as a list of headings: Cases, Quotes, Passports, Certificates, '
        + 'Files, the histories, then File notes at the bottom. Click a heading to open it.',
      'The summary down the right stays open \u2014 that is what you read to know where things '
        + 'stand.',
      'A certificate now says the date its rule works out to: \u201cSubmitted 12 Aug 2026 \u00b7 24 '
        + 'months from issue \u00b7 expires 29 Jun 2028\u201d, on the one line.',
      'Education history takes whether the course was finished \u2014 Completed, Not completed, '
        + 'or Still studying.',
      'Travel history takes a purpose you pick (Family, Holiday, Business, Work \u2026) and how '
        + 'they travelled (Air, Sea, Land). Both are lists you can edit.',
      'A country is named rather than abbreviated \u2014 a Tongan passport says Tonga, not TO.',
      'The right-hand column is one card again \u2014 Key details, with the name at the top, then '
        + 'Contact, Immigration, Passport, Certificates, English and Personal.',
      'An English test now says how long it is accepted for: two years from the test date.',
      'A warning can stand permanently, for 18 months, 2 years, 3 years, or until a date you '
        + 'choose. \u201cPermanent\u201d replaces \u201cUntil it is taken down\u201d \u2014 the '
        + 'same thing, in plainer words.',
      'The warning band is loud now: red edges fading into the middle, so the eye catches it.',
    ],
  },
  {
    version: '1.52.1', date: '12 September 2026',
    notes: [
      'Saving a client no longer loses what you typed. A visa expiry before the visa start date '
        + 'now says so against the box, instead of showing an error page.',
      'Any other rule the register enforces comes back the same way \u2014 a plain sentence on the '
        + 'form, with your typing still there.',
    ],
  },
  {
    version: '1.52.0', date: '12 September 2026',
    notes: [
      'Help is in tabs, and each section is a heading you open. It was one page of about '
        + 'thirty-four thousand words; the biggest tab is now about three thousand.',
      'The tabs are grouped by when you would be asking \u2014 Day to day, Dates and documents, '
        + 'Money, Work coming in, Running the practice, Settings and setup.',
      'Recent changes shows the last twenty releases rather than all two hundred.',
      'The guidance now covers everything that shipped today \u2014 correcting a certificate, the '
        + 'three histories, visa conditions, the practice caseload, and the rest.',
    ],
  },
  {
    version: '1.51.2', date: '12 September 2026',
    notes: [
      'A decision on the calendar now says which way it went \u2014 \u201cApproved \u2014 \u2026\u201d '
        + 'or \u201cDeclined \u2014 \u2026\u201d rather than \u201cDecided\u201d.',
      'Lodged and Decided are back on the calendar. Taking them off in 1.51.1 was a misreading: '
        + 'the objection was to the word, not to the rows.',
    ],
  },
  {
    version: '1.51.1', date: '12 September 2026',
    notes: [
      'The calendar opens on what is coming. Lodged and Decided are off unless you tick them on '
        + '\u2014 a decision that has already arrived is not a date to plan around, and it could '
        + 'never show in a month ahead anyway.',
      'They are still there to tick, for looking back at a month to see what went in and what '
        + 'came back.',
    ],
  },
  {
    version: '1.51.0', date: '12 September 2026',
    notes: [
      'Settings \u2192 Test data can now load a whole invented caseload to learn on \u2014 twelve '
        + 'clients with families, about thirty matters, quotations, passports and certificates.',
      'It is deliberately messy: a declined application, a section 61 request, an expired police '
        + 'certificate beside a current one, a passport renewed mid-application, a gap in a work '
        + 'history. The awkward files are what the register is for.',
      '\u201cPut it back as it was\u201d deletes everything marked as test data and lays the '
        + 'caseload down again, so whatever somebody added while trying things is disregarded.',
      'It can put itself back on a timer, under Settings \u2192 Practice caseload. That is set to '
        + 'never on this register, and should stay there.',
    ],
  },
  {
    version: '1.50.0', date: '12 September 2026',
    notes: [
      'A client now has Employment history, Education history and Travel history, under '
        + 'Certificates. Each starts closed, and none of them is compulsory.',
      'Each is a table you edit all at once, like quotation lines: type a number in the # box to '
        + 'move a row, tick the red cross to take one out, press Save the table.',
      'A period of unemployment is a row like any other \u2014 pick what the period was and leave '
        + 'the employer blank. That list is yours to edit under Settings.',
      'Where two jobs do not meet, the gap between them is shown as a shaded line saying how many '
        + 'months. It is never refused and never raises an alert.',
      'Military records is there as an empty block for now, as asked.',
    ],
  },
  {
    version: '1.49.0', date: '12 September 2026',
    notes: [
      'There is far less writing on the screen. About seventy paragraphs of explanation are gone '
        + 'or cut to a line, right across the register.',
      'Field names and the small notes under a box are untouched \u2014 those tell you what to '
        + 'type. What went was the writing that explained why things work the way they do.',
      'A police certificate, medical or x-ray now has an Edit button. Every change is written to '
        + 'the client\u2019s file and to the audit log, and the expiry still looks after itself.',
      'The \u201cSubmitted with an application on\u201d box disappears once you have used it. '
        + 'Change the date afterwards under Edit.',
      'The expiry date is printed once on a certificate and once on a passport, not twice.',
    ],
  },
  {
    version: '1.48.0', date: '12 September 2026',
    notes: [
      'A client\u2019s Immigration tab now takes \u201cVisa conditions\u201d and a \u201cStay '
        + 'limit\u201d \u2014 what the grant allows, and \u201c4 months per entry, 6 months in '
        + 'any 12\u201d.',
      'Nothing is counted from either and neither raises an alert. A stay limit only starts when '
        + 'somebody crosses a border, and the register cannot know when that was.',
      'On a matter, Read a document, Brief me, Files, File notes and Tasks now start closed. '
        + 'Click the heading to open one. Status, parties and key details stay open.',
      'My account shows your name, which it had been leaving out.',
    ],
  },
  {
    version: '1.47.1', date: '12 September 2026',
    notes: [
      'Settings \u2192 Test data opens again. It had shown \u201cSomething went wrong\u201d every '
        + 'time since it was added.',
      'The page reads the name of each marked record out of six different tables, and it was '
        + 'asking one of them for a column that is called something else there.',
    ],
  },
  {
    version: '1.47.0', date: '12 September 2026',
    notes: [
      'The Kind list on a file note is now yours to edit, under Settings \u2192 Lists and '
        + 'dropdowns. Rename Consult, add Site visit, drop Message \u2014 no deployment.',
      'System notes and email in and out stay out of the list. Those are what the register writes '
        + 'about itself, so a note claiming an email was sent cannot be written by hand.',
      'Taking a kind off the list does not change notes already filed under it \u2014 file notes '
        + 'can never be rewritten. The note keeps its kind and shows the stored word.',
    ],
  },
  {
    version: '1.46.0', date: '12 September 2026',
    notes: [
      'You can now change the response or decision date without moving the status. Leave "Move '
        + 'to" as it is, put in the new date and a note saying who granted the extension, and '
        + 'press Save. Any INZ follow-ups move with it.',
      'The status list stays fixed rather than editable, unlike most dropdowns. A status drives '
        + 'the alerts \u2014 which matters are open, which carry a deadline, which are with INZ '
        + '\u2014 so one added in Settings would be invisible to every alert.',
    ],
  },
  {
    version: '1.45.0', date: '11 September 2026',
    notes: [
      'You can now send a file straight from Finder or your phone into the register\u2019s inbox. '
        + 'Set it up under My account \u2192 Sending files in. It works from any folder \u2014 '
        + 'iCloud, Proton, Drive \u2014 because you are sending the file out rather than the '
        + 'register reaching in.',
      'The button carries a token, shown once and revocable. If it ever leaked, the holder could '
        + 'only drop a file into your inbox \u2014 nothing can be read with it.',
      'On a matter you can also paste a Google Drive folder or file address. The register lists '
        + 'what is there, you tick what to read, and it fills in what it can.',
      'A file read from Drive is not kept. What stays is the details you approved, a file note '
        + 'saying what was read, and a link back to Drive. Tick "keep a copy" for the few you want '
        + 'held here \u2014 a signed letter of engagement, an INZ decision.',
    ],
  },
  {
    version: '1.44.1', date: '11 September 2026',
    notes: [
      'Clearing a payment stage\u2019s amount box used to put the old amount back without saying '
        + 'so, which is why a schedule could not be brought down to match the quotation. An empty '
        + 'box now refuses the save and names the stage: type 0 to set one to nothing.',
    ],
  },
  {
    version: '1.44.0', date: '11 September 2026',
    notes: [
      'A document a client emailed you can now be read into the matter without downloading it '
        + 'and uploading it again. The reading screen lists what is already on the file \u2014 tick '
        + 'the ones you want and read them together.',
      'The review screen says which document each value came from, and the file note names what '
        + 'was read.',
      'A document the reading cannot open \u2014 a spreadsheet, a drive link, anything over 8 MB '
        + '\u2014 is listed with the reason rather than quietly skipped.',
    ],
  },
  {
    version: '1.43.0', date: '11 September 2026',
    notes: [
      'A quotation can now actually go to more than one person. It never could: a second address '
        + 'was refused outright, and the compose box has been inviting a list since 8 September.',
      'The To and Copy-to boxes now offer the people already in the register, by name \u2014 this '
        + 'quotation\u2019s client and parties first. You can still type an address that is not there.',
      'Send to an address that is on no client record and the preview says so, with a link to add '
        + 'it to the right person. The register does not keep a second list of addresses: the name '
        + 'belongs on the client record, where it stays correct.',
      'A client can now hold their title, gender, relationship status, other names ever used, '
        + 'place of birth, and a national identity number with the country that issued it \u2014 '
        + 'the things an application form asks for that had nowhere to go.',
      'Title, gender and relationship status are lists you can edit under Settings.',
    ],
  },
  {
    version: '1.42.0', date: '11 September 2026',
    notes: [
      'You can now point the reading at a matter that already exists: open it, drop in a passport, '
        + 'a letter from INZ or anything else, and you get a list of every box it could fill.',
      'Nothing is written until you press the button, and nothing already filled in is ever '
        + 'overwritten. You tick what you want.',
      'Whatever it found that the register has nowhere to keep \u2014 an occupation, a visa type '
        + 'not in your list, other people named in the document \u2014 is written to the matter as '
        + 'a file note, so nothing is lost just because there was no box for it.',
    ],
  },
  {
    version: '1.41.0', date: '11 September 2026',
    notes: [
      'Every email the register has sent can now be read back in full. The file note saying a '
        + 'quote was emailed is a link \u2014 open it and you see the letter exactly as the client '
        + 'received it. This works for emails already sent, not just new ones.',
      'The quote page has an "Emails sent" list beside the file notes.',
      'The quotation email is sent formatted by default now, with plain text one click away. The '
        + 'plain version still goes alongside it either way.',
      'The accept button and its tick boxes are the same green as the "Go to accept" button.',
      'The printed quotation is about a tenth shorter: the lines between the headings are a little '
        + 'tighter, while the space above each heading stays as it was. Nothing changed size or '
        + 'colour.',
    ],
  },
  {
    version: '1.40.0', date: '11 September 2026',
    notes: [
      'Any client, matter, quotation, inquiry, invoice or task can now be marked as test data, '
        + 'and everything so marked is deleted in one go from Settings \u2192 Test data. Only you '
        + 'and an administrator can do either.',
      'Marking a client marks everything filed under them \u2014 their matters, quotations, '
        + 'inquiries and invoices \u2014 so nothing real-looking is left behind when they go. '
        + 'Marking one quotation says nothing about the client it belongs to.',
      'A test quotation can be sent and accepted as many times as you need: an accepted one '
        + 'offers "Unaccept and start again". A quotation cannot be unmarked afterwards, because '
        + 'the mark is what stops it being a contract.',
      'The audit log is never deleted. After a purge it still records that those records existed '
        + 'and were removed \u2014 that is the log doing its job.',
      'Accepting a quotation asks for two ticks now, not one: "The above name is correct" and '
        + '"I have read the quotation and the letter of engagement". Neither can be skipped.',
      'The acceptance date is no longer a box the client can change. It is the moment they '
        + 'accept, with the time and time zone, as the register sees it.',
      'On the quote page, the Qty, Unit, GST and Amount headings now sit over their own figures '
        + 'instead of drifting to the left of them.',
      'The quotation totals lost the Professional fees, Disbursements and Subtotal rows. Every '
        + 'line already says which it is, and the subtotal was the total less the GST underneath '
        + 'it. GST and Total payable remain.',
    ],
  },
  {
    version: '1.39.1', date: '11 September 2026',
    notes: [
      'The ** marks in the quotation letter no longer reach the client. They are bold marks: '
        + 'in a formatted email they make the words bold, but a plain-text email was sending '
        + 'them as typed. Plain text now has them taken off; the letter you edit is unchanged.',
      'The preview shows the plain-text letter exactly as the client will read it.',
      'The list of brace-words beside the compose box no longer cuts a date in half.',
      'Your email signature is now yours to set, under Settings \u2192 Practice. Paste it in as '
        + 'plain text \u2014 name, title, phone, confidentiality notice \u2014 and it is used at '
        + 'the foot of the quotation letter. Before this the register signed off with the '
        + 'practice name, email and phone, which is what it still does if you leave it empty.',
    ],
  },
  {
    version: '1.39.0', date: '11 September 2026',
    notes: [
      'What you type into a form is now kept in your own browser as you go, and offered back '
        + 'if the page is closed or the browser crashes before you press Save. A bar at the top '
        + 'of the form asks whether to put it back \u2014 it is never restored on its own, in '
        + 'case somebody else has saved the record since.',
      'Leaving a page with changes you have not saved now asks whether you are sure.',
      'The register still does not save by itself. Nothing reaches a client\u2019s record until '
        + 'you press Save, so every change still has a person and a moment against it. The draft '
        + 'stays in your browser, goes when you sign out, and is discarded after twelve hours.',
    ],
  },
  {
    version: '1.38.0', date: '11 September 2026',
    notes: [
      'The email that goes out with a fee quote \u2014 both its subject line and its wording '
        + '\u2014 can now be changed under Settings \u2192 Quotes, and stays changed. It used to '
        + 'be written into the program, so a reworded letter lasted for one client only.',
      'A word in braces, such as {client_name} or {total}, is filled in from the matter. The '
        + 'full list is beside the compose box. A word spelled wrongly is printed as you typed '
        + 'it rather than quietly vanishing, so a mistake is visible.',
      'Nothing is sent unseen: the compose box now offers Preview, and the preview screen shows '
        + 'the letter exactly as the client will receive it, with Send and Back to edit beneath '
        + 'it.',
    ],
  },
  {
    version: '1.37.0', date: '11 September 2026',
    notes: [
      'Forty-five clients held a police certificate whose expiry the register was not watching. '
        + 'One had expired fifteen months earlier and never appeared on the alerts page. Fixed, '
        + 'and the database now keeps that date itself so it cannot go missing again.',
      'A superseded certificate no longer shows in red as though it were a problem. The warning '
        + 'is for the certificate actually in force; the old one keeps its date quietly.',
      'Links sent to clients now use app.immigration.kiwi instead of the register\u2019s own '
        + 'workers.dev address.',
      'New alert: a client turning 53, and again at 54, with a note that Skilled Migrant '
        + 'residence closes on their 56th birthday. It shows for a month after each birthday '
        + 'rather than every day, and never for somebody who already holds residence.',
    ],
  },
  {
    version: '1.36.0', date: '10 September 2026',
    notes: [
      'A client\u2019s visa now records the date it was granted, beside the expiry. Maximum '
        + 'continuous stay is counted from there, so it was the missing half of the fact.',
      'The register refuses a visa that expires before it was granted.',
    ],
  },
  {
    version: '1.35.0', date: '10 September 2026',
    notes: [
      'A knowledge base article can be sent to a client. Open it, press Create a link, and send '
        + 'the address \u2014 they get a clean page with the list under its headings, no sign-in, '
        + 'and it prints properly.',
      'Correcting the article corrects what every client holding the link sees. Press Stop sharing '
        + 'and the address dies at once, including for anybody already holding it.',
      'Nothing in the knowledge base is readable from outside until you press that button on that '
        + 'article, and the register records who pressed it.',
      'Links sent to clients were showing the register\u2019s own web address. Until a domain of yours is pointed at the register there is no other address to use, so the quote email page and the share panel now tell you which address the client will see before you send it, and where to change it.',
      'The register\u2019s own specification is now produced by one command and checked by the build, so it cannot quietly go out of date \u2014 including new documents listing every setting you can change and who may do what.',
      'Six document lists are now filed: relationship documents in English, Russian and '
        + 'Vietnamese \u2014 your own template, unchanged \u2014 and first drafts for AEWV, '
        + 'RV Partner and VV General, marked as drafts until you have checked them.',
    ],
  },
  {
    version: '1.34.0', date: '10 September 2026',
    notes: [
      'A client\u2019s page now leads with Identity and compliance \u2014 visa, passport, police '
        + 'certificate, medical \u2014 because those are the dates that expire. Contact and Fees '
        + 'follow, and Tags sit at the bottom as they now do on a matter.',
      'The age is shown beside the date of birth, so you are not working it out in your head.',
      'Contact opens with the phone number and email rather than three rows of name parts, and '
        + 'the phone and WhatsApp numbers are now tappable.',
      'The INZ client number leads Identity and compliance, where the note beside it always said '
        + 'it would.',
    ],
  },
  {
    version: '1.33.0', date: '9 September 2026',
    notes: [
      'The client\u2019s phone number and email address now show on the matter itself, under Key '
        + 'details, so you can ring or write without opening their page first.',
      'Key details now leads with the numbers you quote: Client, Client number, INZ client no., '
        + 'Case number \u2014 each on its own row, instead of the reference running on from the '
        + 'name.',
      'Opened now sits above Lodged, and the client in the Parties list is noted as the principal '
        + 'applicant.',
    ],
  },
  {
    version: '1.32.1', date: '9 September 2026',
    notes: [
      'The client now appears at the top of the Parties panel on a matter, badged Client, above '
        + 'the children and partners on the file. Their page is one click away, and they cannot be '
        + 'taken off their own matter.',
      'Tags on a matter have moved to the bottom of the right-hand column. Key details \u2014 who '
        + 'the client is, the INZ numbers, what is due \u2014 now come first, which is what you '
        + 'open a file to read.',
    ],
  },
  {
    version: '1.32.0', date: '9 September 2026',
    notes: [
      'An accepted quotation can no longer be changed. You found this by deleting a line off one '
        + '\u2014 the only check was whether you may edit quotations at all, never whether that '
        + 'one was still open.',
      'The lines, the schedule, the people, the figures, the dates and the status are all fixed '
        + 'once a client accepts. The database refuses it, so no screen can forget. Your own '
        + 'note on the file still works.',
      'Two emails now go out when a client accepts: one to them confirming what they agreed to, '
        + 'with the link again; one to you saying it arrived, who accepted, and that the '
        + 'quotation is now fixed.',
      'If the client has no email address on file, your copy says so rather than letting you '
        + 'assume they were written to. Neither email can hold up an acceptance.',
      'You can send your copy somewhere else \u2014 an assistant, a shared inbox \u2014 under '
        + 'Settings \u2192 Practice, without changing the address clients see.',
      'A full note now goes on the quotation\u2019s own file notes when it is accepted: who, the '
        + 'date they gave, when it arrived, from where, the total, and that it is now fixed.',
    ],
  },
  {
    version: '1.31.0', date: '9 September 2026',
    notes: [
      'The email to the client is now your own letter, with the figures, dates and link filled '
        + 'in \u2014 including your paragraph that accepting is not a guarantee of any '
        + 'immigration outcome.',
      'It adapts where a sentence would otherwise be untrue: it does not promise a Letter of '
        + 'Engagement that is not going, does not say \u201Cinclusive of GST\u201D when no GST '
        + 'applies, and does not mention disbursements when there are none.',
      'Where you have written a capacity note in Settings it uses yours; otherwise it uses the '
        + 'sentence from your letter. You are never told twice.',
      'A green ACCEPTED stamp now sits at the head of an accepted quotation, with the date, the '
        + 'time and who accepted it. It shows on the client\u2019s page, on your print view and '
        + 'on paper.',
      'The quotation and the letter of engagement are the same width now, with space between '
        + 'them. The letter had been set narrower, which only showed once they sat one above the '
        + 'other.',
    ],
  },
  {
    version: '1.30.1', date: '9 September 2026',
    notes: [
      '\u201CINVOICE\u201D is now the size of a document title, the same as \u201CFEE '
        + 'QUOTE\u201D on a quotation. It had been an ordinary heading.',
      'Your contact lines on an invoice are labelled Mobile, Email and GST, as they already were '
        + 'on a quotation. The same details had been appearing two different ways on two '
        + 'documents in the same envelope.',
    ],
  },
  {
    version: '1.30.0', date: '9 September 2026',
    notes: [
      'Quotations and invoices are now set close to your own Xero invoice: 8.5pt type, hairline '
        + 'rules between the rows, and the totals gathered to the right with short rules rather '
        + 'than lines across the whole page.',
      'Section headings are smaller, in your accent colour, with a rule under them \u2014 which '
        + 'is where that invoice uses colour.',
      'The shaded bar behind the total is gone; on a document the rules do that job.',
      '\u201CFEE QUOTE\u201D and \u201CTax invoice\u201D now sit top left with your name and '
        + 'contact details top right, matching your Xero invoice. The reference block\u2019s '
        + 'labels align left on that side, so they start flush at the margin rather than going '
        + 'ragged against it.',
      'The letter of engagement keeps your letterhead at the top left, because a letter is not '
        + 'an invoice.',
    ],
  },
  {
    version: '1.29.0', date: '9 September 2026',
    notes: [
      'A quotation now has a private link the client opens \u2014 no account, no password. It '
        + 'carries the quotation, the letter of engagement beneath it, and a way to accept them '
        + 'both, on one page.',
      'The Accept panel sits at the foot, after both documents, so it cannot be pressed before '
        + 'they are scrolled past. A quiet bar follows the reader saying it has not been accepted '
        + 'yet, with a link down to the panel.',
      'Accepting takes their full name, the date and a tick. The register records that plus the '
        + 'moment it arrived and the address it came from, writes a file note on the matter, and '
        + 'moves the quotation to Accepted. An acceptance can never be changed or removed \u2014 '
        + 'issue a new quotation instead.',
      'The email is a covering email now: the total, the link, the documents named, and a request '
        + 'to read them and sign if acceptable. It no longer retypes the whole quotation.',
      'The Money menu no longer opens by itself when you are on Quotes or Invoices.',
      '\u201CFEE QUOTE\u201D no longer sits almost on the edge of the paper when your print box '
        + 'has margins set to anything but Default.',
      'The printed quotation is tighter again \u2014 less space between rows, the same space '
        + 'above the headings.',
    ],
  },
  {
    version: '1.28.1', date: '9 September 2026',
    notes: [
      '\u201CFEE QUOTE\u201D is in capitals now, and at twice its original size rather than '
        + 'three times \u2014 three was too big on the page.',
      'It sits a little higher than your name beside it, with four clear lines underneath, so it '
        + 'reads as the title of the page rather than as a label on the reference block. Still '
        + '18mm clear of the top of the paper.',
      'The \u201CRe\u201D line is gone. The items name the work with a figure against each, so a '
        + 'heading repeating the first of them said nothing new.',
    ],
  },
  {
    version: '1.28.0', date: '9 September 2026',
    notes: [
      'The payment schedule now says how much is left to allocate, not only how much has been: '
        + 'it says \u201C$4,000.00 allocated of $7,632.70, $3,632.70 left to allocate\u201D.',
      'And it will not let you allocate more than the quotation comes to. That is enforced by '
        + 'the database, so no screen can forget it. Saving a whole schedule that would go over '
        + 'is refused as a whole \u2014 nothing is half-saved.',
      'Lowering a fee line under a schedule already written is still allowed; you get a warning '
        + 'rather than a refusal, because the alternative is being unable to fix a typo until '
        + 'you have taken the schedule apart.',
      '\u201CFee quote\u201D is now the size of a document title, at the top right of the page.',
      'The word \u201CRemove\u201D is a small red cross everywhere it appeared \u2014 a party '
        + 'on a matter, an invoice line, a share, a passport, a certificate, a file on an '
        + 'article, and the tick boxes in both editing tables on a quotation.',
      'The tick boxes stay boxes, because those apply when you save. The cross fills solid red '
        + 'when ticked, so you can see what is about to go before you save it.',
      'The money columns on a quotation now sit in the same place on every quotation. They were '
        + 'sized by their contents, so a quote with larger figures put its columns somewhere '
        + 'slightly different. They still give and take as you change the window width.',
    ],
  },
  {
    version: '1.27.1', date: '9 September 2026',
    notes: [
      'Fixed a gap in the middle of the letter. Justifying the paragraph that carries the terms '
        + 'address stretched the line before it, because a web address cannot be split between '
        + 'words. That paragraph is no longer justified.',
    ],
  },
  {
    version: '1.27.0', date: '9 September 2026',
    notes: [
      'The black pages are gone. A document page is now simply not a dark page \u2014 not a '
        + 'print rule, so there is nothing left for a browser to skip. What was black was the '
        + 'sheet behind the document, which a print rule could not reach.',
      'Checked with \u201CBackground graphics\u201D ticked, which is what you had on: six '
        + 'files, nothing dark anywhere, 20mm on every edge.',
      'Every document now says which printing it is \u2014 \u201CPrinted Wednesday, 9 September '
        + '2026 at 11:40 pm NZST\u201D at the foot of the quotation, the letter and the invoice. '
        + 'Two printings of the same reference are otherwise identical once they are on paper.',
      'It shows on the screen as well as on the paper, because what you see should be what '
        + 'prints.',
    ],
  },
  {
    version: '1.26.1', date: '9 September 2026',
    notes: [
      'A quotation now says: \u201CThis Quotation (fee quote) is subject to the Letter of '
        + 'Engagement, Short Form and Standard Terms of Engagement. Please read them before '
        + 'accepting.\u201D It had named only the standard terms.',
      '\u201CStandard Terms of Engagement\u201D is the link \u2014 it is the one of the three '
        + 'the client does not already have in their hand. The address still prints underneath '
        + 'on paper.',
      'The covering email and the note on the quotation screen say the same thing, so the three '
        + 'do not describe the engagement differently.',
    ],
  },
  {
    version: '1.26.0', date: '9 September 2026',
    notes: [
      'The totals under a quotation\u2019s fee lines sit under Amount again. They had stayed '
        + 'under GST when Amount was moved to the right of it, so every one of them was a '
        + 'column to the left of the figures it was adding up.',
      'The payment stages now show what the client pays \u2014 the same figure the printed '
        + 'quotation shows \u2014 with how much of it is GST underneath. A price no longer '
        + 'breaks across three lines, and \u201CStage 1\u201D no longer splits in two.',
      'A line comes off a quotation with a small red cross rather than the word \u201CRemove\u201D.',
      'The fee lines and the payment stages are tighter. Same size type, less empty space \u2014 '
        + 'the items card is about a third shorter.',
      'Colour on the invoice. \u201CTax invoice\u201D, \u201CShort Form Terms of '
        + 'Engagement\u201D and the addendum title now carry your accent colour, the same as the '
        + 'section headings. Your own name at the top stays black.',
    ],
  },
  {
    version: '1.25.0', date: '9 September 2026',
    notes: [
      'The letter of engagement is now justified \u2014 the text is straight down both edges, '
        + 'the way a legal document is set.',
      'Only the paragraphs. The address block, the RE line, \u201CDear \u2026,\u201D, your '
        + 'signature and the headings keep their ordinary ragged edge, because stretching a '
        + 'two-word line across the page is what makes justified text look wrong.',
      'The quotation is left as it was on purpose: it is a table of figures, and a justified '
        + 'line of two words in a narrow column is a row of gaps.',
      'Margins are now 20mm rather than 25mm, on the quotation, the letter and the invoice. '
        + '25mm was the figure asked for while documents were printing at about 8mm; now that '
        + 'the margin is actually being applied, 20mm is the width you wanted.',
    ],
  },
  {
    version: '1.24.0', date: '9 September 2026',
    notes: [
      'Put **two asterisks** around a phrase in your letter wording and it prints in bold. Works '
        + 'in the clauses, the opening and closing, the scope of the retainer, the addendum and '
        + 'the acknowledgements.',
      'Only bold \u2014 no italics, links or headings. A contract is not something to be able to '
        + 'restructure by accident, and anything else you type stays as the characters you typed.',
      'The heading above the acknowledgements is yours to write now, rather than fixed at '
        + '\u201CWhat you confirm by accepting\u201D.',
      'Pasting a numbered list no longer numbers it twice. \u201C1.\u201D, \u201C2)\u201D and a '
        + 'stray bullet in front of a number are taken off; a number that is part of the sentence '
        + 'is left alone.',
    ],
  },
  {
    version: '1.23.2', date: '9 September 2026',
    notes: [
      'The administrative team now prints on the letter exactly as you type it in the box \u2014 '
        + 'one line each, mobile and email and all. It had been pulling your line apart and '
        + 'reprinting the numbers and addresses gathered at the bottom of the section.',
      'Write those lines however you like: a name on its own, or a name with whatever contact '
        + 'details you want the client to have. What you type is what prints.',
      '\u201CQuotation\u201D is capitalised where the letter points at it, since your opening '
        + 'defines it as a term.',
      'The colour is back \u2014 section headings and links in your accent, on white paper. '
        + 'Making the documents stop printing in the dark theme had taken the colour out with it.',
      'The address of your standard terms is now a live link on the letter, and still shows the '
        + 'address itself so a printed copy is still usable.',
      'Spacing tightened once more.',
    ],
  },
  {
    version: '1.23.1', date: '9 September 2026',
    notes: [
      '\u201CWhat the client confirms\u201D now holds 10,000 characters instead of 4,000. Your '
        + 'list had outgrown the box and it was refusing the rest.',
    ],
  },
  {
    version: '1.23.0', date: '9 September 2026',
    notes: [
      'Quotations and letters now print as black on white paper whatever your screen is set to. '
        + 'A letter you sent had every page filled with a near-black rectangle \u2014 the document '
        + 'had been coming out in the dark theme, and that is also why the margin fixes seemed to '
        + 'do nothing.',
      'The margins and the A4 size are part of the document itself now, not something the print '
        + 'box has to be persuaded to apply. Checked both ways of making a PDF: A4, nothing dark, '
        + '25mm on every edge.',
      'There is a home for the Law Society \u201CInformation for Clients\u201D \u2014 it prints '
        + 'as an addendum after your signature, on a page of its own. Settings \u2192 Letter of '
        + 'engagement.',
      'The administrative team box now understands however you type it. Written with labels and '
        + 'commas, it was losing the email addresses off the letter completely.',
      'On a quotation, \u201CRe\u201D names the kind of work rather than repeating the client, '
        + 'who is already at the top; Amount sits to the right of GST; and \u201COur '
        + 'reference\u201D is shortened to \u201COur Ref\u201D.',
      'The unit on a fee line can be cleared. \u201Citem\u201D came back however you edited it, '
        + 'because an empty box could not be told apart from one that was never filled in.',
      'The payment stages now show the GST-inclusive figure. Each row said \u201C+ GST\u201D '
        + 'while the total under them was already inclusive, so the rows and the total were not '
        + 'the same kind of number.',
      '\u201CThe Lawyer\u201D and \u201CThe Client\u201D are capitalised as the letter defines '
        + 'them, and \u201CNominated representative for all parties\u201D now sits in smaller '
        + 'type beside the name it belongs to.',
    ],
  },
  {
    version: '1.22.1', date: '9 September 2026',
    notes: [
      'On printed documents, Date, Our reference and Matter now line up with each other and each '
        + 'label ends with a colon.',
      'Your contact lines are labelled \u2014 Mobile:, Email:, GST: \u2014 and your GST number is '
        + 'on the letter of engagement as well as the quotation.',
      '\u201C(Direct Access)\u201D is off the terms heading, which now reads simply '
        + '\u201CImmigration Legal Services\u201D.',
    ],
  },
  {
    version: '1.22.0', date: '9 September 2026',
    notes: [
      'New quotations can start from a shape you choose. Open one you are happy with and press '
        + '\u201CUse as the template\u201D \u2014 its lines and payment stages become the '
        + 'starting point for every quotation you make afterwards.',
      'No amounts are copied, ever. Every line and stage arrives at nil and you type the figures. '
        + 'A template carrying prices would eventually put one client\u2019s figure on another\u2019s '
        + 'quotation.',
      'What it captured is plain text under Settings \u2192 Quotes, so you can read and edit it '
        + 'there rather than pressing the button again.',
      'The button is only for you and administrators: it changes what every future quotation '
        + 'starts from, which is a settings decision rather than a quoting one.',
    ],
  },
  {
    version: '1.21.0', date: '9 September 2026',
    notes: [
      'The letter now shows where your covering letter ends and your terms begin \u2014 a rule '
        + 'across the page headed \u201CShort Form Terms of Engagement / Immigration Legal '
        + 'Services (Direct Access)\u201D. Both lines are yours to reword or clear, under '
        + 'Settings \u2192 Letter of engagement.',
      'That matters because the letter also points at a second set of terms, the Standard Terms '
        + 'published on the web. A client could not previously tell that the page in their hand '
        + 'was itself a set of terms.',
      'There is a box for the scope of the retainer, printed just under the block that points at '
        + 'the quotation. It is empty until you write it: the register does not compose the '
        + 'paragraph that says what you will and will not do.',
      'That block is now headed \u201CThe Parties, the Scope of Work, the Fees (Legal and '
        + 'Disbursements) and the Payment Terms\u201D.',
      'The client is named as \u201CFOR: \u2026\u201D, and \u201CTelephone\u201D now reads '
        + '\u201CMobile\u201D. \u201CLetter of engagement\u201D is off the top right corner \u2014 '
        + 'the document already says what it is twice.',
      'The 25mm margin now actually happens. The side margins are built into the document, where '
        + 'no print setting can shrink them; the top and bottom still need the print box left on '
        + 'Margins: Default, and the page says so beside the button.',
      'Printed documents are smaller and tighter \u2014 10 point, closer line spacing, smaller '
        + 'gaps between paragraphs. A five-page letter loses about a page without a word being '
        + 'cut. Grey text prints black.',
    ],
  },
  {
    version: '1.20.0', date: '9 September 2026',
    notes: [
      'The letter of engagement can now name your administrative team. Settings \u2192 Letter of '
        + 'engagement has a box for them: one person per line, as Name | Short name | Mobile | '
        + 'Email. Only the name is required.',
      'The paragraph explaining that their role is limited \u2014 no legal advice, no '
        + 'professional judgement, not your representative \u2014 stays your own wording, written '
        + 'as a clause under Quotes \u2192 Letter clauses. The register supplies the names, not '
        + 'the words.',
      'They print on the letter and never on the quotation: the quotation is the work and the '
        + 'fees, and who answers the telephone is a term of the engagement.',
      'A web address in a letter was breaking in the middle of \u201Chttp\u201D. It now moves to '
        + 'the next line whole, and only breaks inside itself when it genuinely will not fit.',
    ],
  },
  {
    version: '1.19.1', date: '9 September 2026',
    notes: [
      'The letter of engagement now begins \u201CDear \u2026,\u201D with the client\u2019s full '
        + 'name. It used to open straight into the first paragraph under a bare name.',
      'It no longer asks for a postal address \u2014 the block at the top carries their email and '
        + 'telephone instead. The address stays on their own record; it is only this letter that '
        + 'stops printing it.',
      'Printed documents now leave 25mm clear on all four sides. A quotation you sent came out '
        + 'with about 8mm at the sides and 6mm at the top \u2014 the register had never said what '
        + 'the margin should be, so the browser chose.',
      'One thing to watch when you save one as a PDF: in the browser\u2019s print box, leave '
        + 'Margins on Default. Set to None and the browser ignores what the document asks for.',
      'The paper size is deliberately left to your printer. Forcing A4 would make a printer '
        + 'loaded with anything else shrink the whole page, and the margin with it.',
    ],
  },
  {
    version: '1.19.0', date: '9 September 2026',
    notes: [
      'A matter or a client created by mistake can now be deleted \u2014 the button is at the '
        + 'bottom of the Edit page, and only you and an administrator see it.',
      'It tells you what deleting would take with it before you press, and asks you to type the '
        + 'reference rather than click \u201Cyes\u201D.',
      'Some things it will refuse, and say why: anything with an invoice, a quotation already '
        + 'sent, or documents attached; a client who still has matters, who has notes on their '
        + 'file, or who is named on somebody else\u2019s matter. For a client you have written '
        + 'about, archive them instead \u2014 that keeps the file and stops the alerts.',
      'File notes are never destroyed. Delete a matter and its notes move onto the client\u2019s '
        + 'own file, word for word \u2014 so a consultation you wrote up minutes earlier is still '
        + 'there afterwards.',
      'This is for a record that should not exist. A matter that came to nothing is still closed '
        + 'by setting it to Withdrawn or Closed, which keeps everything.',
    ],
  },
  {
    version: '1.18.0', date: '9 September 2026',
    notes: [
      'A backup button, on Settings \u2192 Export. One press downloads the whole register \u2014 '
        + 'every client, matter, quotation, invoice, note and uploaded document \u2014 as a single '
        + 'dated zip file.',
      'It is yours alone. An administrator can do everything else in Settings and cannot take a '
        + 'backup, because this one file is the practice\u2019s entire book of business.',
      'It includes passport numbers, which the spreadsheet exports do not. A backup exists to put '
        + 'the register back, and one missing a column cannot.',
      'Treat the file the way you would treat the filing cabinet: not something to email, and a '
        + 'copy on a laptop is a copy of everything about every client. Every time one is taken is '
        + 'recorded in the audit log.',
      'The file has been put back into an empty database to prove it works \u2014 every client, '
        + 'every matter, every rule \u2014 and that rehearsal now runs on every change, so a '
        + 'backup that would not restore cannot ship quietly.',
      'This is still a button somebody has to press. Nothing takes one for you overnight yet.',
    ],
  },
  {
    version: '1.17.0', date: '9 September 2026',
    notes: [
      'Four faults found by an audit, all fixed. Each one was a rule written into a single '
        + 'screen instead of into the database, which held until a second screen was written.',
      'Opening a matter from a document no longer leaves a half-made client behind when it fails. '
        + 'The owner is checked before anything is written, and Owner no longer offers "Nobody '
        + 'yet" \u2014 a matter must have one.',
      'A quotation can no longer be moved on to a different client from its matter\u2019s. The '
        + 'letter of engagement would have printed one person\u2019s name over another\u2019s '
        + 'file, and it is a contract.',
      'The letter of engagement was still leaving out clauses \u2014 it looked at the matter\u2019s '
        + 'kind of work or the fee lines\u2019, never both, and threw away the visa type you chose '
        + 'when making the quotation. All three are kept and all three are read.',
      'Converting an inquiry names the matter the way every other matter is named, rather than '
        + 'after its own description.',
    ],
  },
  {
    version: '1.16.1', date: '8 September 2026',
    notes: [
      'A security advisory published today against a development tool was stopping every deploy. '
        + 'It never touched the live register \u2014 the tool only runs on a developer\u2019s '
        + 'machine \u2014 but nothing ships with a known high-severity advisory anywhere.',
      'Updated and pinned to the patched version. Nothing about the register itself changed.',
    ],
  },
  {
    version: '1.16.0', date: '8 September 2026',
    notes: [
      'Incoming opens on the Inbox now, and the Inbox tab is first. That is where the work is: '
        + '122 pieces have come through it against 4 open inquiries.',
      'File selected and Delete selected have moved above the list, and only appear once you '
        + 'tick something. The bar tells you how many you have picked.',
      'With scripting switched off the two buttons are simply always there, as before.',
    ],
  },
  {
    version: '1.15.1', date: '8 September 2026',
    notes: [
      'Nine real names \u2014 six of your clients and three companies \u2014 had been used as '
        + 'worked examples inside the code, and have been replaced with invented ones. An audit '
        + 'found them; nothing in the register did.',
      'A check now runs on every build and fails if any of the nine appears again.',
      'The names are still in the commit history, which cannot be cleaned without rewriting '
        + 'published history. That is your decision rather than ours to make quietly.',
    ],
  },
  {
    version: '1.15.0', date: '8 September 2026',
    notes: [
      'The summary at the top of a matter is a summary again \u2014 four sentences at most \u2014 '
        + 'rather than the whole file note repeated. The full reading is still kept, in the file '
        + 'note underneath, which cannot be edited and is the record.',
      'The assistant now writes the two separately, and the check-it form has a box for each, so '
        + 'you can see what will head the matter and what will go on the file before you press.',
      'Matters opened before today still hold the long text in both places. The summary can be '
        + 'shortened by editing the matter; the note stays as it was written.',
      'Quotes and Invoices now sit together on a matter, quotes first. They were in different '
        + 'columns for no reason anybody had written down.',
    ],
  },
  {
    version: '1.14.0', date: '8 September 2026',
    notes: [
      'A quotation is named rather than described. You pick the visa type, add a word or two if '
        + 'it needs one, and the name is written for you \u2014 "VV. Parent Grandparent \u2014 '
        + 'Larisa MIKHAILOVA" \u2014 the same way a matter is named.',
      'The Scope paragraph is off the printed quotation, because the items are the scope. The '
        + 'name now heads the document as "Re", the way a letter\u2019s subject line does.',
      'A quotation can be pointed at a matter. Choose one and it takes the matter\u2019s name, '
        + 'type and client, so a quotation can no longer name one person and bill another.',
      'The catalogue no longer keeps its own copy of your visa types. It reads your own list, so '
        + 'a type you add under Settings stays quotable straight away \u2014 two of yours had '
        + 'already fallen out of the old copy, including the one you were quoting when you asked.',
      'Your standard items are untouched: Initial consultation, Professional time, and the five '
        + 'disbursements. Those are things you charge for rather than kinds of matter, so they '
        + 'stay in their own group.',
      'The letter of engagement was quietly leaving out the clauses that belong to the kind of '
        + 'work, on every quotation not attached to a matter. That is fixed.',
    ],
  },
  {
    version: '1.13.0', date: '8 September 2026',
    notes: [
      'Two more roles on a matter: Partner and Family member. Both sit next to Supporting '
        + 'partner in the list, because choosing between them is the point.',
      'Supporting partner means the partner the application turns on, whose relationship '
        + 'Immigration New Zealand will assess. Partner means simply the partner \u2014 on the '
        + 'file, not applying, nothing claimed through them. Family member is any other relative '
        + 'in the same position.',
      'The assistant can now propose either, and is told the difference: where a document does '
        + 'not show the relationship is being relied on, it picks the weaker one and leaves the '
        + 'judgement to you.',
    ],
  },
  {
    version: '1.12.0', date: '8 September 2026',
    notes: [
      'Every client now has their own INZ client number, on their page. It used to live on the '
        + 'matter, so the same person\u2019s number was typed again on every file they had \u2014 '
        + 'and two of your clients had ended up with two different numbers between them.',
      'The 87 numbers already in the register were moved onto the right people. Three could not '
        + 'be settled without you, and each is flagged on the file with a note naming every number '
        + 'found: CL-0041, CL-0231, and CL-0068 with CL-0252 \u2014 which look like the same '
        + 'person entered twice.',
      'Alerts has a new list, \u201cNo INZ client number\u201d, naming everybody with a live '
        + 'matter who still needs one. It shortens by one each time you fill one in.',
      'A search for a client number finds the person, so a letter from Immigration New Zealand '
        + 'quoting nothing else still lands you on the right file.',
      'The register refuses anything that is not six to twelve digits, and refuses giving two '
        + 'clients the same number \u2014 which is the surest sign the same person has been '
        + 'entered twice.',
    ],
  },
  {
    version: '1.11.0', date: '8 September 2026',
    notes: [
      'Clients can be tagged. Matters always could; clients never could, for no reason anybody '
        + 'wrote down. There is a Tags card on a client, and the client list filters by tag.',
      'It is one list of tags for both. A tag you invent on a matter is the same tag on a client, '
        + 'so there is one set of labels to keep in order rather than two that drift apart.',
      'Writing an email now looks like writing an email. The addresses sit stacked at the top, the '
        + 'subject under them, and the message fills the width with its formatting buttons '
        + 'attached to it \u2014 instead of the three columns the details forms use, which had '
        + 'scattered To, Copy to and Subject across the screen.',
      'To and Copy to accept several addresses separated by commas or semicolons. If one of them '
        + 'is not an address the whole message is held back and says which \u2014 rather than '
        + 'going to everybody else and leaving you to notice.',
    ],
  },
  {
    version: '1.10.0', date: '8 September 2026',
    notes: [
      'The letter of engagement exists. When you make a quotation you are now asked \u2014 and must '
        + 'answer \u2014 whether it goes out with a letter, and where it does there is a letter to '
        + 'read, print and send.',
      'The letter names no parties, no work and no fees. It refers to the quotation, which carries '
        + 'all three, so the two documents cannot end up disagreeing with each other.',
      'Your own wording has been entered for you from the letter you sent \u2014 the opening, the '
        + 'acknowledgements, the closing and five clauses. Please read it before you send one: it '
        + 'is your contract, and three passages were adapted because the quotation now carries '
        + 'what the letter used to repeat.',
      'Quotations, invoices and the letter were all being drawn in a narrow column about the width '
        + 'of the sign-in box, on any size of screen. They now use the width they have.',
    ],
  },
  {
    version: '1.9.0', date: '8 September 2026',
    notes: [
      'The assistant now fills in everything it read. An address for each person or company, a '
        + 'company\u2019s NZBN, and what the document says happens next on the matter \u2014 all '
        + 'of which it could see and had nowhere to put, so you typed them again from the same '
        + 'document.',
      'An NZBN is checked before it is stored. One read off a document can arrive spaced out or '
        + 'not be an NZBN at all, and stored as read it would be refused the next time you opened '
        + 'that client.',
      'For somebody already on the register, all of this fills in only what their record has left '
        + 'empty. Nothing you have recorded is ever written over by a reading.',
    ],
  },
  {
    version: '1.8.0', date: '8 September 2026',
    notes: [
      'The assistant now recognises everybody it has seen before, not only the client. An employer '
        + 'could never be matched at all \u2014 the check wanted a first name and a surname to '
        + 'agree, and a company has one name \u2014 and everybody other than the client was '
        + 'created afresh on every reading. Each person now offers the same choice: use the record '
        + 'already there, or create a new one.',
      'Given names are recorded in ordinary case: Van Hung, not VAN HUNG. Documents print the '
        + 'whole name in capitals, so everything read out of one arrived shouted \u2014 and '
        + 'capitalising only the surname is what shows at a glance which half is which.',
      'A name somebody has styled themselves \u2014 McKenzie, de Jong, Anne-Marie \u2014 is left '
        + 'exactly as it is.',
    ],
  },
  {
    version: '1.7.2', date: '8 September 2026',
    notes: [
      'Opening a matter onto a client who is already on the register now puts their surname into '
        + 'capitals if it was not, renames their matters to match, and notes it on their file. The '
        + 'assistant was reusing older records exactly as they stood, so a name loaded before that '
        + 'rule existed came through unchanged.',
    ],
  },
  {
    version: '1.7.1', date: '8 September 2026',
    notes: [
      'All 34 clients whose surname was not in capitals have been corrected, and the matters named '
        + 'after them with it. New clients have been capitalised on saving for a long time \u2014 '
        + 'these were older records loaded before that, and nothing goes back over a record nobody '
        + 'opens. Company names are untouched.',
      'An invisible line break had crept into 190 matter names this morning \u2014 it did not show '
        + 'on any page, but it was in the CSV export and in searches. Removed.',
    ],
  },
  {
    version: '1.7.0', date: '8 September 2026',
    notes: [
      'When the assistant reads a document, every person it found now has a \u201cPerson or '
        + 'company\u201d box you can set before anything is saved. An employer used to be created '
        + 'as a person with a very long surname, and the only fix was to spot it and edit the '
        + 'record afterwards.',
      'A company gets no date of birth, nationality or visa, and its registered name is kept '
        + 'exactly as written rather than put into capitals.',
      'Every person now has a \u201cWorks for\u201d box \u2014 or \u201cMain contact there\u201d '
        + 'on a company \u2014 offering the other people in the same reading and every company '
        + 'already on the register. Choosing one records both sides: the company knows who to '
        + 'ring, and the person\u2019s record says where they work and what they do there.',
      'A matter opened by the assistant is now named the same way as every other matter. That was '
        + 'fixed on the New matter form earlier today and this one was missed.',
    ],
  },
  {
    version: '1.6.0', date: '8 September 2026',
    notes: [
      'When the assistant reads a document to open a matter, the document is now kept and put on '
        + 'that matter. It used to be read and thrown away \u2014 so the letter you opened the '
        + 'matter from was not on the file, only the register\u2019s reading of it.',
      'The review screen lists the files before you press the button, so you can see exactly what '
        + 'is about to go on the file.',
      'Read something and never press the button, and the copy is deleted a week later. A client\u2019s '
        + 'document should not sit in storage because a page was closed.',
      'The notice on that page had been saying file storage was switched off. It was switched on '
        + 'on 29 August. It now says what is actually true, and says the opposite if storage is '
        + 'ever off.',
    ],
  },
  {
    version: '1.5.0', date: '8 September 2026',
    notes: [
      'The letter of engagement has somewhere to keep its words. Settings \u2192 Letter of '
        + 'engagement holds how the letter opens, what the client confirms and how it signs off. '
        + 'Quotes \u2192 Letter clauses holds the headed sections in the middle, and a clause can '
        + 'be limited to certain kinds of matter so the partnership pages do not turn up on an '
        + 'employer accreditation.',
      'Nothing is filled in for you, on purpose \u2014 this is your contract wording, not '
        + 'something the register should invent. Nothing is sent yet either: the letter itself is '
        + 'the next piece.',
      'A clause is switched off rather than deleted, so one you stop using does not disappear from '
        + 'the letters already sent. Only an administrator can edit them.',
      'Tick boxes on the quotation\u2019s people list were drawn with their words underneath them '
        + 'instead of beside them. Fixed.',
      'The quote and its covering email no longer describe your terms of engagement as something '
        + 'to read on a page \u2014 that address publishes the current edition as a file, and they '
        + 'now say so.',
    ],
  },
  {
    version: '1.4.1', date: '8 September 2026',
    notes: [
      'Matters are named again instead of being described twice. A matter now reads '
        + '\u201cPartner Resident Visa \u2014 Bao Long VUONG\u201d, with the description you '
        + 'wrote on the line underneath. Every matter already in the register has been renamed '
        + 'this way and not one description was changed.',
      'The New matter form had been putting your description into the name as well, which is why '
        + 'every list showed the same sentence twice and then ran out of room for the reference.',
      'If you correct the spelling of a client\u2019s name, their matters are renamed to match, '
        + 'and a note on their file says so.',
      'The people you record on a quotation are now printed on it, under \u201cThe parties\u201d '
        + '\u2014 with who is nominated to give instructions, and what an agency contact may and '
        + 'may not do. Your letter of engagement can refer to the quotation instead of restating '
        + 'any of it.',
      'Nothing on the dashboard or the alerts list is cut off any more. Rows were limited to two '
        + 'lines, so narrowing the window hid the end of them. A row that needs three lines now '
        + 'takes three lines.',
    ],
  },
  {
    version: '1.4.0', date: '8 September 2026',
    notes: [
      'A quotation can now name everybody the engagement is with, not just the client \u2014 the '
        + 'other applicants, the partner and children whose details the application needs, and '
        + 'anybody at an agency who may be told how it is going. Each with their relationship in '
        + 'your words and their date of birth.',
      'One of them can be nominated to instruct on everybody\u2019s behalf. If nobody is, it is '
        + 'the client, which is what your letter of engagement already says.',
      'This is the first piece of the letter of engagement. The letter will name nobody itself: '
        + 'the quotation is the substance and the letter refers to it.',
    ],
  },
  {
    version: '1.3.1', date: '8 September 2026',
    notes: [
      'Reminder emails now link to app.immigration.kiwi \u2014 the address you sign in on. They '
        + 'were still pointing at the address the register was first put up on, which works but '
        + 'is not yours. That older address still answers, on purpose: it is the way back in if '
        + 'the domain ever has a problem.',
    ],
  },
  {
    version: '1.3.0', date: '8 September 2026',
    notes: [
      'Several messages in Incoming can be filed onto a matter or client in one go. Tick them, '
        + 'press File selected, pick the matter, and each one is written onto the file as its own '
        + 'note. Nothing is deleted \u2014 the messages stay in the inbox under Filed and any of '
        + 'them can be put back.',
      'A message that has already been filed cannot be filed again, and one that became an '
        + 'inquiry can be filed but still cannot be deleted. You are shown exactly what is about '
        + 'to happen before anything does.',
      'File notes have a \u201cStatus query\u201d kind, and \u201cPreliminary consultation\u201d '
        + 'is now called \u201cConsult\u201d. \u201cEmail sent\u201d and \u201cEmail '
        + 'received\u201d are no longer offered when writing a note by hand.',
      'Whether somebody is a lead or a client is now the first thing on the New client form, '
        + 'under \u201cWho this is\u201d. It was on the fifth tab, where nobody would look for it.',
      'One of those note kinds never worked: \u201cPreliminary consultation\u201d had been on the '
        + 'form for a week and the register refused it every time. It is fixed, and the list is no '
        + 'longer something the database has an opinion about.',
    ],
  },
  {
    version: '1.2.2', date: '8 September 2026',
    notes: [
      'Quotes now point clients at www.immigration.kiwi/terms \u2014 the same address your letter '
        + 'of engagement sends them to. They had been pointing at a PDF at a different address on '
        + 'the same site, so a client reading both was shown two documents to accept.',
      'And the quote asks clients to \u201cread\u201d the terms rather than \u201cdownload\u201d '
        + 'them, which is what actually happens when they press the link.',
    ],
  },
  {
    version: '1.2.1', date: '7 September 2026',
    notes: [
      'When the assistant cannot read something, it now tells you why in a sentence \u2014 whether '
        + 'it was cut off part-way, the model declined, the account is out of credit, or Anthropic '
        + 'is busy. It used to say only \u201cmodel returned no structured output\u201d, which '
        + 'could mean any of those.',
      'It also gets more room to answer than it had, which is what caused the failure that '
        + 'prompted this: a long handover ran past the space allowed and was cut off mid-sentence.',
      'Certificate expiries that were worked out from an issue date nobody checked have left '
        + '\u201cNeeds you today\u201d. They are on the Alerts page under \u201cWorked out, never '
        + 'confirmed\u201d instead \u2014 a guessed date cannot tell you a certificate has expired, '
        + 'only that nobody has looked. Confirm the date on the client and it comes back as a real '
        + 'expiry.',
    ],
  },
  {
    version: '1.2.0', date: '4 September 2026',
    notes: [
      'A knowledge base article can carry files. The New article form takes them \u2014 several at '
        + 'once \u2014 and every article has a Files panel to add more later, open them, or take one '
        + 'out. The circular itself can now live with the note about it.',
      '\u201cGeneral practice note\u201d is a kind of article: what we do about something, as '
        + 'opposed to what somebody outside has instructed. The full list is yours to edit under '
        + 'Settings \u2192 Knowledge base.',
    ],
  },
  {
    version: '1.1.2', date: '4 September 2026',
    notes: [
      'The menu on a phone shows everything again. It used to be one row you had to swipe '
        + 'sideways, with nothing to say there was more past the edge \u2014 so Calendar, Tasks, '
        + 'Money and Tools were out of sight, and Quotes and Invoices were not being drawn at '
        + 'all. It now takes two rows and they are all there, with Money and Tools opening into '
        + 'the bar when you press them.',
      'Sticky column headings on a long table sit under the top bar instead of behind it.',
      'The Invoices pages no longer light up Quotes in the menu.',
    ],
  },
  {
    version: '1.1.1', date: '4 September 2026',
    notes: [
      'Housekeeping. The demonstration data can be loaded and removed again \u2014 it had quietly '
        + 'stopped working against the current database, and a test now runs it so that cannot '
        + 'happen unnoticed. Some unused encryption code was removed with it.',
    ],
  },
  {
    version: '1.1.0', date: '4 September 2026',
    notes: [
      'The Fees section has gone. Money is in Quotes and Invoices and nowhere else \u2014 a matter '
        + 'now shows what has been billed on it, what is paid and what is outstanding, with a '
        + 'button to raise an invoice.',
      'A bill can be divided between parties. Open an invoice while it is still a draft, press '
        + '\u201cDivide this bill between parties\u201d and add who gets what. It splits '
        + 'professional fees only \u2014 not disbursements, which are somebody else\u2019s money '
        + 'passing through. If you set a split it has to come to 100% before the invoice will '
        + 'issue. Most bills are not split and nothing changes for those.',
      'Choosing from the price list now works on an invoice line, and what you type still beats '
        + 'what the list says.',
    ],
  },
  {
    version: '1.0.3', date: '4 September 2026',
    notes: [
      'You can raise an invoice without writing a quote first \u2014 Invoices \u2192 New invoice. '
        + 'Choose the client, optionally one of their matters, say what it is for, add the lines, '
        + 'then issue it. Nothing is fixed until you issue.',
      'An invoice has always been able to take part payments: open it and use Record a payment, '
        + 'as many times as you need. Each one keeps its date, method and reference, and none can '
        + 'be edited or deleted afterwards \u2014 a wrong amount is corrected by another entry.',
    ],
  },
  {
    version: '1.0.2', date: '4 September 2026',
    notes: [
      'Builds no longer fail when npm\u2019s own servers are down. A real security problem in a '
        + 'dependency still stops a release \u2014 nothing has been relaxed \u2014 but an '
        + 'unreachable registry now says so plainly instead of looking like a broken build.',
      'There is a new prompt for turning a working conversation with Claude into a file note the '
        + 'register can use \u2014 docs/case-note-prompt.md. It writes the note, lists the fields '
        + 'it actually settled, and tells you what is still unconfirmed.',
    ],
  },
  {
    version: '1.0.1', date: '4 September 2026',
    notes: [
      'The panel that was called \u201cTimeline\u201d on a client, an inquiry and a quote is now '
        + 'called \u201cFile notes\u201d, which is what the matter page and the search results '
        + 'already called it. Same panel, same entries \u2014 one name.',
      '\u201cFile note\u201d is now one of the categories you can file a document under.',
    ],
  },
  {
    version: '1.0.0', date: '4 September 2026',
    notes: [
      'A matter marked Approved or Declined now always carries the date it was decided. Entering '
        + 'an already-granted matter through the intake tool used to leave that blank, which is '
        + 'why one of yours said \u201cDecided \u2014\u201d. Nine older matters are still blank; '
        + 'they are listed on the Alerts page and you can now fill them in.',
      'The matter form has a \u201cDecided on\u201d box. Use it when a decision arrived before '
        + 'the file reached the register, or to correct a date.',
      'Key details on a matter now says \u201cDecision: Approved \u00b7 04 Sept 2026\u201d rather '
        + 'than a bare date under a heading that never said which way it went. It also shows how '
        + 'long INZ took, or how long it has been waiting; the due date disappears once a matter '
        + 'is decided; and the priority is only shown when it is not Normal.',
    ],
  },
  {
    version: '0.99.3', date: '4 September 2026',
    notes: [
      'The tick-box column on the inbox was taking up far more room than a tick box needs, '
        + 'squeezing the subject line. It is now exactly as wide as the box. The same fix '
        + 'applies to the \u201cFinished with?\u201d list of clients.',
      'The cause turned out to affect eleven of the register\u2019s seventeen tables: each was '
        + 'asking for column widths the styling did not actually define, so the browser guessed. '
        + 'Alerts, cases, clients, conversations, quotes, invoices and a few others now lay out '
        + 'the way they were meant to.',
    ],
  },
  {
    version: '0.99.2', date: '3 September 2026',
    notes: [
      'Themes now apply the moment you press one. Go to your account, press a palette, and the '
        + 'page comes back in it \u2014 same for light and dark. There is no longer a Save '
        + 'button, because there is nothing left to save. Pressing a theme leaves your light or '
        + 'dark choice alone, and the other way round.',
    ],
  },
  {
    version: '0.99.1', date: '3 September 2026',
    notes: [
      'The calendar\u2019s buttons are in a sensible order now \u2014 Week, Month, Year \u2014 '
        + 'and the stray button on the far right has gone. In its place there is one '
        + '\u201cToday\u201d button sitting with the others: press it from anywhere and you land '
        + 'on today, in whichever view you are already using, with your filters kept.',
    ],
  },
  {
    version: '0.99.0', date: '3 September 2026',
    notes: [
      'Clients has a new view, \u201cFinished with?\u201d, for people whose matters are all '
        + 'closed and whose visa, passport and certificates have all run out \u2014 the ones '
        + 'whose expiry alerts you cannot do anything about because they have moved on. It only '
        + 'appears when there is somebody in it, and anyone with a matter running, or anything '
        + 'still in date, is left off it.',
      'You can tick several of them and archive them in one go. Archiving stops their expiry '
        + 'alerts and takes them off the calendar. Nothing is deleted \u2014 the file, the '
        + 'matters and the notes all stay, and changing the status back brings them with it. '
        + 'You see everyone by name and press a second button before anything is written.',
    ],
  },
  {
    version: '0.98.0', date: '3 September 2026',
    notes: [
      'The calendar now has a week and a year view as well as the month. The week gives each day '
        + 'a full column, so a busy day shows everything on it rather than \u201c+4 more\u201d. '
        + 'The year is twelve small months \u2014 click any month name or any marked day to go '
        + 'straight there.',
      'How far back the unbilled-work alert looks is now a list to choose from \u2014 off, 30, '
        + '60, 90, 120, 150 or 200 days, or a year \u2014 rather than a number to type. Widen it '
        + 'as the fees on file get more complete.',
    ],
  },
  {
    version: '0.97.0', date: '3 September 2026',
    notes: [
      'Every heading on the dashboard cards now sorts. Click one to sort by it, click again to '
        + 'reverse \u2014 on Needs you today, Deadlines and My open cases. Sorting one card no '
        + 'longer disturbs the others.',
      'A new alert for work you finished and never charged for. It looks at matters finished in '
        + 'the last ninety days, leaves them alone for a fortnight first, and ignores anything '
        + 'with a fee, an invoice or an agreed amount already on it. Both periods are yours to '
        + 'change under Settings \u2192 Alerts, and setting the first to zero turns it off.',
    ],
  },
  {
    version: '0.96.0', date: '3 September 2026',
    notes: [
      'A calendar. Your month laid out \u2014 deadlines, tasks, visa and passport and certificate '
        + 'expiries, invoices, and what already happened: when each matter was lodged and decided. '
        + 'The coloured keys under the month are the filter: click one to take that kind off. '
        + '\u201cMine\u201d narrows it to your own matters and tasks. On a phone the month steps '
        + 'aside and the list takes over.',
      'It changes nothing. Every date on it belongs to a record, and is edited on that record.',
    ],
  },
  {
    version: '0.95.0', date: '3 September 2026',
    notes: [
      'The dashboard now leads with what is actually late. It was sorting by date alone, so an old '
        + 'record that needed tidying sat above a reply due this afternoon \u2014 those rows are '
        + 'still there, just below the things with a clock on them.',
      'Needs you today and Deadlines can both be re-ordered and opened out, and they now show as '
        + 'many rows as your Rows per page setting rather than stopping at a fixed number.',
      'If mail stops arriving, the register will now say so. It cannot see your mailbox, but it '
        + 'knows when it last received anything \u2014 so a break in forwarding no longer looks '
        + 'the same as a quiet week.',
    ],
  },
  {
    version: '0.94.0', date: '2 September 2026',
    notes: [
      'A new button on the Inbox, Read the post. It reads what is waiting and tells you what each '
        + 'piece looks like \u2014 a PPI letter with the date you must reply by, a decision, a '
        + 'request for documents, or just a circular \u2014 and which matter it belongs to. '
        + 'It changes nothing at all: it tells you, and you decide. Press it when you want it; it '
        + 'never runs on its own.',
    ],
  },
  {
    version: '0.93.0', date: '2 September 2026',
    notes: [
      'Everything that arrives now waits in the Inbox. Mail from a known sender used to become an '
        + 'inquiry on its own, without passing through, so the post was in two places \u2014 now '
        + 'there is one place to look and you decide what each message becomes.',
      'You can tick several messages in the Inbox and delete them in one go. It shows you exactly '
        + 'what is about to be deleted before anything happens, and it will not delete a message '
        + 'that became an inquiry or has been filed onto a matter, because those point back at it.',
    ],
  },
  {
    version: '0.92.0', date: '1 September 2026',
    notes: [
      'Two new things under Admin \u2192 Export. Your client list now includes the INZ client '
        + 'number, gathered from that person\u2019s matters, and there is a new download for the '
        + 'dropdown lists you can edit \u2014 case types, visa types and the rest. Both are what '
        + 'the folder-reading session needs before it starts, and neither could be produced before.',
    ],
  },
  {
    version: '0.91.2', date: '1 September 2026',
    notes: [
      'The folder-reading instructions were corrected after a second opinion. One example in them '
        + 'had been copied from a real file note \u2014 a wage figure, no name attached \u2014 and '
        + 'is now invented and checked. Nothing in the register itself changed.',
    ],
  },
  {
    version: '0.91.1', date: '1 September 2026',
    notes: [
      'The instructions for reading your folders were rewritten into one document. There were two, '
        + 'and they had already started disagreeing \u2014 one still said to identify a person by '
        + 'their passport number, which is the opposite of what you decided. Nothing in the register '
        + 'itself changed.',
    ],
  },
  {
    version: '0.91.0', date: '1 September 2026',
    notes: [
      'The top of every list now looks the same. Cases has Open, Mine and All across the top with '
        + 'a count on each \u2014 the same shape Clients already had \u2014 and two of the six '
        + 'dropdowns are gone, because they were never filters. The Knowledge base gets the same '
        + 'row, and Fees shows its figures before the dates that narrow them rather than after.',
    ],
  },
  {
    version: '0.90.0', date: '1 September 2026',
    notes: [
      'If a client or a matter is ever removed from the register, the register now records it '
        + 'itself \u2014 which file, what it was called and when it went. Before this, a record '
        + 'taken out from behind the scenes left no trace at all. Removing a client also records '
        + 'each of their matters, so every file number is accounted for.',
    ],
  },
  {
    version: '0.89.5', date: '1 September 2026',
    notes: [
      'Editing a fee line saves again. Saving, changing a status and deleting a fee all returned '
        + '\u201cNot found\u201d \u2014 a missing bracket in the code meant those three actions '
        + 'were never wired up, though the forms drew perfectly. Nothing you typed was at fault, '
        + 'and nothing was lost.',
    ],
  },
  {
    version: '0.89.4', date: '1 September 2026',
    notes: [
      'Showing 250 matters or 250 clients at once works again. Asking for a big page brought up '
        + '\u201cSomething went wrong\u201d \u2014 the page was asking the database for too much '
        + 'in one go, which only became possible once the register held enough records to fill a '
        + 'page that size.',
    ],
  },
  {
    version: '0.89.3', date: '1 September 2026',
    notes: [
      'A company can be saved again. \u201cCreate client\u201d did nothing at all when the record '
        + 'type was a company \u2014 the family name box, which belongs to a person and is hidden '
        + 'for a company, was still being treated as compulsory by the browser. Nothing was wrong '
        + 'with what you had typed.',
    ],
  },
  {
    version: '0.89.2', date: '1 September 2026',
    notes: [
      'The rest of the register searches the same way. Cases, Quotes, Invoices, Knowledge, the '
        + 'Incoming list and conversations all had the same fault as the client list, and all now '
        + 'find what you are looking for whichever order you type the words in. Cases matters '
        + 'most \u2014 a matter is found by its client\u2019s name as often as by its own.',
    ],
  },
  {
    version: '0.89.1', date: '1 September 2026',
    notes: [
      'Searching a name now works whichever way round you type it. The register stores a name '
        + 'as it appears on the passport \u2014 given names first \u2014 so searching '
        + '\u201cGARCIA Maria Luisa\u201d, the way you and INZ write it, found nothing, while '
        + '\u201cLuisa\u201d on its own worked. Every word now counts on its own and all of '
        + 'them have to appear, so any order finds the person. It applies to the client list, '
        + 'the search box at the top, and the box for filing an email onto a matter.',
    ],
  },
  {
    version: '0.89.0', date: '1 September 2026',
    notes: [
      'Filing an email searches instead of scrolling. \u201cFile it on a matter or client\u201d was '
        + 'one long list of everything in the register; it is now a search box. Type a family name, '
        + 'a reference, or the INZ application number off the letter, and pick from what comes back. '
        + 'Closed matters are included and marked as closed \u2014 a decision letter on a matter you '
        + 'closed last week is exactly the thing you file.',
      'A date in a page heading shows as a date. On the inbox and inquiry pages it had been '
        + 'appearing as a line of tags instead.',
    ],
  },
  {
    version: '0.88.0', date: '1 September 2026',
    notes: [
      'A warning can be changed or removed. \u201cChange it\u201d reworks the wording or the '
        + 'kind without taking the warning down; \u201cDelete it instead\u201d is for one that '
        + 'should never have been on the file at all \u2014 raised on the wrong person, or a '
        + 'duplicate. Taking a warning down still keeps it as history, which is the difference '
        + 'between the two. Either way, what it said goes into the audit log.',
      'A warning says where it came from. When a warning was read off a matter \u2014 a decline '
        + 'letter, a PPI response \u2014 the band names that matter and links to it, so the fact '
        + 'can be checked in one press rather than taken on trust. A warning typed in by hand, '
        + 'from a conversation, simply has nothing to cite, and that is the ordinary case.',
    ],
  },
  {
    version: '0.87.0', date: '1 September 2026',
    notes: [
      'A matter can be \u201cUnder INZ investigation\u201d. It is a status rather than a kind of '
        + 'work, because that is what it is \u2014 something that happens to a file, whatever the '
        + 'application underneath it was. A matter can go into it from anywhere it is still live, '
        + 'and come back out to anywhere it was going.',
    ],
  },
  {
    version: '0.86.0', date: '1 September 2026',
    notes: [
      'A fee line can be billed from the price list. \u201cAdd a fee line\u201d on a matter now '
        + 'offers the same list quotes and invoices bill from \u2014 pick one and it fills in the '
        + 'description, what type of charge it is and how GST is treated, and the amount if the '
        + 'list has one. Change anything you like before adding it.',
      'Most of the price list is still at $0.00, which the register reads as \u201cno price set '
        + 'yet\u201d rather than \u201cfree\u201d \u2014 so it asks you for the amount. Put your '
        + 'standard prices in under Quotes \u2192 Price list and they will fill in from then on.',
    ],
  },
  {
    version: '0.85.0', date: '1 September 2026',
    notes: [
      'Invoices has its own place in the Money menu, between Quotes and Fees \u2014 the order the '
        + 'work happens in. The page itself has been there since June; it could only be reached '
        + 'through a tab on the quotes list, which is to say only if you already knew it was there. '
        + '\u201cWhat are we owed\u201d is a question to ask the register directly.',
    ],
  },
  {
    version: '0.84.0', date: '1 September 2026',
    notes: [
      'A file can carry a warning. Press \u201cRaise a warning\u201d on a client or a matter, say '
        + 'in a sentence what somebody needs to know \u2014 \u201cassaulted by a former partner, '
        + 'reported to Police\u201d \u2014 and it shows in an amber band at the very top of that '
        + 'record, above everything.',
      'A warning on a client shows on all of their matters, because the fact is about the person. '
        + 'One you had to raise again on every new file is one that stops being raised.',
      'Choose how long it stands: until you take it down, or 30 days, three months, six months or '
        + 'a year for something true only for a season. One past its date stops showing on its own.',
      'Taking one down asks why, and keeps it. A warning that stood on a file for six months is '
        + 'part of how that file was handled \u2014 the ones no longer showing are listed under '
        + '\u201cWarnings taken down\u201d and any of them can be put back.',
      'The kinds \u2014 safety, character, health, immigration history, contact, money \u2014 are '
        + 'yours to change in Settings, like every other list.',
    ],
  },
  {
    version: '0.83.0', date: '1 September 2026',
    notes: [
      'A matter opened from a document now has a description, like every other matter. That form '
        + 'was still asking for a title after the rest of the register stopped, so the one matter '
        + 'opened that way arrived with nothing in the column the case list and the file both read. '
        + 'It has been repaired.',
      'Passports and certificates have moved out of the narrow column and into the main one, with '
        + 'proper buttons \u2014 \u201cAdd another passport\u201d and \u201cAdd a police '
        + 'certificate, medical or x-ray\u201d. A passport is the document a file works from; it '
        + 'does not belong in the margin.',
      'Every country is now chosen from the same list, never typed. The register held 30 passports '
        + 'issued by \u201cViet Nam\u201d and 9 by \u201cVietnam\u201d \u2014 the same country, '
        + 'which could never be counted or matched as one. They are now one country, and the '
        + 'database refuses anything that is not on the list.',
      'The Immigration tab of a client\u2019s form has a button through to their certificates. '
        + 'They stay separate records rather than one set of dates, because a client may hold '
        + 'police certificates from three countries at once and a new medical must never overwrite '
        + 'the one a March application relied on.',
      'Knowledge base articles carry their year: KB-26-001 rather than KB-0001, like a matter\u2019s '
        + 'reference. Immigration instructions date quickly, so when an article is from is part of '
        + 'what it is. The one article already filed has been renumbered.',
    ],
  },
  {
    version: '0.82.0', date: '1 September 2026',
    notes: [
      'A file note can be corrected for five minutes after you save it, and only once. Press '
        + '\u201cCorrect this note\u201d under the note itself. After five minutes it stands, and '
        + 'a correction goes in as a new note \u2014 which is what makes the file worth something '
        + 'in a complaint or an appeal. What the note said before is kept in the audit log either '
        + 'way, so nothing is lost even inside the five minutes.',
      'Notes can be recorded as a \u201cPreliminary consultation\u201d.',
      'Wherever the register shows when something happened, it now shows the time as well as the '
        + 'date, a size or two smaller than the words around it. A file with two notes written the '
        + 'same afternoon has to be able to say which came first.',
      '\u201cBrief\u201d is now one of the document categories.',
    ],
  },
  {
    version: '0.81.0', date: '31 August 2026',
    notes: [
      'A person may now hold more than one nationality. The register held one, so a partnership '
        + 'file naming a dual Vietnamese and New Zealand partner recorded neither. Every client '
        + 'form has a box for each nationality held and one spare \u2014 fill the spare and save, '
        + 'and the next one appears. Everyone already on the register keeps exactly the '
        + 'nationality they had.',
      'The reading form has the boxes it was missing. Current visa and visa expiry for the client '
        + 'and for everybody else named, and nationalities for all of them. These were columns the '
        + 'register already had; they were missing from that one form, so a document that gave '
        + 'them had nowhere to put them and they were lost on the way in.',
      'What the reading says is kept as a file note on the matter, in full. Most of what these '
        + 'summaries carry has no box of its own \u2014 a relationship history, previous '
        + 'marriages and their dates, where a child lives, an address, something reported to '
        + 'Police \u2014 and it is now on the file rather than only on the screen you checked. '
        + 'The summary box is twelve lines instead of four, so you can read it before pressing '
        + 'the button.',
      'Choosing an existing client on that form fills in only the boxes that record has left '
        + 'empty. A document is evidence of what somebody wrote once; it never overwrites what '
        + 'the practice has since corrected.',
    ],
  },
  {
    version: '0.80.0', date: '31 August 2026',
    notes: [
      'The reader takes Word documents. Drop a .docx into \u201cOpen a matter from what you '
        + 'already have\u201d and it is read like anything else \u2014 headings, paragraphs and '
        + 'the rows of a table all come through. It was refused before because a .docx is not a '
        + 'document in the way a PDF is: it is a zipped folder, and nothing here could open it. '
        + 'Now it can.',
      'Two things it still will not read, and will say so plainly: the older .doc format, which '
        + 'Word has not written by default for twenty years, and a password-protected document.',
      'A correction on that page. It said passport numbers are not extracted because the column '
        + 'is encrypted. The reason is right and the explanation was out of date \u2014 that '
        + 'column stopped being encrypted on 30 August, by the practice\u2019s own decision. '
        + 'Passport numbers are still never extracted, and still stay out of exports.',
    ],
  },
  {
    version: '0.79.0', date: '31 August 2026',
    notes: [
      'Every section on a matter now folds. Press a heading \u2014 Status, Parties, Tasks, '
        + 'Files, Key details, any of them \u2014 and that section closes, so a long file can be '
        + 'put back to the parts you opened it for. They all start open, so nothing is hidden '
        + 'from you; the fold is not remembered between visits.',
      'Fees is the exception and still starts closed, for the reason it always has: it is the '
        + 'one thing on the page a client leaning over the desk should not read by accident. It '
        + 'is now called simply \u201cFees\u201d rather than \u201cFees and split\u201d.',
    ],
  },
  {
    version: '0.78.1', date: '31 August 2026',
    notes: [
      'Saving a split on a matter works again. Pressing \u201cSave split\u201d \u2014 to change '
        + 'a percentage or remove a party \u2014 answered \u201cNot found\u201d. The address the '
        + 'form posts to was being read as a fee line\u2019s address, so the register went looking '
        + 'for a fee that does not exist. Nothing was lost: the split was never saved, so no '
        + 'figures were wrong in the meantime.',
      'A menu heading in the top bar no longer nudges upwards when you open it. The bar held '
        + 'still, but the word you pressed moved six pixels.',
    ],
  },
  {
    version: '0.78.0', date: '31 August 2026',
    notes: [
      'A matter is now named by what it is about. The new-matter form asks one question '
        + '\u2014 \u201cWhat this matter is about\u201d \u2014 and that sentence is the '
        + 'matter\u2019s name everywhere: \u201cFresh application, chef role with her current '
        + 'employer\u201d rather than \u201cGARCIA, Maria Luisa \u2014 Accredited Employer Work '
        + 'Visa\u201d, which was the client column and the type column read back. Every '
        + 'existing matter has been renamed to its description; the one matter that had no '
        + 'description kept its title as one, so nothing was lost.',
      'The Matter column is back on the case list, because it now says the one thing no '
        + 'other column says. You can still switch it off in your account settings.',
      'The menus in the top bar behave. The bar no longer grows taller when you open one, '
        + 'only one opens at a time, and a menu closes when you click anywhere else or '
        + 'press Escape. On a phone there are no menus at all \u2014 every section sits in '
        + 'the strip you swipe.',
    ],
  },
  {
    version: '0.77.0', date: '31 August 2026',
    notes: [
      'The menu across the top fits on one line again. Quotes and Fees sit under '
        + '\u201cMoney\u201d, Knowledge and the Assistant under \u201cTools\u201d, and Settings and '
        + 'Help have moved to the top right beside your name. Nothing has gone \u2014 the '
        + 'headings open when you press them.',
    ],
  },
  {
    version: '0.76.0', date: '31 August 2026',
    notes: [
      'The case list drops the Matter and Decision columns. On most matters the title '
        + 'was the client\u2019s name and the type over again, which the columns beside it '
        + 'already say, and a decision\u2019s date now sits under the status badge that says '
        + 'which decision it was. Both can be switched back on in your account settings.',
      'A Clear button on the case filters, shown only when something is filtered.',
      'The Clients page no longer says \u201cEveryone the practice acts for\u201d. The list '
        + 'holds employers, sponsors, supporting partners and agents too, and the practice '
        + 'does not act for them.',
    ],
  },
  {
    version: '0.75.0', date: '31 August 2026',
    notes: [
      'Cases can now be filtered by type \u2014 AEWV, partner residence, visitor visa and the '
        + 'rest \u2014 and the list shows the type, the date it was lodged with INZ, and the '
        + 'decision date once there is one.',
      '\u201cKey date\u201d is now \u201cDecision\u201d and says which date it is showing. On an '
        + 'approved or declined matter it shows when the decision came, not the deadline that '
        + 'has passed.',
      '\u201cINZ \u2014 further information requested\u201d is gone: \u201cPPI / RFI letter received\u201d '
        + 'covers both. \u201cAppeal / reconsideration\u201d is now two statuses, \u201cIPT appeal\u201d '
        + 'and \u201cReconsideration\u201d, because they are different places with different clocks.',
      'Filing something twice is refused, and the dates on last week\u2019s release notes were '
        + 'wrong by a day \u2014 corrected.',
    ],
  },
  {
    version: '0.74.1', date: '31 August 2026',
    notes: [
      'Help was telling you passport numbers are stored encrypted. They have not been since '
        + '30 August, when the practice decided otherwise \u2014 corrected in the four places it '
        + 'said so.',
      'Help now covers the Files section on clients and matters, filing things out of Incoming, '
        + 'and the rows-per-page choice.',
    ],
  },
  {
    version: '0.74.0', date: '31 August 2026',
    notes: [
      'Anything in Incoming \u2014 an inbox message, an inquiry, a conversation \u2014 can now be '
        + 'filed onto a matter or a client. A note appears on that record with the date, '
        + 'who it was from and the text, and the item leaves the working list.',
      'Filed things are never deleted. They move to a \u201cFiled\u201d tab, and one press puts '
        + 'them back. The note written when you filed it stays on the file either way.',
    ],
  },
  {
    version: '0.73.1', date: '31 August 2026',
    notes: [
      'Previous and Next now also sit above each list, so you can turn the page without '
        + 'scrolling to the bottom and back.',
      'Adding a user (Settings \u2192 Users) is behind a button too, like adding a task.',
      'The task list drew its \u201cattached to\u201d column with one database lookup per row \u2014 '
        + 'fine at 25 rows, close to a hard limit at 500. It now does the same work in a '
        + 'handful of lookups however long the page is.',
    ],
  },
  {
    version: '0.73.0', date: '31 August 2026',
    notes: [
      'The New task button now sits at the top of the task list, beside the filter. '
        + 'The form drops down over the list rather than pushing it out of the way.',
      'Clients, Cases and Tasks now open showing everything, not filtered. Tasks used '
        + 'to open on your own only, and Cases on open matters only — both now start '
        + 'with the lot, and the filter is still there when you want to narrow it. '
        + 'If you had set either of those yourself, that setting has been cleared so '
        + 'the new starting point applies; set it again in Settings if you prefer.',
    ],
  },
  {
    version: '0.72.1', date: '31 August 2026',
    notes: [
      'The task list ends with the list again: the New task form is now behind a '
        + '“New task” button, and opens only when you press it.',
    ],
  },
  {
    version: '0.72.0', date: '31 August 2026',
    notes: [
      'When a matter is approved or declined, the date the decision arrived now shows '
        + 'beside the status. It was always recorded — it was just further down the page.',
      'The “Response / decision due” box no longer appears when a matter is decided. '
        + 'It is for a date you are still waiting for, not the date a decision came, '
        + 'and offering it on an approval invited exactly that mix-up.',
      'The line beside Approved said “Granted.”, which is the same word twice. It now '
        + 'says what to do next, like every other status.',
    ],
  },
  {
    version: '0.71.0', date: '31 August 2026',
    notes: [
      'Clients, Cases and Tasks now let you choose how many rows to show — 25, 50, '
        + '100, 250 or 500 — from under the list itself, rather than only in Settings. '
        + 'The list also says which rows you are looking at.',
      'The task list was showing at most 200 tasks and giving no sign there were more. '
        + 'It now pages properly, so nothing is hidden.',
    ],
  },
  {
    version: '0.70.2', date: '31 August 2026',
    notes: [
      'A certificate issue date can now be recorded as read off the scan by OCR. '
        + 'It stays flagged, like a filename date, until a person confirms it '
        + 'against the certificate.',
    ],
  },
  {
    version: '0.70.1', date: '31 August 2026',
    notes: [
      'The Files release is now actually live: its first version was stopped at the door '
        + 'by the register’s own safety rule (a note may never lose its attachment), and '
        + 'was rebuilt to respect it. Nothing was lost.',
    ],
  },
  {
    version: '0.70.0', date: '31 August 2026',
    notes: [
      'Every client and matter page now has a Files section, grouped under headings '
        + '(Identity, Health, Character and so on — editable in Settings).',
      'A file can be an upload or a link to a drive such as Google Drive. For a linked '
        + 'file, the drive’s own sharing settings decide who can open it.',
      'A client’s document can be shown on their matter without copying it.',
    ],
  },
  {
    version: '0.69.2', date: '30 August 2026',
    notes: [
      'Leftover notes, tasks and AI runs that still pointed at the removed '
        + 'demonstration data have been cleaned away, and the demonstration-data '
        + 'clear now takes such records with it. Real records are untouched.',
    ],
  },
  {
    version: '0.69.1', date: '30 August 2026',
    notes: [
      'On a wide monitor the menu, search box and account controls now sit above the '
        + 'content instead of stretching to the corners of the window.',
    ],
  },
  {
    version: '0.69.0', date: '30 August 2026',
    notes: [
      'Passport numbers now show on the client’s page like any other detail — no '
        + 'separate reveal step. Changing or removing one is still recorded.',
      'They still never appear in the CSV exports; the export says only whether a '
        + 'passport is on file.',
    ],
  },
  {
    version: '0.68.0', date: '30 August 2026',
    notes: [
      'A matter can now name a Lawyer or a Licensed immigration adviser among its parties — '
        + 'for counsel on the file who is not the matter’s own assigned person.',
    ],
  },
  {
    version: '0.67.0', date: '30 August 2026',
    notes: [
      'Recording a passport number now refuses loudly if the register’s encryption key is '
        + 'missing, instead of silently saving nothing while saying it saved.',
      'The protections around passport numbers, dates of birth and sign-in — the sealed '
        + 'reveal, the export, session expiry and the two-factor door — are now attacked by '
        + 'tests on every deploy, before any real client data goes behind them.',
    ],
  },
  {
    version: '0.66.0', date: '30 August 2026',
    notes: [
      'A certificate’s issue date now records where it came from — read off the '
        + 'certificate, taken from a filename, or unconfirmed. An expiry worked out from an '
        + 'unconfirmed date is flagged wherever it appears, until somebody checks the paper '
        + 'and presses the button.',
      'A visa that expires “so many months after arrival” can be recorded as exactly that. '
        + 'The expiry shows as not yet fixed rather than blank, and the register asks for '
        + 'the date once the client has arrived.',
    ],
  },
  {
    version: '0.65.0', date: '30 August 2026',
    notes: [
      'A message forwarded into the bot from a group or channel is captured properly again. '
        + 'One such forward could be refused by the register’s own rules and never '
        + 'recorded at all.',
      'Deleting an inquiry the register refuses to delete no longer leaves a record saying it '
        + 'was deleted. The audit log records only what actually happened.',
      'A security test suite now attacks the register’s defences — its database '
        + 'rules, its headers, the email display, and who may reach what — on every '
        + 'deploy, so they stay proven rather than assumed.',
    ],
  },
  {
    version: '0.64.0', date: '30 August 2026',
    notes: [
      'Emails are now shown the way they were sent \u2014 paragraphs, lists, tables and links '
        + 'kept \u2014 instead of being flattened to plain text. The plain text is one click away '
        + 'and is still what search reads.',
      'Nothing a sender writes can affect the page: the formatting is rebuilt from a fixed list '
        + 'of what is allowed, and scripts, styles and frames never reach it.',
      'Images in an email are not shown. A picture in a message is a tracking pixel as often as '
        + 'it is a logo, and this way nothing reports back that a letter was read.',
      'Only mail arriving from now on has this. Messages already captured keep the text they '
        + 'were reduced to.',
    ],
  },
  {
    version: '0.63.0', date: '30 August 2026',
    notes: [
      'Any message in a conversation can be forwarded. The original is quoted with who it was '
        + 'from, when, and on which channel, and you write your own line above it.',
      'A message that arrived on Telegram or WhatsApp can be forwarded too \u2014 a forward '
        + 'always goes out by email, because that is where you choose the recipient.',
      'A forward starts its own conversation with whoever you sent it to, filed against the '
        + 'same client and matter, rather than being buried in the client\u2019s thread.',
    ],
  },
  {
    version: '0.62.0', date: '30 August 2026',
    notes: [
      'A note on a task now shows when it was written and by whom. Notes already on file '
        + 'have been dated from the record of when each was made.',
      'Finishing a task is a single \u201cDone\u201d button rather than a choice in a dropdown '
        + 'sitting next to \u201cCancelled\u201d.',
      'Editing a task without touching the note leaves the note\u2019s date where it was.',
    ],
  },
  {
    version: '0.61.0', date: '29 August 2026',
    notes: [
      'A message you forward into the bot no longer joins a conversation. It was landing in '
        + 'one thread named after you, whoever it was originally from, and a reply typed there '
        + 'would have come back to you rather than gone to them.',
      'A forward is now an inbox message and an inquiry, and nothing else. Existing '
        + 'conversations have been unpicked: a thread is kept only where somebody really wrote '
        + 'in that chat, or where the practice replied through it.',
    ],
  },
  {
    version: '0.60.0', date: '29 August 2026',
    notes: [
      'An inquiry can now be deleted, from the list or from its own page \u2014 for the wrong '
        + 'numbers and forwarded noise that were only ever cluttering it.',
      'Only while it is still only an inquiry. One that has become a matter, been quoted, or '
        + 'carries a task, a document or a file note is refused, and says why.',
      'A note is never deleted with it, and the audit log records what the inquiry was. The '
        + 'message it came from is marked ignored, so the same thing is not dismissed twice.',
    ],
  },
  {
    version: '0.59.0', date: '29 August 2026',
    notes: [
      'Converting an inquiry now asks for the same fields as the client form: record type, '
        + 'given names, family name, nationality, or a company\u2019s registered name. A client '
        + 'created this way is stored exactly like one created on the client form, so the '
        + 'list sorts and searches the same for both.',
      'A guess at where the family name ends is filled in from the inquiry and can be '
        + 'corrected before it is saved.',
      'The conversion no longer offers \u201cUnassigned\u201d. A matter always has an owner, and '
        + 'it now starts with whoever holds the inquiry.',
    ],
  },
  {
    version: '0.58.0', date: '29 August 2026',
    notes: [
      'A reply can carry documents that are already on the client or the matter. Nothing is '
        + 'uploaded twice: sending a document records that it went and to whom, so which '
        + 'version somebody was sent, and when, is answerable from the document itself.',
      'The documents list now shows how many times each has been sent and when it last was.',
      'The conversation shows what was attached to each reply.',
    ],
  },
  {
    version: '0.57.0', date: '29 August 2026',
    notes: [
      'A matter has one principal applicant. The database refuses a second, and the message '
        + 'names who already holds the role rather than reporting a constraint.',
      'The role now defaults to <strong>Principal applicant</strong> on the first party added '
        + 'to a matter, and to Secondary applicant once the role is taken.',
    ],
  },
  {
    version: '0.56.0', date: '29 August 2026',
    notes: [
      'A party who is not on file yet can be added from the matter itself \u2014 a name, a '
        + 'role, and they are created as a client and put on the matter in one step. You no '
        + 'longer have to leave the matter, create the client, and find your way back.',
    ],
  },
  {
    version: '0.55.0', date: '29 August 2026',
    notes: [
      'Correspondence is searchable. The global search box now looks inside messages and '
        + 'replies as well as file notes \u2014 what was actually said, in the words it was '
        + 'said in, which was the one body of text in the register you could not search.',
      'A client\u2019s page and a matter\u2019s page now show the conversations linked to '
        + 'them, with the last thing said and whether anything is waiting.',
    ],
  },
  {
    version: '0.54.0', date: '29 August 2026',
    notes: [
      'A matter is always assigned to somebody. \u201cUnassigned\u201d is gone from the form, '
        + 'and the database refuses a matter without an owner \u2014 the same rule tasks have '
        + 'always had, for the same reason: one nobody owns is one nobody is doing.',
      'It defaults to whoever is opening it, and it cannot be given to a suspended account.',
    ],
  },
  {
    version: '0.53.0', date: '29 August 2026',
    notes: [
      'A reply you have full control over: To, Cc and Bcc, all with the register\u2019s own '
        + 'people offered as you type. Cc comes pre-filled with everyone else who was on their '
        + 'last message \u2014 reply to all, without having to remember who all was.',
      'Replies can be sent formatted. Blank lines start paragraphs, **bold**, *italic*, '
        + '# headings and - or 1. lists. The plain text goes as well, so a client whose mail '
        + 'reader will not show formatting still gets a readable letter.',
      'A conversation can be linked to a matter as well as a client. Most correspondence is '
        + 'about one particular matter.',
      'A message can be deleted, not only ignored \u2014 and an ignored message no longer '
        + 'appears in the conversation. The audit log keeps the record that it arrived either way.',
      'The inbox now leads with the subject, then who it is from, then when.',
    ],
  },
  {
    version: '0.52.0', date: '29 August 2026',
    notes: [
      'A message in the Inbox now offers a reply to whoever sent it, where you are reading it. '
        + 'Answering somebody is a different question from deciding what their message becomes, '
        + 'and it used to mean leaving the message and finding the conversation by hand.',
    ],
  },
  {
    version: '0.51.1', date: '29 August 2026',
    notes: [
      'Gmail credentials are trimmed before use. Pasted with a trailing newline, a client ID '
        + 'is a different string, and Google answers \u201cThe OAuth client was not found\u201d '
        + '\u2014 which reads like the client was deleted rather than like a stray keystroke.',
      'A credential of the wrong shape is now named as such: a client ID that does not end '
        + '\u201c.apps.googleusercontent.com\u201d, or a refresh token that does not start '
        + '\u201c1//\u201d, is reported before the request is made.',
    ],
  },
  {
    version: '0.51.0', date: '29 August 2026',
    notes: [
      '\u201cCheck for mail now\u201d under Settings \u2192 Maintenance runs the mailbox poll '
        + 'on demand and reports what it looked at, not only what it took \u2014 so a mailbox '
        + 'that is connected but quiet can be told apart from one that is not connected at all.',
      'When Google refuses the authorisation, the message carries its own words rather than a '
        + 'generic failure.',
    ],
  },
  {
    version: '0.50.0', date: '29 August 2026',
    notes: [
      'The register can read a mailbox for you. Forward your working mail into a dedicated '
        + 'Gmail account, authorise it read-only, and what arrives there appears in Incoming '
        + 'within five minutes \u2014 no forwarding by hand. See Help \u2192 Connecting '
        + 'Telegram, WhatsApp and email, section 4c.',
      'It files correspondence and nothing more. Whether a message becomes an inquiry follows '
        + 'the same trusted-sender rule as mail forwarded in; no status, date or task changes '
        + 'by itself.',
      'The Gmail credentials were never passed through the deploy \u2014 you could set them, '
        + 'watch the deploy succeed, and never have them take effect. Fixed, with a test that '
        + 'now fails if any secret the collector knows is missing from the workflow.',
      'Setting up Gmail on a Workspace address is simpler than on a personal one: choose '
        + '\u201cInternal\u201d and there is no verification, no warning and no token expiry.',
    ],
  },
  {
    version: '0.49.1', date: '29 August 2026',
    notes: [
      'Settings \u2192 Integrations now says what the mail transport in use actually does \u2014 '
        + 'in particular whether a copy of what you send ends up in your own mailbox. It named '
        + 'the setting and stopped, which told you nothing you wanted to know.',
      'A few help pages still said \u201cAdmin \u2192 \u2026\u201d after that section was '
        + 'renamed to Settings.',
    ],
  },
  {
    version: '0.49.0', date: '29 August 2026',
    notes: [
      'Nationality is now chosen from the full list of countries rather than typed. It is '
        + 'held as an ISO 3166-1 code, so it can be counted and filtered, and the database '
        + 'refuses anything that is not a country.',
      'Current visa is now chosen from a list too \u2014 modelled on the practice\u2019s own '
        + 'visa taxonomy, with the same VV/SV/WV/RV prefixes as the case types. '
        + '\u201cNone \u2014 offshore\u201d and \u201cNone \u2014 unlawful\u201d are on it, '
        + 'because they are answers. Edit the list under Settings \u2192 Lists and dropdowns.',
      'Anything already recorded that did not match a country or a visa was moved into the '
        + 'client\u2019s file notes rather than discarded, with a line asking you to set it.',
      '\u201cWorks for\u201d and \u201cRole there\u201d now sit together under Employment '
        + 'instead of drifting into different rows.',
    ],
  },
  {
    version: '0.48.0', date: '29 August 2026',
    notes: [
      'Police certificate and medical expiry dates are now worked out rather than typed. '
        + 'A police certificate is good for 6 months from issue, or 24 once it has gone in '
        + 'with an application; a medical is 3 months, or 36. Record the issue date and the '
        + 'register does the arithmetic \u2014 including at the end of a month, where 31 March '
        + 'plus six months is 30 September and not 1 October.',
      'Each certificate has a \u201csubmitted with an application on\u201d date. Fill it in '
        + 'and the expiry moves by itself, and the file records that it did.',
      'A certificate inside the warning window now counts as pressing rather than upcoming. '
        + 'The window is 30 days by default and is set under Settings \u2192 Alerts \u2014 '
        + 'longer than for a deadline, because you cannot replace a medical on the day.',
      'A chest x-ray keeps a hand-entered expiry: no rule has been stated for one, and '
        + 'inventing one would be worse than leaving it alone.',
    ],
  },
  {
    version: '0.47.0', date: '29 August 2026',
    notes: [
      'A task can be opened. Click its title in the list and you get the whole thing \u2014 '
        + 'the details in full rather than the first two lines, what it is attached to, who '
        + 'raised it and when, and what was done if it is finished.',
      'Status, edit and the note are all on that page, and each comes back to it rather than '
        + 'throwing you back to the list.',
      'A task alert now opens the task rather than the matter behind it.',
    ],
  },
  {
    version: '0.46.0', date: '29 August 2026',
    notes: [
      'The <strong>Admin</strong> section is now called <strong>Settings</strong>. Nothing '
        + 'moved \u2014 it is the same tabs at the same addresses \u2014 and most of the help '
        + 'already called it that.',
      'The navigation now tightens as the window narrows instead of wrapping into a ragged '
        + 'second row, and takes a full-width line of its own once it can no longer share one '
        + 'with the search box.',
    ],
  },
  {
    version: '0.45.0', date: '29 August 2026',
    notes: [
      '\u201cNot acknowledged\u201d \u2014 a matter lodged with INZ where no application '
        + 'number has been recorded. Either the acknowledgement never arrived or nobody wrote '
        + 'the number down, and you find out which by looking. How long to wait first is set '
        + 'under Settings \u2192 Alerts.',
      '\u201cNo room to act\u201d \u2014 a task due on the same day as the deadline it '
        + 'serves. That is the deadline written twice, with no time in it for the client to be '
        + 'unreachable or a document to be missing.',
      '\u201cStatus not recorded\u201d \u2014 an open matter for someone with no current '
        + 'visa on their record. It clears by recording one, and \u201cnone, offshore\u201d '
        + 'is an answer. Organisations are never asked.',
      'Like the other two, these are ordinary checks over the register. No model is consulted.',
    ],
  },
  {
    version: '0.44.0', date: '29 August 2026',
    notes: [
      'Column headings in Cases and Clients now sort. Click one to sort by it, click it '
        + 'again to reverse. The sort is part of the address, so a sorted list can be '
        + 'bookmarked and comes back sorted.',
      'Sorting by name sorts by family name — TRUONG, Thi Kim Oanh sits under T for '
        + 'Truong — and ignores capitals, so a name entered any way lands in the right '
        + 'place.',
    ],
  },
  {
    version: '0.43.0', date: '29 August 2026',
    notes: [
      'Two new alerts that are not about a date: “Gone quiet” lists open matters nothing '
        + 'has happened on for ten days, and “Does not add up” lists matters whose own '
        + 'recorded dates contradict each other.',
      'How long counts as quiet is set under Settings \u2192 Alerts.',
    ],
  },
  {
    version: '0.42.0', date: '29 August 2026',
    notes: [
      'A brief can be edited before it is saved. Edit it and the note records that you '
        + 'edited it, rather than claiming to be the model\u2019s words.',
      'A brief can be discarded. Nothing is written to the file; the register keeps a '
        + 'record that you read it and decided against it.',
    ],
  },
  {
    version: '0.41.0', date: '29 August 2026',
    notes: [
      'Saving a brief now clears it from the panel — it is on the file, so it is no '
        + 'longer a draft waiting to be kept.',
      'A brief no longer reads an earlier brief kept on the file as though it were a '
        + 'record of what happened.',
      'The assistant settings are now called AI Assistant and come first.',
    ],
  },
  {
    version: '0.39.1', date: '29 August 2026',
    notes: [
      '“Brief me on this matter” works again — it was failing on a database error.',
      'Tags read as one chip each, in a line, with the add box folded away until wanted.',
      'The status form no longer staggers its fields.',
    ],
  },
  {
    version: '0.39.0', date: '29 August 2026',
    notes: [
      'The model the assistant uses is now chosen in the app, under '
        + 'Settings \u2192 AI Assistant, with the price per million tokens beside '
        + 'each option. No deploy.',
    ],
  },
  {
    version: '0.38.0', date: '29 August 2026',
    notes: [
      'The assistant runs on Claude Haiku 4.5 \u2014 the cheap model, about a fifth the price '
        + 'of the largest one. Set AI_PROVIDER and ANTHROPIC_API_KEY to switch it on; '
        + 'Help \u2192 The assistant has the steps.',
      'Admin \u2192 Integrations now names the model in use.',
    ],
  },
  {
    version: '0.37.0', date: '29 August 2026',
    notes: [
      'A search box at the top of every page, covering the whole register \u2014 clients, '
        + 'matters, tasks, quotes, invoices, inquiries, file notes, documents and the '
        + 'knowledge base.',
      'Names are recorded in plain English letters: RAWIRI, NGUYEN, DANG.',
    ],
  },
  {
    version: '0.36.1', date: '29 August 2026',
    notes: [
      'A client\u2019s family name is now stored in capitals however it is typed \u2014 '
        + 'BUI, NGUYỄN, DE VRIES \u2014 so it is the same on the client, the matter, the '
        + 'export and in a search.',
    ],
  },
  {
    version: '0.36.0', date: '29 August 2026',
    notes: [
      'A matter now has a name and a separate line for what it is about. '
        + '“AEWV. TAGATA, Sione” with “Orchard worker, Kiwi Orchards” underneath.',
      'Surnames are capitalised in a matter name, as a passport prints them, so it is '
        + 'clear which part is the family name.',
      'Existing matters were split into the two boxes automatically.',
    ],
  },
  {
    version: '0.35.0', date: '29 August 2026',
    notes: [
      'Marking a task done now asks what was done and how. The task is already complete by '
        + 'then, the box is skippable, and the note goes onto the file of whatever the task '
        + 'was attached to.',
      'The prompt can be turned off under your account preferences.',
    ],
  },
  {
    version: '0.34.0', date: '29 August 2026',
    notes: [
      'Inquiries, the Inbox and Conversations share one menu entry, Incoming, as three tabs. '
        + 'They are still separate records — only the menu is shared.',
      'The number beside each of those tabs is what is waiting on it, not how many rows exist.',
    ],
  },
  {
    version: '0.33.0', date: '29 August 2026',
    notes: [
      'A client may hold more than one passport. The one on their form is the primary; '
        + 'second and third ones go under Passports on their page, and every one still held '
        + 'is watched for expiry.',
      'Forms now size themselves to the space they are in rather than to the window, '
        + 'so a narrow window no longer squeezes them into unreadable columns.',
      '“For approval” keeps the Alerts tab bar and its figures instead of replacing them, '
        + 'so there is a way back.',
    ],
  },
  {
    version: '0.32.0', date: '29 August 2026',
    notes: [
      'The test message can go to any address, so you can see how it lands at a client\'s provider.',
    ],
  },
  {
    version: '0.31.0', date: '29 August 2026',
    notes: [
      'A “send a test message to myself” button, under Admin → Integrations.',
      'The manual gained the sections it was missing: decisions and chasing INZ, '
        + 'certificates, and export — and proper setup steps for Resend.',
    ],
  },
  {
    version: '0.30.0', date: '29 August 2026',
    notes: [
      'Replies can be directed to a mailbox other than the sending address — '
        + 'Settings → Practice → “Replies should go to”.',
    ],
  },
  {
    version: '0.29.0', date: '29 August 2026',
    notes: [
      'Today is now Dashboard, and leads with one list of what is late or due today.',
      'The figures turn red when something is overdue and amber when it bites this week.',
      'New panels: waiting for your approval, invoices overdue, conversations waiting.',
      'A twelve-month trend of matters lodged.',
    ],
  },
  {
    version: '0.28.0', date: '29 August 2026',
    notes: [
      'Document storage is live — files attach to cases, clients and notes.',
      'The user list is one line per person, with an Edit button rather than boxes on every row.',
    ],
  },
  {
    version: '0.27.0', date: '29 August 2026',
    notes: [
      'A passport number entered against the wrong person can now be removed, not just overwritten.',
      'A client may hold several passports. The one on their form is the primary; the rest live '
        + 'under Passports on their page, and every one still held is watched for expiry.',
      'Changing or clearing one is recorded in the audit log as specifically as revealing one.',
    ],
  },
  {
    version: '0.26.0', date: '29 August 2026',
    notes: [
      'Export: sixteen datasets, each one link and one CSV. Passport numbers excluded.',
      'Certificates are records with their own dates — a new one no longer overwrites the old.',
      'English language, and General or Limited on a medical.',
      'A fee summary on the client page; the fee section on a case now starts folded.',
      'Matter titles read “AEWV. SURNAME, Given”, and numbers carry the year: CASE-26-001.',
    ],
  },
  {
    version: '0.25.0', date: '29 August 2026',
    notes: [
      'Lodging a matter fills in an expected decision date — a month later, by default.',
      'When that date passes, a task is raised to chase INZ, and again monthly twice more.',
      'All of it is adjustable in Settings, and any one matter can opt out.',
      'Automations now stay inside the Admin tabs instead of jumping to another menu.',
      'The audit log fits its rows: one line per fact rather than four.',
    ],
  },
  {
    version: '0.24.0', date: '29 August 2026',
    notes: [
      'Open a matter from a document: drop it in and get the form back filled, not a summary.',
      'It names what it could not find, offers an existing client rather than a duplicate, '
        + 'and never invents a date.',
      'The company fields no longer appear on an individual — with scripting or without it.',
      'Fixed: hiding a section did not hide it, because a stylesheet rule was beating [hidden].',
    ],
  },
  {
    version: '0.23.0', date: '28 August 2026',
    notes: [
      'Invoices, raised from a quote in one press. The quote is left as it is.',
      'Once issued, an invoice cannot be altered — the database refuses. Void it and raise another.',
      'Payments are recorded and never edited; a mistake is corrected by a second entry.',
      'A printable tax invoice on your letterhead, with your bank details and payments received.',
    ],
  },
  {
    version: '0.22.0', date: '28 August 2026',
    notes: [
      'Conversations: Telegram and WhatsApp as two-way threads, replied to from inside the app.',
      'A conversation can be linked to a client, putting it on their file.',
      'Every reply carries the name of whoever wrote it, and is recorded before it is sent.',
      'The inbox now has tabs, counts and search as you type, like every other list.',
    ],
  },
  {
    version: '0.21.0', date: '28 August 2026',
    notes: [
      'Automations: rules that watch the register\'s dates and propose what to do about them.',
      'An approval queue under Alerts. Nothing leaves the practice without somebody saying yes.',
      'A rule may raise a task on its own; an email always waits for a person.',
      'Nothing is proposed twice, and anything dismissed stays dismissed.',
      'With the AI switched off every rule still works — it only writes the digest\'s opening.',
    ],
  },
  {
    version: '0.20.0', date: '28 August 2026',
    notes: [
      'A banner when a message arrives in the inbox, in whichever corner you choose.',
      'A choice of five sounds, made by the browser rather than downloaded — or none.',
      'You set how often the register looks, or turn the checking off altogether.',
    ],
  },
  {
    version: '0.19.0', date: '28 August 2026',
    notes: [
      'An Assistant page: paste an email or notes, and it proposes an inquiry or a client.',
      '“Brief me on this matter” on every case — where things stand and what to do next.',
      'Nothing the AI proposes is saved until somebody presses the button.',
      'The register works exactly as before with the AI switched off.',
    ],
  },
  {
    version: '0.18.0', date: '28 August 2026',
    notes: [
      'Three more themes — Blossom, Lagoon and Aurora — each with day and night.',
      'Alerts, Tasks and Quotes now have the same tabs with counts as Clients and Cases.',
      'Search answers as you type on those lists.',
    ],
  },
  {
    version: '0.17.0', date: '28 August 2026',
    notes: [
      'Preferences of your own: where you land, how many rows, which tab opens first.',
      'My account is tabbed, and so is the new client form.',
      'Settings lay out across the page instead of one narrow column.',
      'Tab bars stay under the navigation while a page scrolls.',
    ],
  },
  {
    version: '0.16.0', date: '28 August 2026',
    notes: [
      'File notes on every case that cannot be altered or deleted, only added to.',
      'A note can be backdated to the day it happened, and can carry a file.',
      'Administration is one set of tabs rather than a page of buttons.',
    ],
  },
  {
    version: '0.15.0', date: '28 August 2026',
    notes: [
      'Payment stages on a quote, and your bank details — off by default.',
      'Quote lines can be edited, not only added and removed.',
    ],
  },
  {
    version: '0.14.0', date: '28 August 2026',
    notes: [
      'Emails can be sent as formatted HTML as well as plain text.',
      'Case types are yours to edit under Settings, with sixty-six to start from.',
      'The working area is wider on a desktop, and compose uses all of it.',
    ],
  },
  {
    version: '0.13.0', date: '28 August 2026',
    notes: [
      'Search that answers as you type on cases and clients.',
      'Column headings stay put while a long list scrolls.',
      'Names and email addresses are editable under Admin → Users.',
      'Lists fit a phone: columns give way rather than being crushed.',
    ],
  },
  {
    version: '0.12.0', date: '28 August 2026',
    notes: [
      'Quotes are now itemised: description, quantity, unit price, and a line for each thing.',
      'Fees and disbursements are shown and totalled separately, with GST only where it applies.',
      'A quote shows the date it is valid until, worked out from the day it was issued.',
      'Your GST number and address print on every quote — set them under Settings → Practice.',
      'A catalogue of standard items you can pick from, add to and edit.',
    ],
  },
  {
    version: '0.11.0', date: '28 August 2026',
    notes: [
      'Clients now split into Leads, Individuals, Organisations and All.',
      'Administration is tabbed rather than one long page.',
      'The public page is built for search engines and for AI assistants that read it.',
      'A brighter icon, so the tab is easy to find in a row of them.',
    ],
  },
  {
    version: '0.10.0', date: '28 August 2026',
    notes: [
      'Step-by-step instructions for connecting Telegram, WhatsApp and email — see the section above.',
      'The register can now send from your Gmail account, so replies come back to your own inbox.',
      'Admin → Integrations says what is still missing, not just what is off.',
    ],
  },
  {
    version: '0.9.0', date: '28 August 2026',
    notes: [
      'A knowledge base for visa packs, circulars, legal material and announcements.',
      'Articles keep the date they were published and the date they take effect, apart.',
      'Those dates raise their own follow-up tasks, a week ahead by default — change it in Settings.',
      'A message in the inbox can be filed straight into the knowledge base.',
      'Every edit is kept, and the history cannot be altered.',
      'Every task now has an owner. What it is about stays optional.',
    ],
  },
  {
    version: '0.8.0', date: '28 August 2026',
    notes: [
      'A public page for the practice, shown to anyone arriving without signing in.',
      'All of its wording is edited under Settings → Website — no deployment needed.',
      'It can accept enquiries straight into the register, once you switch that on.',
      'It is kept out of search results until you say otherwise.',
    ],
  },
  {
    version: '0.7.0', date: '28 August 2026',
    notes: [
      'Day and night modes, and three themes to switch between, under My account → Appearance.',
      'Your choice is saved to your account, so it follows you to any device you sign in on.',
      'The whole register is now laid out for a phone as deliberately as for a desk.',
      'Lighter, tighter typography throughout.',
    ],
  },
  {
    version: '0.6.0', date: '28 August 2026',
    notes: [
      'Cases can be tagged with anything you type; new tags are created as you go.',
      'A case can have several parties — applicant, partner, child, employer — each a client in their own right.',
      'A person can be linked to a company and named as its primary contact.',
      'Clients are split into Leads and Clients; converting is one click.',
      'The register is loaded with demonstration data, removable from Admin.',
    ],
  },
  {
    version: '0.5.0', date: '28 August 2026',
    notes: [
      'Settings page with tabs for practice details, security, fees, alerts and channels.',
      'Quotes can be printed, emailed and cancelled, and carry your terms of engagement.',
      'Two-factor authentication can be required for everyone.',
      'The Help manual you are reading now.',
    ],
  },
  {
    version: '0.4.0', date: '28 August 2026',
    notes: [
      'Tasks, quotes, inquiries and fee lines can now be edited, not just created.',
      'The audit log is now append-only in the database itself and can be filtered by person.',
    ],
  },
  {
    version: '0.3.0', date: '28 August 2026',
    notes: [
      'Given names and family name are kept separate for individuals.',
      'Companies can be clients, with an NZBN and Companies Office number.',
      'Passport, visa, police certificate, medical and chest x-ray expiry dates are tracked.',
      'New Alerts page gathering every deadline and expiry in one list.',
    ],
  },
  {
    version: '0.2.0', date: '28 August 2026',
    notes: [
      'Sign out added to the top bar.',
      'The “Licensed adviser” role is now called “Specialist”.',
      'Fixed the fault that stopped the first account being created.',
    ],
  },
  {
    version: '0.1.0', date: '27 August 2026',
    notes: ['First release: clients, cases, inquiries, quotes, fees, tasks, inbox and admin.'],
  },
];

function sections(origin: string): Section[] {
  return [
    {
      id: 'getting-around',
      title: 'Getting around',
      body: html`
        <p>The bar across the top is the whole application. <strong>Dashboard</strong> is the daily
           starting point; <strong>Alerts</strong> is everything with a date attached;
           <strong>Incoming</strong> is everything that arrived from outside — inquiries, the raw
           inbox, and the channel conversations, as three tabs of one page.</p>
        <p>Press <kbd>/</kbd> anywhere to jump to the search box on the page. Your name at the top
           right opens your account; <strong>Sign out</strong> sits beside it.</p>
        <p>Long lists show <strong>Previous</strong> and <strong>Next</strong> above and below, and a
           <strong>Rows</strong> choice underneath — 25, 50, 100, 250 or 500. That is a per-list
           choice; the number every list <em>starts</em> on is under your account.</p>
        <p>You will only see the parts your role allows. If a colleague can see something you
           cannot, that is their role, not a fault.</p>`,
    },
    {
      id: 'clients',
      title: 'Clients — people and companies',
      body: html`
        <p>A client is whoever the practice acts for. Everything else — cases, quotes, fees —
           hangs off one.</p>
        <h4>Individuals</h4>
        <p>Given names and family name are recorded separately, as they appear in the passport,
           because forms and certificates distinguish them. The <em>preferred name</em> is what you
           actually call them, if it differs.</p>
        <p>Record the passport, visa, police certificate, medical and chest x-ray dates when you
           have them. Those dates drive the Alerts page — a certificate that ages out before
           lodgement is the sort of thing that stalls a matter, and this is what catches it.</p>
        <p>A passport number is stored as written, like the expiry date beside it — the practice
           decided on 30 August 2026 that it is working data read all day, and the ceremony around
           it cost more in friction than it bought. What guards it is what guards the rest of the
           register: sign-in, roles, two-factor and an audited session. One thing did not change —
           passport numbers stay out of the bulk exports, because a spreadsheet in a downloads
           folder is the copy that actually escapes.</p>
        <h4>More than one passport</h4>
        <p>A client may hold several. A dual national holds two at once and neither replaces the
           other; someone who has just renewed holds the new one and the old one carrying a live
           visa, which is the whole reason <em>Transfer to New Passport</em> exists as a matter
           type.</p>
        <p>The passport on the client's own form is the <strong>primary</strong> one — the travel
           document the file works from, and the one the Alerts page, the client list and the CSV
           export speak for. Second and third passports are added under
           <strong>Passports</strong> on the client's page, each with its own country, number and
           dates. <strong>Make primary</strong> swaps which one the file works from; the summary
           and the alerts follow immediately.</p>
        <p>Every passport still marked <em>held</em> is watched for expiry, so a client with two
           live passports is chased about both, and each alert names the issuing country. Mark one
           <em>replaced</em> when a new one supersedes it: it stays on the file as a record — a
           visa may still be stuck in it — but stops being chased. The primary passport is removed
           from the client form rather than from the list, so a record can never end up with
           passports but no primary.</p>
        <h4>What the visa lets them do</h4>
        <p>The Immigration tab takes the visa type, the day it was granted and the day it expires.
           Two more boxes are words rather than dates:</p>
        <p><strong>Visa conditions</strong> — what the grant allows and forbids, in INZ's own
           wording. <strong>Stay limit</strong> — the line you would otherwise put in a note:
           <em>4 months per entry, 6 months in any 12</em>.</p>
        <p>Nothing is counted from either and neither raises an alert, on purpose. A stay limit
           only starts when the person crosses a border, and the register has no way of knowing
           when they did. A date it guessed would be worse than none, because dates are what the
           alerts read. The visa's own expiry is still the only date watched on a visa.</p>
        <h4>Employment, education and travel history</h4>
        <p>Three blocks on the client's page, under Certificates. Each starts closed. None is
           compulsory — they are there for the application forms that ask for them.</p>
        <p>They are edited the way quotation lines are: change anything on any line, type a number
           in the <strong>#</strong> box to move a row up or down, tick the red cross to take a
           line out, and one <strong>Save</strong> does the lot. <strong>Add a line</strong>
           underneath adds one.</p>
        <p><strong>A period of unemployment is a row like any other.</strong> Choose what the
           period was — Unemployed, Studying, Caring for family — leave the employer blank,
           and write what was happening in the note. A work history with the gaps left out is not
           a work history, and INZ asks about the gaps.</p>
        <p>Where two employment periods do not meet, the register draws the gap between them as a
           shaded line saying how many months. It is never refused and never raises an alert: a
           history half entered legitimately has gaps, and a gap is often the true answer. It is a
           question to answer, not a mistake.</p>
        <p>A date can be a whole date or just a month: write <code>2019-03-15</code>, or
           <code>2019-03</code> where the day is not known. A month shows as
           <em>Mar 2019</em>.</p>
        <h4>Military records</h4>
        <p>A heading on the client's page and nothing behind it yet. It is there because the
           practice asked for the block before the shape of it was decided.</p>
        <h4>Companies and organisations</h4>
        <p>Choose <em>Company or organisation</em> as the record type and the form changes: a
           registered name, an NZBN and a Companies Office number instead of personal details.</p>
        <p>If the NZBN register is connected, <strong>New from NZBN register</strong> on the
           Clients page searches it by name or number and fills the details in from the register
           itself — the authority on how a company is actually registered, which a letterhead
           is not.</p>`,
    },
    {
      id: 'search',
      title: 'Finding things',
      body: html`
        <p>The box at the top right searches the whole register from any page:
           clients, matters, tasks, quotes, invoices, inquiries, file notes, uploaded documents
           and the knowledge base. Results are grouped by what they are.</p>
        <p>It searches more than names. A reference typed in full — <code>CASE-26-014</code>,
           <code>CL-0021</code>, <code>Q-0002</code> — is marked as an exact match and put first.
           An INZ application or client number finds the matter. A phrase you remember from a file
           note finds the note, which is often the thing you were actually after.</p>
        <p>Results appear as you type. Two letters is the minimum: one letter matches most of the
           register and answers nothing.</p>
        <p>Names are held in plain English letters — <em>RAWIRI</em>, <em>NGUYEN</em>,
           <em>DANG</em> — so there is never a mark you have to reproduce to find somebody.</p>`,
    },
    {
      id: 'cases',
      title: 'Cases — running a matter',
      body: html`
        <p>A case is one matter for one client: an application, an appeal, a s.61 request. Open one
           from the client's page so it attaches to the right file.</p>
        <h4>Naming a matter</h4>
        <p>A matter has a <strong>name</strong> and a thing it is <strong>about</strong>, and they
           are two boxes rather than one.</p>
        <p>The name follows the practice's convention — the type, then the client with the surname
           in capitals:</p>
        <p class="prewrap"><code>AEWV. TAGATA, Sione</code><br>
           <code>S.61. TAWHAI, Hemi Rangi</code></p>
        <p>Capitals on the surname are not decoration. Many clients have names whose order is not
           the English one, and <em>TRUONG, Thi Kim Oanh</em> says which part is the family name
           where <em>Truong, Thi Kim Oanh</em> leaves it to be guessed — and guessing wrong on a
           form comes back as a request for evidence.</p>
        <p>Pick the client and the type and the name is filled in for you, taking the short form
           of the type from the dropdown. Type in the box and it stops proposing, for good.</p>
        <p><strong>What it is about</strong> is the small line under the name in every list:
           <em>Orchard worker, Kiwi Orchards</em>, <em>unlawful since March</em>. It is what tells
           two matters of the same kind for the same person apart. Leave it empty when there is
           nothing to distinguish — one student visa for one client is not ambiguous with
           anything.</p>
        <p>The short forms come from the type list, which an administrator edits under
           <strong>Settings → Vocabulary</strong> with no deployment. Change
           <code>RQ. Section 61 Request</code> to <code>RQ. S.61</code> and every matter named
           from then on uses it. The part before the dot groups the list; it is dropped from the
           name.</p>
        <p>The <strong>status</strong> is the heart of it. You move a case forward from its own
           page, adding a note explaining why — that note goes on the file. Statuses cannot jump:
           a case cannot go from <em>Lead</em> straight to <em>Approved</em> without passing
           through lodgement, which stops a file quietly skipping a step.</p>
        <p>Set the <strong>response or decision due</strong> date whenever there is one, especially
           for an RFI or PPI. That is the date the Alerts page watches. You can change it on its
           own, leaving the status alone, which is how an extension from INZ is recorded — the
           new date goes on the file as a note saying what it was before.</p>
        <h4>The blocks on a matter</h4>
        <p>Every heading on a matter opens and closes. Five of them start closed: <strong>Read a
           document into this matter</strong>, <strong>Brief me on this matter</strong>,
           <strong>Files</strong>, <strong>File notes</strong> and <strong>Tasks</strong>. Those
           are the things you <em>do</em>; click the heading and it opens. What you read to see
           where a matter stands — status, parties, key details, the next action — is open
           when the page loads.</p>
        <p><strong>Invoices</strong> starts closed too, and for a different reason: it is the one
           thing on the page a client leaning over the desk should not read by accident.</p>
        <p>Nothing is remembered between visits. A section missing because of something you did on
           another matter last week would be worse than one you close again.</p>
        <h4>Two alerts that are not about a date</h4>
        <p>Everything else on the Alerts page answers <em>what is due</em>. These two answer
           <em>what is wrong</em>, which is how matters are actually lost — rarely to a missed
           deadline, usually to nobody looking.</p>
        <p><strong>Gone quiet</strong> lists open matters with no note, no status change and no
           task activity for ten days. Nothing is due on them; that is the point. Change the ten
           days under <strong>Settings → Alerts</strong>.</p>
        <p><strong>Does not add up</strong> lists matters whose own record contradicts itself — a
           decision dated before lodgement, a matter marked approved or declined with no decision
           date, a lodged date in the future. The row says which facts disagree, so you can judge
           it without opening the file.</p>
        <p>Both are ordinary database questions, not the assistant's opinion. Every row on the
           Alerts page is meant to be trustworthy at a glance; a row you had to investigate before
           acting would teach you to skim past the rest.</p>
        <p>The <strong>timeline</strong> on each case is the file note: calls, meetings, emails,
           what was advised. Anything the system does — a status change, a fee added, a task
           completed — is written there automatically, so the history reads in one place.</p>
        <h4>What the statuses mean</h4>
        <dl class="kv">
          ${CASE_STATUSES.map((s) => html`<dt>${CASE_STATUS_LABELS[s]}</dt><dd>${CASE_STATUS_HELP[s]}</dd>`)}
        </dl>`,
    },
    {
      id: 'fees',
      title: 'Fees, GST and the split',
      body: html`
        <p>Fees live on the case, added a line at a time. Each line records what it is, what it
           costs, and how GST applies to it:</p>
        <ul>
          <li><strong>Plus GST</strong> — the figure you type is the fee, and GST is added on top.</li>
          <li><strong>GST inclusive</strong> — the figure already includes GST, which is extracted
              from within it.</li>
          <li><strong>No GST</strong> — zero-rated or exempt.</li>
        </ul>
        <p>The rate is stored on each line as it was entered, so changing the practice default
           later never quietly restates last year's fees.</p>
        <p>Mark a line as a <strong>disbursement</strong> for anything you pass through at cost —
           INZ fees, medicals, translations. Those are kept out of the split by default, because
           they are not the practice's earnings.</p>
        <h4>The split</h4>
        <p>Every case carries a split, starting from the practice default (set in Admin) and
           adjustable on the case itself. It divides the <em>net professional fees</em> — GST
           belongs to Inland Revenue, and disbursements are somebody else's money.</p>
        <p>Amounts are allocated to the cent: if a share does not divide evenly, the leftover cents
           go somewhere definite rather than disappearing, and the parts always add back to the
           total. If the percentages do not come to 100%, the page says so and shows what is
           unallocated instead of pretending.</p>
        <p>The <strong>Fees</strong> page in the top bar totals this across the whole practice, by
           date range and by party.</p>`,
    },
    {
      id: 'quotes',
      title: 'Quotes',
      body: html`
        <p>A quote is a proposal: draft it, mark it sent, then record whether it was accepted or
           declined. A quote past its <em>valid until</em> date is marked expired automatically
           overnight, so the pipeline does not show dead quotes as live.</p>
        <h4>Itemising</h4>
        <p>A quote is a list, not a figure. Each line carries a description, a quantity, a unit
           (hour, application, response) and a price per unit. Add lines on the quote page; choosing
           something from <strong>standard items</strong> fills the line in, and you can still
           change any of it.</p>
        <p>Every line is either a <strong>professional fee</strong> or a <strong>disbursement</strong>
           — money paid to somebody else on the client's behalf, such as an INZ fee or a medical.
           The two are shown and totalled apart on the printed quote, because a client is entitled
           to see what is your fee and what is passed through. It also matters internally: only
           professional fees are apportioned in the revenue split. Disbursements are never split.</p>
        <h4>Standard items</h4>
        <p><strong>Quotes → standard items</strong> is the list behind that dropdown. Add to it,
           edit it, and retire anything you have stopped offering. Retiring keeps it off the
           dropdown without touching quotes that used it: a quote holds its own copy of the wording
           and the price, so changing a price here never alters a quote already sent.</p>
        <h4>How long it stands</h4>
        <p>Set the date of issue and how many days the quote stands for; the quote prints the
           <strong>date</strong> it is valid until, never a number of days, so nobody has to work it
           out. The count includes the day of issue — issued on the 28th, seven days means it is
           good through the 3rd. The default is under <strong>Settings → Quotes</strong>, along with
           the capacity and payment wording printed beneath the total.</p>
        <p>Your practice name, address, contact details and <strong>GST number</strong> come from
           <strong>Settings → Practice</strong> and print at the top of every quote.</p>
        <h4>Payment stages</h4>
        <p>A quote answers two questions, and they are kept apart. The items say
           <em>what you are paying for</em>; the <strong>payment stages</strong> say
           <em>when each part falls due</em> — case review on instruction, the balance when the
           application is ready to lodge, the Immigration New Zealand fee at lodgement.</p>
        <p>They are separate because they do not line up: one piece of work is often split across a
           deposit and a balance, and one stage can gather several fees into a single payment. Each
           stage carries its own wording and its own figure, and shows as “$1,750 + GST” or a flat
           amount, the way your terms of engagement set it out.</p>
        <p><strong>Draft stages from the items</strong> writes one stage per item as a starting
           point. Reword, split or merge them from there — how a matter is staged is a judgement
           about that client, not something the system should decide. If the stages do not add up
           to the quote total, the page says so before it goes out.</p>
        <h4>Bank account</h4>
        <p>Set the account under <strong>Settings → Practice</strong>. It is <strong>off</strong>
           until you tick “Show the bank account on quotes”, because a quote gets forwarded on and
           account details are what invoice-redirection fraud feeds on. When shown, the quote asks
           the client to quote its reference and warns them to telephone before acting on any email
           that appears to change the details.</p>
        <h4>Sending it, and reading what you sent</h4>
        <p><strong>Email to client</strong> writes the covering letter from the wording you keep
           under <strong>Settings → Quotes</strong>, filling in the client's name, the figures, the
           closing date and the link. <strong>Preview</strong> shows it exactly as the client will
           receive it, with <strong>Send</strong> and <strong>Back to edit</strong> underneath —
           nothing goes out unseen. It is sent formatted by default; switch to plain text on the
           same screen if you would rather.</p>
        <p>Every email the register sends is kept in full — recipients, subject, both the formatted
           and the plain version, and any attachments. The file note saying a quote was emailed is
           a link: open it and you see the letter as it went out. The quote page also carries an
           <strong>Emails sent</strong> list for the same thing. Nothing is deleted, so a letter
           sent months ago still reads back exactly as the client had it.</p>
        <h4>Turning it into fees</h4>
        <p>Once a quote is accepted and attached to a case, <strong>Add to case fees</strong>
           copies it across — one fee line per quote line, keeping the split treatment right — so
           the money is entered once, not twice. Editing the quote afterwards does not change those
           fee lines; edit them on the case.</p>`,
    },
    {
      id: 'invoices',
      title: 'Invoices',
      body: html`
        <p>An invoice is raised from a quote — the <strong>Invoices</strong> panel on any quote —
           or found under <strong>Quotes → Invoices</strong>. The lines are copied onto a new draft;
           the quote is left exactly as it is, because a quote can reasonably be invoiced more than
           once. Staged fees are precisely that.</p>
        <h4>Draft, then issued</h4>
        <p>While it is a draft you can add and remove lines like anything else. When you issue it
           you set the date, the due date is worked out from your payment terms, and after that
           <strong>it cannot be altered</strong> — not the amounts, not the dates, not the lines,
           not the number. That is the database refusing, not the screen being polite: an invoice is
           a tax document, and one that can be edited afterwards is not evidence of anything.</p>
        <p>If an issued invoice is wrong, <strong>void</strong> it with a reason and raise another.
           The number stays in the sequence — a gap is the first thing somebody asks about.</p>
        <h4>Payments</h4>
        <p>Record what arrives and the invoice moves itself to part paid or paid. Payments are added
           and never edited: a mistake is corrected by a second entry, marked
           <strong>Adjustment</strong> with a negative amount, which is how a ledger stays a record
           rather than an opinion.</p>
        <h4>The document</h4>
        <p><strong>Print view</strong> gives the invoice on your letterhead with your GST number,
           your bank account and the payments already received. It is headed <em>Tax invoice</em>
           when GST applies and simply <em>Invoice</em> when it does not.</p>
        <h4>Margins, when you save one as a PDF</h4>
        <p>Every document the register prints — quotation, letter of engagement, invoice —
           leaves <strong>20mm clear on all four sides</strong>. There is one setting that can
           override it: in the browser’s print box, <strong>Margins</strong> must be left on
           <em>Default</em>. Set to <em>None</em> and the browser ignores what the document asks
           for and prints to the edge of the paper.</p>
        <h4>Xero</h4>
        <p>Not connected yet. The invoice already carries somewhere to record a push — the Xero
           identifier and when it went — so that when it is connected the two systems can agree
           about which invoice is which, rather than matching them up by amount and hoping.</p>`,
    },
    {
      id: 'inquiries',
      title: 'Incoming: inquiries, inbox and conversations',
      body: html`
        <p><strong>Incoming</strong> is one menu entry with three tabs, because what you actually
           want to know is "what came in" rather than which of three screens to look at. The number
           beside each tab is what is waiting on it.</p>
        <p>An <strong>inquiry</strong> is work that arrives before there is a client: a reference, a
           status and an owner. Record one by hand for a phone call, or let it arrive through a
           channel.</p>
        <p>The <strong>Inbox</strong> holds messages captured from email, Telegram and WhatsApp
           exactly as they arrived. Messages from senders on the allow-list become inquiries
           automatically; anything else waits there marked <em>unverified</em> until a person
           decides, which is what stops a stranger who finds the address creating records.</p>
        <p>They stay separate records on purpose. A message is not a piece of work: a thread of
           twenty messages is still one inquiry, and an inquiry taken over the phone has no message
           behind it at all. Only the menu is shared.</p>
        <p>From an inquiry, <strong>Create client and case</strong> does both in one step and links
           them, carrying the original message across as the case summary. If the contact details
           match someone already on file, the page says so rather than making a duplicate.</p>
        <h4>Filing it where it belongs</h4>
        <p>Incoming used to only grow. Anything on any of the three tabs can now be filed onto a
           matter or a client: choose it from <strong>File on</strong> and press <strong>File
           it</strong>. A note appears on that record carrying the date, who it was from, the
           subject and the text, and the item leaves the working list for the <strong>Filed</strong>
           tab.</p>
        <p><strong>Nothing is deleted by filing.</strong> The message stays exactly as it arrived —
           it is the register's record that something came in, and on what day, which is worth
           having whatever you later decide about it. One press puts it back.</p>
        <p>Putting it back does not remove the note it wrote. File notes are append-only here: a
           note that was written is a thing that happened, and unfiling says "this went to the
           wrong place", not "nobody ever put it there".</p>`,
    },
    {
      id: 'assistant',
      title: 'The assistant, and what it will not do',
      body: html`
        <p>With the AI layer switched on you get two things. <strong>Assistant</strong> reads text
           you paste — a forwarded email, a scanned letter, your notes from a call — and pulls out
           the name, the contact details, the dates and what kind of matter it looks like, then
           offers to start an inquiry or a client record with that filled in.
           <strong>Brief me on this matter</strong>, on any case, reads that file and proposes
           where things stand, what to do next, what is worth watching, and what the file does not
           say.</p>
        <h4>Switching it on</h4>
        <p>Two repository secrets, then a deploy:</p>
        <ul>
          <li><code>AI_PROVIDER</code> = <code>anthropic</code></li>
          <li><code>ANTHROPIC_API_KEY</code> = a key from
              <a href="https://console.anthropic.com/settings/keys">console.anthropic.com</a></li>
        </ul>
        <p>Add them under <strong>Settings → Secrets and variables → Actions</strong> in the
           repository, then push or re-run the deploy. <strong>Settings → Integrations</strong> then
           shows the AI layer as on, and names the model it is using.</p>
        <p>It runs on <strong>Claude Haiku 4.5</strong> — deliberately the cheap model, at about a
           fifth of the price of the largest one. Everything asked of it here is reading a document
           into form fields, triaging a message, or summarising a file the practice already holds,
           and all of it is checked by a person before anything is written. Paying five times more
           would be paying for reasoning this work does not use.</p>
        <p>To change it, go to <strong>Settings → AI Assistant</strong> and pick another:
           Sonnet 5 is the next step up, Opus 5 above it, and each carries its price per million
           tokens so the choice is made with the figures in front of you. It takes effect on the
           next request — no deploy.</p>
        <p>Worth moving up only if extraction from difficult scans starts costing you more in
           corrections than the model saves. The list is short on purpose: a model on it is one
           whose request shape has been checked against this register.</p>
        <h4>What it will not do</h4>
        <p><strong>It never writes to the register.</strong> Every suggestion arrives as a form you
           look at and submit, or a note you press save on. Nothing it offers is a step you could
           not take by hand — which is exactly why the register works with it switched off. If the
           provider is down, over quota or was never configured, the page says so and every
           workflow still completes.</p>
        <p>It is given the file, not the keys. When you ask for a brief, the register assembles the
           statuses, dates, parties, notes, tasks and fees and hands that text over. It does not
           query the database itself and cannot reach anything you could not already see on the
           page. Passport numbers are never included: no brief needs one, and the fewer places a
           number is copied to the better.</p>
        <p>You can change a brief before saving it. The box holds the note exactly as it will be
           written, so what you read before pressing save is what the file gets. Edit a word of it
           and the note records that you edited it rather than claiming to be the model's words —
           the distinction is the point, so it has to stay true.</p>
        <p><strong>Discard it</strong> throws the reading away without writing anything. The
           register keeps a record that you read it and decided against it, which over time is the
           clearest evidence there is about whether the assistant is earning its place.</p>
        <p>A brief saved to the file says in the note that it was drafted by the AI layer and who
           kept it. A file that does not distinguish what a person wrote from what a model drafted
           is a file nobody can rely on.</p>
        <h4>What is recorded</h4>
        <p>Every run — what was asked, what came back, how long it took, and whether it failed — is
           kept, so a suggestion acted on months ago can still be traced to the thing that produced
           it.</p>
        <h4>Switching it on</h4>
        <p>Set <code>AI_PROVIDER</code> to <code>anthropic</code> with an
           <code>ANTHROPIC_API_KEY</code> for the better reading, or to <code>workers-ai</code> to
           use Cloudflare's own models with nothing leaving their network. Both are repository
           secrets, set the same way as everything else in
           <a href="/help?s=connecting">the setup guide</a>.</p>`,
    },
    {
      id: 'intake',
      title: 'Opening a matter from a document',
      body: html`
        <p>The ordinary way to open a matter is to type it in, and that has not changed. This is the
           other way: <strong>Assistant → Open a matter</strong>, or the button on the New case and
           New client pages.</p>
        <p>Drop in what you already have — a forwarded email, an INZ letter, a photograph of one, a
           scrap of notes — or paste it. What comes back is not a summary to read and retype: it is
           <em>the form</em>, with the boxes filled in. The client, anybody else the document names
           and their role on the matter, the type, the numbers, the dates.</p>
        <p>Correct what is wrong, fill what is empty, and press <strong>Open the matter</strong>.
           That press is the moment anything is written — before it, the register is untouched. One
           submit creates the client, links the other people as parties, opens the case and puts a
           line on its timeline saying where it came from.</p>
        <h4>What happens to your file</h4>
        <p><strong>It is kept.</strong> The upload is stored when it is read, and goes onto the
           matter when you press the button that opens it — so the document the matter was opened
           from is on the file, not just the reading of it. Read something and never press the
           button, and the copy is deleted a week later.</p>
        <h4>What it will not do</h4>
        <ul>
          <li><strong>It will not extract a passport number</strong>, even when the document shows
              one. Pulling it out here would write it into the run log on the way past, which is a
              copy nobody asked for. It is one field, typed once.</li>
          <li><strong>It will not invent a date.</strong> If the document gives no decision due
              date, the box comes back empty and the omission is listed under "it could not find
              these" — a made-up deadline in a system that raises alerts is worse than no
              deadline.</li>
        </ul>
        <h4>Somebody already on the register</h4>
        <p>If the person looks like an existing client — same email, same phone, or both halves of
           the name — you are offered that record instead of a second one. Choosing it leaves the
           existing record exactly as it is; the reading does not overwrite what you already hold.</p>
        <h4>What it can read</h4>
        <p>Text, Markdown, CSV, HTML, JSON, .eml, PDF, PNG, JPEG, GIF and WebP, up to five files.
           With <code>AI_PROVIDER</code> set to <code>anthropic</code>, PDFs and photographs are
           read directly. On Cloudflare's own models it is text only, and it says so by name rather
           than quietly ignoring the attachment.</p>`,
    },
    {
      id: 'notes',
      title: 'File notes',
      body: html`
        <p>Every case has <strong>File notes</strong>: what the client said on the telephone, what
           was advised, what was decided and when. This is where the story of a matter is told.</p>
        <p><strong>You have five minutes to fix a slip.</strong> Under a note you have just
           written there is a <strong>Correct this note</strong> link, for five minutes and once
           only. Use it for the wrong date or a mistyped word — what the note said before is kept
           either way, so nothing is lost by correcting it.</p>
        <p><strong>After that a note cannot be edited or deleted.</strong> The database refuses it —
           not merely this screen, so it holds however the record is reached. That is what makes the
           file worth something later: a note that can be tidied up months afterwards is not a
           record of what happened, it is a record of what somebody now wishes had happened, and it
           is worth nothing in a complaint, a standards inquiry or a Tribunal appeal.</p>
        <p>So if you find something wrong later, <strong>add a correction as a new note</strong>.
           Both stand, in order, which is exactly what an honest file looks like.</p>
        <h4>Backdating</h4>
        <p>Set <strong>It happened on</strong> to the day of the call or meeting; the note is filed
           under that date while the file still records the day you wrote it up, and the timeline
           shows both when they differ. Nothing is hidden by writing a note late — only by not
           writing it at all.</p>
        <h4>Attachments</h4>
        <p>A note can carry a file — a letter, a scan, a signed form — which is then linked from the
           note and listed under Documents. This needs R2 storage switched on; until it is, the file
           box says so and everything else works. See
           <a href="/help?s=connecting">Connecting Telegram, WhatsApp and email</a> for how to enable
           it.</p>
        <p>If a file cannot be stored for any reason, the note is still saved and you are told —
           what you typed is never lost because an upload failed.</p>`,
    },
    {
      id: 'flags',
      title: 'Warnings on a file',
      body: html`
        <p>Some facts change how a matter is handled and have no box of their own — a client
           assaulted by a former partner and reported to Police, a conviction, a previous refusal,
           an address you must not write to. Buried in a file note three screens down, that is
           something you find <em>after</em> you needed it.</p>
        <p>So put it in a <strong>warning</strong>. Press <strong>Raise a warning</strong> on a
           client or a matter, choose what kind it is, and say in a sentence what somebody needs to
           know. It then shows in an amber band at the very top of that record, before anything
           else on the page.</p>
        <h4>A warning on a client shows on all of their matters</h4>
        <p>Because the fact is about the person, not about one application. A warning you had to
           raise again on every new file is a warning that stops being raised. It is taken down from
           the client&rsquo;s own page, and the band says so.</p>
        <h4>How long it stands</h4>
        <p>Choose <strong>Until it is taken down</strong> for something permanent, or a period —
           30 days, three months, six months, a year — for something true only for a season
           (&ldquo;overseas until March&rdquo;, &ldquo;do not telephone&rdquo;). A warning past its
           date stops showing on its own, without anybody having to remember.</p>
        <h4>Taking one down</h4>
        <p><strong>Take it down</strong> under the warning itself, and say why. It is not deleted:
           a warning that stood on a file for six months is part of how that file was handled, and
           why it came down is the useful half. Warnings no longer showing are listed under
           <strong>Warnings taken down</strong>, and any of them can be put back.</p>
        <h4>The kinds</h4>
        <p>Safety, character, health, immigration history, contact, money and other &mdash; and like
           every other list in the register, an administrator can change them under
           <a href="/settings">Settings</a> without a deployment.</p>
        <p>A warning is not a file note and not an alert. A note records what was said at the time
           and stands forever; an alert answers &ldquo;what falls due&rdquo;. A warning answers
           &ldquo;what should I know before I open my mouth&rdquo;.</p>`,
    },
    {
      id: 'files',
      title: 'Files on a client or a matter',
      body: html`
        <p>Every client and matter page has a <strong>Files</strong> section, grouped under headings
           — Identity, Health, Character, English, Relationship and so on. The headings are a list an
           administrator edits in Settings, like the other dropdowns, so they can follow how this
           practice actually sorts a file.</p>
        <p>A file can be an <strong>upload</strong> or a <strong>link</strong> to something in a
           drive such as Google Drive. The difference matters: for a link, the register controls who
           sees the link and the drive controls who can open the file, and that caution is shown
           wherever a linked file appears. If the drive's sharing is loose, the register cannot
           tighten it.</p>
        <p>A client's document can be <strong>shown on a matter</strong> without being copied. One
           file has one owner — the record it was uploaded to — and showing it elsewhere is a
           reference. Removing it from the matter removes the reference, not the file.</p>
        <p>Uploading needs file storage switched on. Until it is, the register keeps a document's
           name, type and size but not its contents, and says so rather than appearing to have kept
           something it did not.</p>`,
    },
    {
      id: 'tasks',
      title: 'Tasks',
      body: html`
        <p>Raise a task from wherever you noticed the need — the case page, the client page, or the
           Tasks page for anything standalone. A task raised from a case stays attached to it and
           shows on that case.</p>
        <p>Everything about a task can be changed afterwards: title, detail, due date, priority,
           who owns it, and whether it stays attached. Overdue tasks appear on the Dashboard and on
           Alerts.</p>
        <p><strong>Every task belongs to someone.</strong> It defaults to you and can be handed
           over, but it cannot be left with nobody: an unassigned task sits in the list looking
           accounted for and is exactly the sort of thing that gets missed. What a task is
           <em>about</em> stays optional — a client, a case, a knowledge base article, or nothing
           at all.</p>
        <h4>What was done</h4>
        <p>When you mark a task done, the register asks for a line about what was done and how.
           The task is already complete by then — the box does not hold anything up, and
           <strong>Nothing to add</strong> closes it in one press.</p>
        <p>It is worth filling in. A history of "done, done, done" answers nothing six months
           later, when the question is what was actually said to INZ, or which of three options
           the client took. The note is saved on the task and added to the file of whatever the
           task was attached to, so somebody reading the case finds it without going looking.</p>
        <p>A note is never overwritten. Change it later — by editing the task — and the new
           wording is added to the file as another line, leaving the first where it was. If you
           would rather not be asked at all, turn off <em>Ask what was done when I complete a
           task</em> under your account preferences; you can still add the note by editing the
           task.</p>`,
    },
    {
      id: 'knowledge',
      title: 'The knowledge base',
      body: html`
        <p>Under <strong>Knowledge</strong> the practice keeps the material it has to look things up
           in: visa packs, internal circulars, legal material, announcements and immigration
           instructions. Anything you file is searchable, taggable and dated.</p>
        <h4>Two dates, kept apart</h4>
        <p>An article records <strong>when it was published</strong> — the date the source issued
           it — and separately <strong>when it takes effect</strong>. Immigration instructions are
           routinely announced weeks before they bite, and keeping the two apart is what lets the
           register answer both “what was the rule in March” and “what changes next month”. There
           are two more if you want them: when it stops applying, and when someone should look at
           it again.</p>
        <h4>It reminds you by itself</h4>
        <p>A published article carrying any of those dates raises a task against it, due
           <strong>a week ahead</strong> by default. Change that lead time under
           <strong>Settings → Knowledge base</strong> and every existing follow-up corrects itself
           overnight — you do not have to reopen the articles. Set it to 0 and the task falls on
           the day itself.</p>
        <p>The task belongs to whoever filed the article. Finish or cancel one and it stays
           finished: the nightly run will not reopen a decision you have made.</p>
        <h4>Filing what arrives</h4>
        <p>When a circular comes in by email, Telegram or WhatsApp, open it in the
           <strong>Inbox</strong> and choose <strong>File in the knowledge base</strong>. The
           subject, the text and the date it arrived are carried across; you add the kind and the
           effective date. The original message stays in the inbox, and the article links back to
           it, so where something came from is always answerable.</p>
        <h4>Editing, and the history</h4>
        <p>Anyone with write access can edit an article. Each edit keeps the previous version,
           with a note of what changed if you write one — so what an article said on the day you
           advised a client remains recoverable. That history is append-only: the database refuses
           to alter or delete it, not merely the application.</p>
        <p>Marking a new article as replacing an old one moves the old one to
           <strong>Superseded</strong> and stops its follow-up tasks, without deleting anything.</p>
        <h4>Kinds are yours to change</h4>
        <p>The list of kinds lives in <strong>Settings → Knowledge base</strong>, one per line as
           <code>key | Label</code>. Add one whenever you need it. Renaming a label is free;
           changing a key leaves existing articles on the old one, so prefer relabelling.</p>`,
    },
    {
      id: 'automations',
      title: 'Automations — work the register proposes',
      body: html`
        <p>Under <strong>Alerts → For approval</strong> is a queue of things the register would
           like to do, and under <strong>Automations</strong> (also on the Admin bar) are the rules
           that put them there.</p>
        <h4>What a rule is</h4>
        <p>A trigger, a window and an action, and it reads back as one sentence: <em>when a case
           deadline is approaching within 7 days, create a task for Tai, for approval</em>. If a
           rule is harder to say than that, it is a program, and a program does not belong in a
           form.</p>
        <p>The triggers are questions the register can already answer from dates it already holds:
           a case deadline approaching, a task past its due date, a quote about to lapse, a client
           document expiring, a message sitting untriaged in the inbox. Write a rule this afternoon
           and it matches everything that already qualifies, not only what happens next.</p>
        <h4>What it may do on its own</h4>
        <p>A <strong>task</strong> is internal, so a rule may be written to raise one without
           asking: the worst case is a task somebody closes. A task always has a name against it —
           the rule's, or the record's owner — and if there is neither, the rule does not act and
           says so on the Automations page rather than failing quietly.</p>
        <p>An <strong>email</strong> is never sent by a rule. It is written, put in the queue, and
           waits for a person; the record then says which person approved it. This is not a setting
           you can turn off: the database itself refuses to store an email rule that skips
           approval.</p>
        <p>A <strong>digest</strong> is one message gathering everything a rule matched instead of
           one message per record. It waits for approval too.</p>
        <h4>It proposes once</h4>
        <p>Every proposal is keyed to its rule, its record and the date that caused it, so the
           nightly run cannot raise the same thing twice and something you dismissed stays
           dismissed. If the date moves, that is genuinely a new thing, and it is proposed again.</p>
        <h4>Where the AI comes in, and where it does not</h4>
        <p>In one place: the covering paragraph at the top of a digest. The list underneath it is
           assembled by the register, the recipient comes from the rule, and the sending waits for
           you. With the AI layer switched off every rule still fires, still proposes and still
           acts — the digest simply arrives as the list.</p>
        <p>It is written when the digest is proposed rather than when it is approved, so what you
           read is what goes out.</p>
        <h4>When it runs</h4>
        <p>Every night, and whenever you press <strong>Run the rules now</strong>. Running it twice
           costs nothing.</p>`,
    },
    {
      id: 'decisions',
      title: 'Expected decisions, and chasing INZ',
      body: html`
        <p>When a matter is lodged, the register fills in an expected decision date — a month after
           lodgement by default — unless you have given one. It is a starting point, not a rule:
           INZ publishes processing times per visa type, and the adviser on the matter knows better
           than a default does, so the date stays editable on the matter itself.</p>
        <h4>When that date passes</h4>
        <p>A task is raised to follow it up, assigned to whoever owns the matter. Then another a
           month later, and another the month after — three chases on the default schedule.</p>
        <p>All of it is adjustable under <strong>Settings → Decisions and chasing INZ</strong>:
           how long a decision is expected to take, whether to chase at all, on what schedule, and
           at what priority. The schedule counts <em>from the expected decision date</em>, so
           <code>0, 1, 2</code> means on the day it was expected and then monthly twice more.
           Anchoring it there rather than on lodgement means changing how long a decision takes
           moves the chases with it, instead of chasing before the decision is even due.</p>
        <h4>A matter that should not be chased</h4>
        <p>Untick <strong>Chase INZ when this decision is overdue</strong> on the matter. Chases
           already raised are withdrawn. Use it for a file under a formal complaint, or where the
           client has asked for silence.</p>
        <p>The chases are rebuilt from the matter's dates every night, so moving the expected
           decision moves them, a decision arriving withdraws what is left, and a chase you have
           already done is left alone.</p>`,
    },
    {
      id: 'certificates',
      title: 'Police certificates, medicals and x-rays',
      body: html`
        <p>Each one is a record with its own dates, kept on the client's page under
           <strong>Certificates</strong> — not a set of boxes that the next one overwrites.</p>
        <p>That distinction is the point. A matter lodged in March relied on the certificate held in
           March, and if the client produces a fresh one in September the March fact would otherwise
           be gone. "Which certificate did we lodge with?" is a question a practice has to be able
           to answer, sometimes years later.</p>
        <p>A client may also hold police certificates from several countries at once — you need one
           from everywhere they have lived twelve months or more — and a single set of boxes could
           never represent that. The most recent of each kind is marked <strong>current</strong>;
           the rest are marked superseded and stay on the file.</p>
        <p>A medical is either a <strong>General Medical</strong> (INZ 1007) or a
           <strong>Limited Medical</strong> (INZ 1201), and which one was done decides what INZ will
           accept it for.</p>
        <p>The alerts page watches the current one of each kind. Where several police certificates
           are current, it watches the one expiring soonest, because that is the one that bites
           first.</p>
        <h4>The expiry works itself out</h4>
        <p>You do not type the expiry of a police certificate or a medical. INZ works it out from
           the issue date, and so does the register: a police certificate is good for six months,
           or twenty-four once it has gone in with an application; a medical is three months, or
           thirty-six. Record the day it was submitted and the expiry moves by itself.</p>
        <p>The <strong>Submitted with an application on</strong> box sits under a certificate until
           you have used it, then goes away. Changing it afterwards is a correction, and
           corrections go through Edit.</p>
        <h4>Correcting one</h4>
        <p><strong>Edit</strong> under any certificate changes the issue date, the country, the
           reference or the note. Every change is written onto the client's file as a note saying
           what moved — <em>issued 03 Feb 2026 — 03 Mar 2026; expires 03 Aug 2026 —
           03 Sep 2026</em> — and into the audit log. That is what makes it safe to correct one an
           application already relied on.</p>
        <p>What you cannot change is <em>which kind</em> it is. A police certificate that turns out
           to be a medical is a different document, not a corrected one — record it as a new
           one and remove the wrong one.</p>
        <h4>A date read by a machine</h4>
        <p>Where an issue date came from a filename or from reading a scan, the certificate carries
           <strong>issue date unverified</strong> in amber and says where the date came from.
           The expiry above it is worked out from that date, so it is unverified too. Check it
           against the paper and press <strong>Confirm against the certificate</strong>.</p>`,
    },
    {
      id: 'export',
      title: 'Taking your data out',
      body: html`
        <p><strong>Settings → Export.</strong> Fifteen sets of records, each one link and one file:
           clients, matters, parties, certificates, fees, quotes and their lines, invoices and their
           lines, payments, tasks, notes, inquiries, the knowledge base and the audit log.</p>
        <p>They are CSV — comma separated, quoted to the standard, and written as UTF-8 with a
           byte-order mark so Excel reads macrons correctly rather than mangling every Māori name.
           They open in Excel, Numbers, Google Sheets or anything that reads a text file.</p>
        <p>Your records are yours. A system that makes them hard to leave with is holding them,
           whatever its intentions, so there is no queue, no email and no "we will prepare your
           export".</p>
        <h4>Two things worth knowing</h4>
        <p><strong>Passport numbers are in none of them.</strong> They are readable on the client's
           own page, where you are signed in and the page is behind your role — but a spreadsheet
           in a downloads folder travels, gets emailed on and outlives the reason it was made. The
           client export says only whether a passport is held.</p>
        <p><strong>Every download is recorded</strong> in the audit log — what was taken, by whom,
           and when. An export is a copy of the practice's files leaving the building, and that is
           worth a line.</p>
        <p class="hint">Reading data back in is a separate job and is not built. An import has to
           decide what to do about records that already exist, and getting that wrong is worse than
           not having it.</p>`,
    },
    {
      id: 'calendar',
      title: 'Calendar',
      body: html`
        <p>Your dates laid out as a month. Everything the register already knows falls on it —
           decision deadlines, tasks, visa and passport and certificate expiries, invoices due,
           quotes running out, warnings about to lapse — plus what has already happened: when a
           matter was lodged, and when it was decided.</p>
        <p><strong>It holds nothing of its own.</strong> Every entry belongs to a record, and is
           changed on that record. Moving a visa expiry on a calendar would not change when the
           visa expires, so the calendar does not offer to.</p>
        <p><strong>The colours are the filter.</strong> The row of keys under the month is not
           just a legend: click one and that kind comes off the month, click it again and it
           comes back. The number beside each says how many there are this month. Nothing is
           remembered between visits — the calendar opens the same way every time.</p>
        <p>A decision says which way it went: <strong>Approved — </strong> or
           <strong>Declined — </strong>, taken from the matter's status. Where a matter was
           decided and later closed, the first words of the outcome are used instead.</p>
        <p><strong>Everyone or just yours.</strong> "Mine" narrows it to matters and tasks
           assigned to you. Client dates — visas, passports, certificates — belong to a client
           rather than to a person, so they step aside in that view rather than being listed
           under somebody's name.</p>
        <p>Click a day with something on it to see that day on its own. Under the month there is
           always the full list in order, which is what you get on a phone: seven columns do not
           fit a phone screen, so the month steps aside and the list takes over.</p>
        <p><strong>Month, week or year.</strong> The week gives each day a full column, so a busy
           day shows everything on it instead of “+4 more”. The year is twelve small
           months, with a mark on every day that has something on it, coloured by the most
           pressing thing there — click a month name or a marked day to go straight to it.
           Whichever view you switch to lands where you were, not back on today.</p>
        <p>Move with the arrows, or press <strong>This month</strong> to come back. The
           month you are looking at is in the address, so a particular month can be bookmarked
           or sent to somebody.</p>`,
    },
    {
      id: 'alerts',
      title: 'Alerts',
      body: html`
        <p>One page for everything with a date: case deadlines, overdue tasks, quotes about to
           expire, and client documents about to expire. Sorted by how soon each one bites, with
           counts for overdue and for the next fortnight.</p>
        <p>Filter by type, or widen the horizon from 30 days out to a year. If a date is not on
           this page, the register does not know about it — which is the argument for recording
           expiry dates as you get them.</p>`,
    },
    {
      id: 'account',
      title: 'Your account and security',
      body: html`
        <p>Under <strong>My account</strong> you can change your password, see every device you are
           signed in on, and sign any of them out. The line under the heading is your name, your
           email address and your role — an administrator changes the first two, under
           Settings → People.</p>
        <p><strong>Turn on two-factor authentication.</strong> This register holds passport numbers,
           immigration histories and fee arrangements. Two-factor is the single biggest thing you
           can do to protect it. You will be given eight recovery codes when you set it up — save
           them somewhere safe, because they are shown once.</p>
        <p>Changing your password signs out every other device automatically.</p>
        <h4>Your preferences</h4>
        <p>Under <strong>My account → Preferences</strong> you choose how <em>you</em> like to work:
           which page you land on after signing in, how many rows a list shows, whether Clients
           opens on Leads or Individuals, whether Cases opens on open matters or everything.</p>
        <p>These affect nobody else. They are not settings — a <strong>setting</strong> says how the
           practice works and one answer serves everybody, so an administrator owns it; a
           <strong>preference</strong> is yours, and needing an administrator to change where you
           land after signing in would be absurd.</p>
        <h4>Being told when something arrives</h4>
        <p>Under <strong>My account → Preferences → Alerts</strong> you decide whether a small
           banner appears when a message lands in the inbox, which corner it appears in, which
           sound it makes, and how often the register looks. Set the check to <strong>Never</strong>
           and it stops asking altogether — no banner, no sound, and no request going out.</p>
        <p>The sounds are made by the browser rather than downloaded, so nothing is fetched and
           there is nothing to load. Two things worth knowing: a browser will not make a sound
           until you have clicked something on the page, so the first alert after opening a fresh
           tab may be silent; and while the tab is in the background the register does not check at
           all, because the answer would only be shown when you came back to it.</p>
        <p>The banner carries the channel and the subject line and nothing else — never the body of
           a message — and clicking it opens that message in the inbox.</p>
        <h4>Appearance</h4>
        <p>Pick one of six themes — <strong>Slate</strong>, <strong>Warm</strong> or
           <strong>Ink</strong> for quiet working colours, or <strong>Blossom</strong>,
           <strong>Lagoon</strong> and <strong>Aurora</strong> for bold ones — and choose whether
           the register follows your device's day and night setting or stays light or dark all the
           time. Every one has both, and every one is checked for legibility: a test fails if any
           combination of text and background in any theme falls below the accessibility standard
           for normal text. The choice is saved against your
           account rather than the browser, so it travels with you to your phone and back.</p>`,
    },
    {
      id: 'website',
      title: 'The public page',
      body: html`
        <p>The address of this register also serves a public page, shown to anyone who arrives
           without being signed in. Signing in takes you past it to your own first screen.</p>
        <p>Everything on it is edited under <strong>Settings → Website</strong> — the
           headline, the services, the steps, the questions and the closing invitation — so the
           wording is yours to change without anyone touching code.</p>
        <p>Four of those fields are lists. Put <strong>one item per line</strong>, with a vertical
           bar between the heading and the text:</p>
        <pre>Work visas | AEWV applications, job changes and employer accreditation.
Residence | Skilled Migrant, partnership and parent category.</pre>
        <p>A line with no bar becomes a heading on its own. Blank lines are ignored, so you can
           space the box out while you write.</p>
        <h4>Two switches worth understanding</h4>
        <ul>
          <li><strong>Accept enquiries through the page</strong> is off to begin with. Turn it on
              and the page grows a short form; anything sent through it arrives as a new inquiry in
              the register, marked as coming from the web, ready to triage like any other. With it
              off, the page shows your email address instead.</li>
          <li><strong>Allow search engines to index it</strong> is also off. This address serves
              your client register as well as this page, so putting it into search results is a
              decision to take deliberately — turn it on once the page is on a domain you are happy
              to see listed.</li>
        </ul>
        <p>Turning <strong>Show the public page</strong> off sends visitors straight to the sign-in
           screen, as before.</p>`,
    },
    {
      id: 'connecting',
      title: 'Connecting Telegram, WhatsApp and email',
      body: html`
        <p>Four connections, each independent — set up whichever you want, in any order, and the
           rest of the register carries on working without them.</p>

        <div class="alert alert-warn">
          <p><strong>Where secrets go.</strong> None of these keys are typed into the application.
             They live in GitHub, under <strong>Settings → Secrets and variables → Actions →
             New repository secret</strong>, and the deploy uploads them to Cloudflare for you.
             That way a key is never in the database, never in a form post, and never in the audit
             log — and rotating one leaves a trace in the deployment history.</p>
          <p class="mb">After adding or changing any secret, go to the repository’s
             <strong>Actions</strong> tab, open <strong>Deploy</strong>, and press
             <strong>Run workflow</strong>. Nothing takes effect until that finishes.</p>
        </div>

        <h4>1 · Telegram — forward a message and it lands here</h4>
        <ol>
          <li>In Telegram, search for <strong>@BotFather</strong> and start a chat with it.</li>
          <li>Send <code>/newbot</code>. It asks for a name (anything, e.g. “Immigration Register”)
              and then a username, which must end in <code>bot</code> — for example
              <code>immigration_register_bot</code>.</li>
          <li>BotFather replies with a <strong>token</strong> that looks like
              <code>1234567890:AAH...</code>. Save it as the repository secret
              <code>TELEGRAM_BOT_TOKEN</code>. Treat it like a password — anyone holding it
              controls the bot.</li>
          <li>Make up a second, separate random string — twenty or more characters, letters and
              numbers only. Save it as <code>TELEGRAM_WEBHOOK_SECRET</code>. This is how the
              register knows a webhook really came from Telegram; a request arriving without it is
              dropped before anything is read.</li>
          <li>Find your own numeric Telegram ID: message <strong>@userinfobot</strong> and it
              replies with a number. Save that as <code>TELEGRAM_ALLOWED_USER_IDS</code>. Several
              people are separated by commas. Only these IDs can create records — anyone else’s
              message is still captured for you to look at, but creates nothing by itself.</li>
          <li>Deploy (Actions → Deploy → Run workflow), so the three secrets reach the Worker.</li>
          <li>Now tell Telegram where to deliver. Paste this into a browser address bar, with your
              own bot token and webhook secret substituted in:
              <pre>https://api.telegram.org/bot<strong>YOUR_BOT_TOKEN</strong>/setWebhook?url=${origin}/api/ingest/telegram&amp;secret_token=<strong>YOUR_WEBHOOK_SECRET</strong></pre>
              A reply of <code>{"ok":true,"result":true,...}</code> means it is connected.</li>
          <li>Test it: send your bot any message, then open <strong>Inbox</strong> here. It should
              be waiting.</li>
        </ol>
        <p class="hint">To check the connection later, visit
           <code>https://api.telegram.org/bot<strong>YOUR_BOT_TOKEN</strong>/getWebhookInfo</code>.
           <code>last_error_message</code> tells you what Telegram is unhappy about.</p>

        <h4>2 · WhatsApp — via the Meta Cloud API</h4>
        <p>This one is more involved, because WhatsApp is Meta’s and Meta requires a business
           account. Allow half an hour.</p>
        <ol>
          <li>Go to <a href="https://developers.facebook.com" rel="noopener">developers.facebook.com</a>
              and sign in. Choose <strong>My Apps → Create App</strong>, pick
              <strong>Business</strong>, and give it a name.</li>
          <li>On the app’s dashboard, find <strong>WhatsApp</strong> and press
              <strong>Set up</strong>. Meta gives you a test number to begin with; a real number is
              added later under <strong>API Setup</strong>.</li>
          <li>Go to <strong>App settings → Basic</strong> and copy the <strong>App secret</strong>
              (press Show). Save it as <code>WHATSAPP_APP_SECRET</code>. Meta signs every delivery
              with this, and the signature is checked before the message is read.</li>
          <li>Make up another random string and save it as <code>WHATSAPP_VERIFY_TOKEN</code>. It
              is used once, during the handshake in step 6.</li>
          <li>Save the phone numbers allowed to create records as
              <code>WHATSAPP_ALLOWED_SENDERS</code> — full international form, commas between
              them, e.g. <code>64211234567,6421999888</code>. Deploy now, before the next step.</li>
          <li>In the app, go to <strong>WhatsApp → Configuration</strong> and press
              <strong>Edit</strong> beside Webhook. Enter:
              <ul>
                <li><strong>Callback URL</strong>: <code>${origin}/api/ingest/whatsapp</code></li>
                <li><strong>Verify token</strong>: the string from step 4</li>
              </ul>
              Press <strong>Verify and save</strong>. Meta calls the register to check; if it fails,
              the deploy in step 5 has not finished.</li>
          <li>Still on Configuration, under <strong>Webhook fields</strong>, press
              <strong>Manage</strong> and subscribe to <strong>messages</strong>. Without this
              nothing is delivered.</li>
          <li>Test: message the WhatsApp number from an allowed phone, then check
              <strong>Inbox</strong>.</li>
        </ol>
        <p class="hint">Meta’s test number only messages numbers you have added to it. To take
           enquiries from the public you need a real number and Meta’s business verification, which
           takes a few days.</p>
        <p><strong>To reply from inside the app as well as receive</strong>, add two more secrets:
           <code>WHATSAPP_TOKEN</code> (the access token on the same API Setup page) and
           <code>WHATSAPP_PHONE_NUMBER_ID</code> (shown beside the number there). Without them
           WhatsApp still arrives; a reply is saved and marked as waiting rather than sent.</p>
        <p class="hint">WhatsApp only accepts free text within 24 hours of the person's last
           message. Outside that window Meta refuses it and only an approved template may be sent;
           the refusal is shown on the message rather than hidden.</p>

        <h4>3 · Email in — Cloudflare Email Routing</h4>
        <ol>
          <li>In the Cloudflare dashboard, open the domain you want to receive on and choose
              <strong>Email → Email Routing</strong>. Enable it and add the DNS records it offers —
              it can do this for you.</li>
          <li>Under <strong>Routing rules → Create address</strong>, make an address such as
              <code>register@yourdomain</code>.</li>
          <li>For the action, choose <strong>Send to a Worker</strong> and pick
              <strong>clientregister</strong>.</li>
          <li>Save the addresses whose mail should create records as
              <code>INGEST_EMAIL_ALLOWED_SENDERS</code> — commas between them. Mail from anyone
              else is still captured in the inbox for triage.</li>
          <li>Deploy, then send a test email to the address.</li>
        </ol>

        <h4>4 · Email out — sending from your Gmail</h4>
        <p>Cloudflare Workers cannot use SMTP: it needs a kind of network connection the platform
           does not offer. Gmail is therefore connected through Google’s own API, which also means
           the messages this register sends appear in your Gmail <strong>Sent</strong> folder and
           replies come back to the inbox you already read.</p>
        <p>Google is retiring app passwords, so this uses OAuth — a one-off authorisation you give
           to your own application. It looks long written down; it is about fifteen minutes.</p>
        <ol>
          <li>Go to <a href="https://console.cloud.google.com" rel="noopener">console.cloud.google.com</a>
              and sign in <em>with the Gmail account you want to send from</em>. Create a project
              (top bar → New project); call it anything.</li>
          <li>Open <strong>APIs &amp; Services → Library</strong>, search for
              <strong>Gmail API</strong>, and press <strong>Enable</strong>.</li>
          <li>Open <strong>APIs &amp; Services → OAuth consent screen</strong>.
              <p><strong>On Google Workspace</strong> — a firm address like
                 <code>you@yourfirm.nz</code> — choose <strong>Internal</strong>. That is the whole
                 step. Only people in your organisation can use the app, so there is no
                 verification, no test-user list, no “unverified app” warning, and no token
                 expiry. If <strong>Internal</strong> is greyed out, the project was created
                 outside the organisation: start again signed in as a Workspace user.</p>
              <p class="mb"><strong>On a personal Gmail account</strong> choose
                 <strong>External</strong>, add the address under <strong>Test users</strong>, and
                 then press <strong>Publish app</strong> so the status reads <strong>In
                 production</strong>. This matters more than it looks: <strong>a refresh token
                 issued while the app is in Testing expires after seven days</strong>, and mail
                 would stop a week after setup with nothing obviously wrong. Publishing is not
                 verification — the “unverified app” warning at the next step is expected.</p></li>
          <li>Open <strong>APIs &amp; Services → Credentials → Create credentials → OAuth client
              ID</strong>. Choose <strong>Web application</strong>. Under
              <strong>Authorised redirect URIs</strong> add exactly:
              <pre>https://developers.google.com/oauthplayground</pre>
              Create it, and copy the <strong>Client ID</strong> and <strong>Client secret</strong>.</li>
          <li>Go to <a href="https://developers.google.com/oauthplayground" rel="noopener">the OAuth
              Playground</a>. Press the gear at the top right, tick <strong>Use your own OAuth
              credentials</strong>, and paste the client ID and secret in.</li>
          <li>In the left-hand list, ignore the categories and type this into the box marked
              “Input your own scopes”:
              <pre>https://www.googleapis.com/auth/gmail.send</pre>
              Press <strong>Authorize APIs</strong>, sign in as your Gmail account and allow it.
              Google warns that the app is not verified — that is expected; choose
              <strong>Advanced → Go to (your app)</strong>.</li>
          <li>Back in the Playground, press <strong>Exchange authorization code for tokens</strong>.
              Copy the <strong>Refresh token</strong> — the long one starting <code>1//</code>.
              On an Internal (Workspace) app, or a published External one, it does not expire
              unless you revoke it or change the account's password. If mail stops about a week
              after setup, the app was left in Testing: fix step 3 and take a fresh token.</li>
          <li>Save four repository secrets:
              <ul>
                <li><code>MAIL_PROVIDER</code> = <code>gmail</code></li>
                <li><code>MAIL_FROM</code> = how you want to appear, e.g.
                    <code>Tai &lt;you@gmail.com&gt;</code> — the address must be the account you
                    just authorised. Gmail will not let you send as anything else, so this is the
                    address every client sees. If it is not the address you want them to answer,
                    set <strong>Settings → Practice → “Replies should go to”</strong> as well and
                    their replies will land wherever you say.</li>
                <li><code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> from step 4</li>
                <li><code>GMAIL_REFRESH_TOKEN</code> from step 7</li>
              </ul>
          </li>
          <li>Deploy. <strong>Settings → Integrations</strong> should now show outbound email as
              configured. Send a quote by email to test it.</li>
        </ol>
        <p class="hint">Gmail allows roughly 500 messages a day on a personal account and 2,000 on
           Workspace — far above what a practice sends by hand, but not a bulk mailing tool. If you
           ever need to send from <code>@yourdomain</code> rather than Gmail, use Resend instead —
           below.</p>

        <h4>4b · Email out — Resend, to send as the practice</h4>
        <p>Resend sends from your own domain rather than a mailbox. Use it when clients should see
           mail from the firm's address rather than from a personal Gmail.</p>
        <ol>
          <li>At <a href="https://resend.com" rel="noopener">resend.com</a>, add your domain under
              <strong>Domains</strong> and create the DNS records it gives you. If the domain is on
              Cloudflare this is a few minutes; verification is usually quick.</li>
          <li>Under <strong>API Keys</strong>, create one with <strong>Sending access</strong> — not
              Full access. The register only sends, and a key that can also delete domains is a key
              that can do real damage if it leaks. Scope it to the domain you just verified. It is
              shown once.</li>
          <li>Add three GitHub repository secrets:
              <code>MAIL_PROVIDER</code> = <code>resend</code>, <code>RESEND_API_KEY</code> = the
              key, and <code>MAIL_FROM</code> = the sending address, written as
              <code>Your Name &lt;you@yourdomain&gt;</code>.</li>
          <li>Deploy. Secrets only reach the register on the next deploy.</li>
          <li>Go to <strong>Settings → Integrations</strong> and send a test message. Your own
              address is filled in, but try one at whatever your clients use — Gmail and Outlook
              judge a new sending domain more harshly than most, and a message they file in spam
              is worth knowing about before a quote goes to a client.</li>
        </ol>
        <p><strong>If the test lands in spam, that is normal for a domain that has only just started
           sending</strong>, and it settles as a few more messages go out. Better to find that on
           your own inbox than on a client's.</p>
        <h4>When replies should go somewhere else</h4>
        <p>The address mail is sent <em>from</em> and the mailbox a reply lands in are two different
           questions. Sending is authorised by DNS — a provider will only put a From address on a
           domain verified with it — while receiving needs a mailbox that domain may not have.</p>
        <p>If your sending domain has no mailbox behind it, set <strong>Replies should go to</strong>
           under <strong>Settings → Practice</strong> to the address you actually read. Every
           outbound message then carries it. Leave it empty when the sending address is itself a
           working mailbox, which is the ordinary case.</p>

        <h4>4c · Email in — a mailbox the register reads for you</h4>
        <p>Sections 1 to 3 all work by forwarding: you see something, you send it on, it lands
           here. That is fine and it is reliable, and it is also one more thing to remember on a
           day when there are forty of them. This is the other way round — the register reads a
           mailbox on a schedule and takes what it finds.</p>
        <div class="alert alert-warn">
          <p class="mb"><strong>Use an account that holds nothing else.</strong> Whatever holds the
             authorisation can read every message in that mailbox, and it is a deployment secret
             rather than something you unlock each morning. So: a new, empty Gmail account whose
             only job is to receive forwarded working mail. Never your own inbox, and never an
             account carrying anything privileged that has not been forwarded there deliberately.</p>
        </div>
        <ol>
          <li>Create the account — something like
              <code>practiceinbox@gmail.com</code> — and turn on two-factor authentication for it.</li>
          <li>In the mail account you actually work in, set up <strong>forwarding</strong> to that
              address. In Gmail that is <strong>Settings → Forwarding and POP/IMAP → Add a
              forwarding address</strong>, then confirm from the new account and choose
              <strong>Keep Gmail's copy in the Inbox</strong>. Forward <em>received</em> mail only.
              Do not forward sent items: the register would read its own outgoing mail back.</li>
          <li>Repeat steps 1 to 7 of section 4 above <em>signed in as the new account</em>, with one
              change — the scope is
              <pre>https://www.googleapis.com/auth/gmail.readonly</pre>
              Read-only on purpose. The register never labels, moves, marks or deletes anything in
              that mailbox; what it has taken is shown in <strong>Incoming</strong>, which is
              where you would be looking anyway.</li>
          <li>Save three repository secrets:
              <ul>
                <li><code>GMAIL_INBOX_REFRESH_TOKEN</code> — the refresh token for the new account</li>
                <li><code>GMAIL_INBOX_CLIENT_ID</code> and <code>GMAIL_INBOX_CLIENT_SECRET</code> —
                    from that account's OAuth client. If it is the same Google project you used for
                    sending, you may leave these out and the sending ones are used; the refresh
                    token is never shared, because it is what names the mailbox.</li>
                <li><code>GMAIL_INBOX_ADDRESS</code> — optional, and only so the integrations page
                    can tell you which mailbox is being read.</li>
              </ul></li>
          <li>Deploy. <strong>Settings → Integrations</strong> then shows the poll as configured,
              and mail starts appearing in <strong>Incoming</strong> within five minutes.</li>
        </ol>
        <p>What happens to a message it finds is the same as if you had forwarded it by hand: if
           the sender is on the trusted list it becomes an inquiry, and otherwise it waits in
           <strong>Incoming</strong> for you. <strong>Nothing on a matter changes by itself</strong>
           — no status, no date, no task. The register files the correspondence; you decide what it
           means.</p>
        <p class="hint">It looks back two days on every pass, so a missed run or an outage catches
           up by itself. Reading the same message twice costs nothing — it is recognised by its own
           message id and captured once.</p>

        <h4>5 · Document storage — turning on R2</h4>
        <p><strong>R2</strong> is Cloudflare's file storage. The register keeps its records in a
           database, which holds text and numbers well but is the wrong place for a passport scan or
           a signed employment agreement. R2 is where those files go: the register stores the file
           there and keeps a note of where it is, who uploaded it and when.</p>
        <p>Until it is switched on, everything else works — you simply cannot attach files. The
           upload boxes say so rather than failing.</p>
        <ol>
          <li>Open the <a href="https://dash.cloudflare.com" rel="noopener">Cloudflare dashboard</a>
              and choose <strong>R2 Object Storage</strong> in the left-hand menu.</li>
          <li>Press <strong>Enable R2</strong>. Cloudflare asks for a card even for the free
              allowance. That allowance is <strong>10 GB of storage</strong> and generous monthly
              operation limits, with no charge for data leaving it — a practice storing scans and
              PDFs is unlikely to approach it, and there is no charge below the limit.</li>
          <li>Create a bucket called <code>clientregister-docs</code>. Leave the location
              automatic.</li>
          <li>In the repository, open <code>wrangler.jsonc</code> and uncomment the
              <code>r2_buckets</code> block near the bottom — it is already written, with the right
              bucket name and binding.</li>
          <li>Commit that change. The deploy that follows connects the two, and the file boxes
              appear throughout the register.</li>
        </ol>
        <p class="hint">If you would rather not give Cloudflare a card, everything except file
           attachment carries on working indefinitely. Nothing is broken by leaving it off.</p>

        <h4>Who triages what arrives</h4>
        <p>Everything from every channel lands in <strong>Inbox</strong> first, verbatim, and
           nothing is created from it automatically. That is deliberate: an inbound channel is an
           address a stranger can write to, and no stranger should be able to put a record into a
           client register unattended.</p>
        <p>Anyone with the <strong>triage</strong> permission — Owner, Administrator, Specialist or
           Assistant — can work the inbox. Each message offers three things: create an inquiry from
           it, file it in the knowledge base, or ignore it. A message from a sender who is not on
           that channel’s allow-list is flagged in orange, and the message is captured but nothing
           is offered until a person decides.</p>
        <p>In practice: whoever opens the office works the inbox each morning, converts genuine
           enquiries into inquiries, files circulars into the knowledge base, and ignores the rest.
           The <strong>Dashboard</strong> shows how many are waiting.</p>`,
    },
    {
      id: 'conversations',
      title: 'Conversations',
      body: html`
        <p>Under <strong>Incoming → Conversations</strong> each channel is a two-way thread: what
           somebody sent, and what the practice sent back, in one place and on the file.</p>
        <p>A thread is one counterpart on one channel — a Telegram chat, a WhatsApp number. It
           starts by itself the first time they write. Link it to a client and the conversation is
           part of that client's record.</p>
        <p><strong>Linking changes nothing about trust.</strong> Whether a sender may create
           records is decided by that channel's allow-list, which is a secret rather than a
           setting, and putting a name to a conversation does not touch it.</p>
        <p>Every reply is written by a person and stored with their name against it — nothing in
           this register writes on a channel by itself. If the channel is not connected yet the
           reply is saved and marked as waiting rather than lost, the same way outbound email has
           always worked.</p>
        <p>Email conversations are held as ordinary outbound mail, so they use whichever provider
           is configured and appear in the same queue.</p>`,
    },
    {
      id: 'lists',
      title: 'Changing the lists and dropdowns',
      body: html`
        <p>Under <strong>Settings → Lists and dropdowns</strong> you can rewrite the vocabulary this
           practice uses. <strong>Case types</strong> starts as your own list of visa matters — the
           VV, SV, WV and RV classes, then requests, appeals, responses, variations, transfers,
           citizenship and employer work — and you can add to it whenever instructions change.</p>
        <p>One per line, written as <code>key | Label</code>. Blank lines and lines starting with
           <code>#</code> are ignored, so you can group the list and annotate it:</p>
        <pre># Work
wv_aewv | WV. AEWV
wv_partner | WV. Partner</pre>
        <p>The key is what gets stored. Relabelling is free — change <code>WV. AEWV</code> to
           <code>Accredited Employer Work Visa</code> and every case follows. Changing a
           <em>key</em> leaves existing cases on the old one, and they will then show the raw key
           rather than a label, so prefer relabelling.</p>
        <p>Removing a type does not touch cases already filed under it. Those keep their value and
           display it as it stands, because a case filed last year under a type you no longer offer
           is still that kind of case.</p>
        <p>The same page holds the other lists the practice uses: titles, genders, relationship
           statuses, visa types, English tests, document categories, warning kinds, file note
           kinds, and — since the histories were added — <strong>employment kinds</strong> and
           <strong>education levels</strong>.</p>
        <p><strong>Case statuses are deliberately not here.</strong> They decide what the register
           <em>does</em> — which matters count as open, which carry a deadline, which raise an
           alert — so changing them would change how the system behaves rather than what it
           calls things. A file note kind decides nothing, which is why that one is yours.</p>
        <p><strong>Case statuses are deliberately not here.</strong> They decide which moves are
           legal — what a case may become from where it is — so changing them would change how the
           system behaves rather than what it is called. Kinds of knowledge base article live under
           Settings → Knowledge base, and quotable items under Quotes → standard items.</p>`,
    },
    {
      id: 'admin',
      title: 'Administration',
      body: html`
        <p>Owners and administrators get a <strong>Settings</strong> section, in four tabs:
           <strong>Overview</strong> for the day's numbers and the links to users, settings and the
           audit log; <strong>Integrations</strong> for what is connected and what is still missing;
           <strong>Modules</strong> for what this installation is made of; and
           <strong>Maintenance</strong> for the mail queue and the demonstration data.</p>
        <h4>Users and roles</h4>
        <p>Add a user and the system generates a temporary password shown once — hand it over
           yourself and have them change it. Suspending someone ends their sessions immediately,
           which is what you want the day somebody leaves.</p>
        <dl class="kv">
          ${ROLES.map((role) => html`<dt>${ROLE_LABELS[role]}</dt><dd>${ROLE_DESCRIPTIONS[role]}</dd>`)}
        </dl>
        <h4>Practice settings</h4>
        <p>Whether the practice is GST registered and at what rate, how new fee lines default, what
           the split is calculated on, and the default shares for new cases. Changing a default
           affects new records only.</p>
        <h4>Test data, and a caseload to learn on</h4>
        <p><strong>Settings → Test data.</strong> Anything in the register can be marked as test
           data — a client, a matter, a quotation, an inquiry, an invoice, a task — from a
           small box on its own page. Marking a client marks everything filed under them. The
           screen lists every marked record by name, and one button deletes the lot.</p>
        <p>A quotation cannot be unmarked once marked. That is deliberate: the mark is what
           releases it from being a signed contract, and letting it back would be a way of
           un-signing one.</p>
        <p><strong>Load the caseload</strong> lays down twelve invented clients with families,
           about thirty matters, quotations, passports, certificates and histories. None of it is
           real. It is deliberately messy — a declined application, a section 61 request, an
           expired police certificate beside a current one, a passport renewed in the middle of an
           application, a gap in a work history — because a caseload where everything goes
           right teaches nobody anything.</p>
        <p><strong>Put it back as it was</strong> deletes everything marked as test data and lays
           the caseload down again, so whatever somebody added while trying things is
           disregarded.</p>
        <p>It can also put itself back on a timer, under <strong>Settings → Practice
           caseload</strong>. On this register that is set to <strong>never</strong> and should
           stay there: the records marked as test data here are ones you marked by hand to
           rehearse with, and a timer would delete them one night without asking.</p>
        <p>A login that can only see the test data is <em>not</em> available, and deliberately.
           Holding somebody inside the test data would mean adding "and only the test data" to
           every question the register asks its database — six hundred of them — and the one
           that got missed would show a real client's file. Somebody learning the register gets
           their own copy of it instead, where there is nothing else to see.</p>
        <h4>The audit log</h4>
        <p>Every action anyone takes: sign-ins and failed attempts, every record created or
           changed, every fee altered, every passport revealed, every document downloaded. Filter
           it by person, by kind of action, or from a date.</p>
        <p>It cannot be edited or deleted by anyone — not through this application, not through
           the Cloudflare console, not through the database API. The database itself refuses.
           That is deliberate: a log that can be quietly corrected is not evidence of
           anything.</p>`,
    },
    {
      id: 'changes',
      title: 'Recent changes',
      body: html`
        ${'' /* The last twenty, not all of them. There are close to two hundred
                 releases and every one of them was being rendered onto this
                 page — twenty-two thousand words of history, on the page
                 somebody opens when they are stuck. "Recent" was doing no work
                 at all. The whole list is in CHANGELOG.md, where a list that
                 long belongs. */}
        <p>You are using version <strong>${APP_VERSION}</strong>.
           The last ${String(Math.min(RECENT_RELEASES, RELEASES.length))} releases:</p>
        ${RELEASES.slice(0, RECENT_RELEASES).map((release) => html`
          <h4>${release.version} — ${release.date}</h4>
          <ul>${release.notes.map((note) => html`<li>${note}</li>`)}</ul>`)}
        <p class="hint">There have been ${String(RELEASES.length)} releases in all.
           The full list is <code>CHANGELOG.md</code> in the repository.</p>`,
    },
  ];
}

export const helpModule: AppModule = {
  name: 'help',
  title: 'Help',
  basePaths: ['/help'],
  nav: [{ href: '/help', label: 'Help', permission: 'register:read', order: 5, corner: true }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', async (c) => {
      const all = sections(new URL(c.req.url).origin);
      const byId = new Map(all.map((x) => [x.id, x]));

      // Which group is on screen. An unknown or absent one falls to the first
      // rather than to nothing: a help page that opens empty because of a stale
      // link is the worst version of this page there is.
      const askedGroup = c.req.query('g') ?? '';
      const group = GROUPS.find((g) => g.id === askedGroup) ?? GROUPS[0]!;

      // One section opened by name, so a link from elsewhere in the register
      // still lands on the answer. `/help?s=connecting` opens that section, on
      // whichever tab it lives.
      const asked = c.req.query('s') ?? '';
      const opened = byId.has(asked) ? asked : '';
      const openedGroup = opened
        ? GROUPS.find((g) => g.sections.includes(opened)) ?? group
        : group;

      const showing = openedGroup.sections
        .map((id) => byId.get(id)).filter((x): x is Section => Boolean(x));

      return page(c, { title: 'Help', active: '/help' }, html`
        ${pageHeader('How to use the register')}

        <nav class="tabs">
          ${GROUPS.map((g) => html`
            <a class="${g.id === openedGroup.id ? 'tab current' : 'tab'}"
               href="/help?g=${raw(g.id)}">${g.label}</a>`)}
        </nav>

        ${'' /* Each section is a heading you open. Closed unless it is the one a
                 link asked for, so a tab is a short list of questions rather
                 than the wall of prose this page used to be. */}
        ${showing.map((section) => html`
          <section class="card" id="${section.id}">
            <details class="card-fold" ${section.id === opened || showing.length === 1
              ? raw('open') : ''}>
              <summary class="card-head"><h2>${section.title}</h2></summary>
              <div class="card-body manual">${section.body}</div>
            </details>
          </section>`)}

        ${card('Still stuck?', html`
          <p>If something looks wrong rather than merely confusing, note what you were doing and
             the reference number on any error page — it identifies the exact request in the
             log.</p>`)}`);
    });

    app.route('/help', r);
  },
};
