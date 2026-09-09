/**
 * The letter of engagement: the words that are the same every time.
 *
 * The practice settled the shape of this on 8 September 2026, and the decision
 * is what makes the rest small: **the letter states no parties, no scope and no
 * fees.** Those belong to the quotation, which is attached to it and which the
 * letter refers to. Their own letter restated all three, and restating a fee
 * schedule in a covering letter is how a document ends up disagreeing with its
 * own attachment.
 *
 * What is left divides in two, and the division is not cosmetic — it is the
 * difference between a fixed set of things and a list:
 *
 *  - **The frame**, here as settings: how the letter opens, what the client
 *    warrants when they accept, and how it signs off. Every letter has exactly
 *    one of each, so they are settings with names.
 *
 *  - **The body**, in `engagement_clauses`: fees and disbursements, trust
 *    money, termination, no guarantee of outcome, and whatever else this
 *    practice puts in. A variable number of headed sections, ordered, some of
 *    them only for certain kinds of matter — a list, so a table.
 *
 * ## Nothing is seeded
 *
 * The register ships no default wording for any of it. Not an oversight: this
 * is a contract between a lawyer and a client, and a letter that went out
 * carrying wording the register invented would be worse than a letter that went
 * out empty — the empty one is obvious. The practice types their own, once, and
 * edits it without a deployment thereafter.
 */

import type { Env } from '../types';
import { all } from './db';
import { readSettings, type SettingsGroup } from './settings';

export const ENGAGEMENT_SETTINGS: SettingsGroup = {
  id: 'engagement',
  title: 'Letter of engagement',
  description:
    'The words every letter of engagement says. The parties, the work and the fees are not here '
    + '— they are on the quotation the letter goes out with, and the letter refers to it rather '
    + 'than repeating it. The clauses in the middle of the letter are edited separately, under '
    + 'Quotes → Letter clauses, because there can be any number of them and some belong only on '
    + 'certain kinds of matter.',
  order: 36,
  settings: [
    { key: 'engagement.subject', type: 'string', label: 'Subject line', maxLength: 200,
      default: 'Letter of Engagement for Legal Services',
      help: 'Printed as the RE: line under the client’s address.' },
    { key: 'engagement.opening', type: 'text', label: 'How the letter opens', maxLength: 4000,
      default: '',
      help: 'The paragraphs before the clauses — that you are pleased to act, who has overall '
        + 'responsibility for the matter, who the client deals with day to day, and how they '
        + 'accept. Blank lines separate paragraphs. Nothing is supplied: this is your wording, '
        + 'not the register’s.' },
    // --- Where the covering letter ends and the terms begin ----------------
    //
    // **Asked for on 9 September 2026**, with a line drawn across a screenshot:
    // everything above it is the covering letter, everything below is the
    // practice's short-form terms. Two documents on one page, and until now
    // nothing said where one stopped.
    //
    // It matters beyond tidiness. The letter points at a *second* document —
    // the Standard Terms of Engagement, published at a web address — and a
    // client who cannot see that the page they are reading is itself a set of
    // terms has no way to tell the two apart.
    { key: 'engagement.terms_title', type: 'string', maxLength: 200,
      label: 'The terms, as they are headed',
      default: 'Short Form Terms of Engagement',
      help: 'Printed across the page where the covering letter ends and the terms begin. '
        + 'Leave blank and no dividing heading is printed.' },
    { key: 'engagement.terms_subtitle', type: 'string', maxLength: 200,
      label: 'And under that heading',
      default: 'Immigration Legal Services',
      help: 'Ignored when the heading above is blank.' },

    // --- The scope of the retainer -----------------------------------------
    //
    // Its own section under the quotation block, by the practice's choice of
    // 9 September 2026, rather than inside it: the block states where the work
    // is written down, and this states the limits of it.
    //
    // **The default is deliberately empty.** This is the paragraph that tells a
    // client what their lawyer will and will not do, and the register does not
    // write that for anybody — the same reason the opening and the closing ship
    // blank. The practice pasted their own in.
    { key: 'engagement.scope_heading', type: 'string', maxLength: 200,
      label: 'Scope of the retainer — heading',
      default: 'Scope of the Retainer',
      help: 'Ignored when there is no wording below.' },
    { key: 'engagement.scope_terms', type: 'text', maxLength: 4000,
      label: 'Scope of the retainer — the wording', default: '',
      help: 'Printed immediately under the block that points at the quotation. Blank lines '
        + 'separate paragraphs; **two asterisks** around a phrase print it in bold. Nothing is '
        + 'supplied: this is your wording, not the register’s.' },

    // --- What the Law Society requires a client to be told -----------------
    //
    // **Asked on 9 September 2026:** *"where do we attach this to?"*, with the
    // Rules of Conduct and Client Care information — fees, the Fidelity Fund,
    // who is responsible, complaints, client care and service, limitations on
    // liability.
    //
    // Nowhere, was the answer. The letter ended at the signature, and this is
    // an addendum: it comes after the letter rather than inside it, because it
    // is not the practice speaking to this client about this matter, it is the
    // information every client of any New Zealand lawyer must be given.
    //
    // So it is its own section after the signature and it starts a new page
    // when printed, which is what an addendum does and also keeps the signature
    // on the page with the letter it signs.
    //
    // Empty by default, like every other set of words a client is asked to
    // accept. The wording is prescribed by somebody other than this register.
    { key: 'engagement.addendum_heading', type: 'string', maxLength: 200,
      label: 'Addendum — heading',
      default: 'Addendum 1 — Information for Clients',
      help: 'Ignored when there is no wording below.' },
    { key: 'engagement.addendum', type: 'text', maxLength: 12000,
      label: 'Addendum — the wording', default: '',
      help: 'Printed after the signature, starting a new page. For the information the Rules of '
        + 'Conduct and Client Care require a client to be given. Blank lines separate paragraphs; '
        + 'a line beginning “- ” prints as a bullet; **two asterisks** around a phrase print it '
        + 'in bold.' },

    // --- The administrative team ------------------------------------------
    //
    // **Asked for on 9 September 2026.** The practice's letter says that
    // day-to-day contact is with an administrative team whose role is limited
    // to support — that they give no legal advice, exercise no professional
    // judgement and do not represent the client. A paragraph saying so names
    // people, and the people change while the paragraph does not.
    //
    // So the paragraph is the practice's wording, edited as a clause, and the
    // people are these settings. Nobody's name reaches this repository; the
    // register holds them, which is also what makes them per-practice for free
    // the day a second practice has a database of its own.
    //
    // Not on the quotation, by the same instruction: the quotation is the work
    // and the fees, and who answers the telephone is a term of the engagement.
    { key: 'engagement.admin_team_heading', type: 'string', maxLength: 200,
      label: 'Administrative team — heading',
      default: 'Day-to-Day Administrative Team Contact',
      help: 'The heading of the section. Ignored when no people are listed below.' },
    { key: 'engagement.admin_team_intro', type: 'string', maxLength: 400,
      label: 'The line that introduces them',
      default: 'The designated administrative (non-legal) contacts for this engagement are:',
      help: 'Printed above the list.' },
    { key: 'engagement.admin_team', type: 'text', maxLength: 2000,
      label: 'Who they are', default: '',
      help: 'One person per line, written however you would write it — a name on its own, or a '
        + 'name with a mobile and an email after it. Each line is printed on the letter exactly '
        + 'as you type it here. Leave the box empty and the section is not printed.' },
    { key: 'engagement.admin_team_also', type: 'string', maxLength: 300,
      label: 'And anyone else', default: 'or any other person nominated by them',
      help: 'Printed as the last item of the list. Leave blank to name only the people above.' },

    // 10,000 at the practice's request of 9 September 2026, urgently: their own
    // list of confirmations had outgrown 4,000 and the box was refusing the
    // rest. It is one item per line and the practice keeps adding items, so the
    // cap is the thing that has to move rather than the list that has to be cut.
    { key: 'engagement.acknowledgements', type: 'text', label: 'What the client confirms',
      maxLength: 10000, default: '',
      help: 'One per line, printed as a numbered list above the signature. Numbering you paste in '
        + '(“1.”, “2)”, a bullet) is taken off, so the list is not numbered twice. Put **two '
        + 'asterisks** around a phrase to print it in bold. Leave blank to print no list at all.' },
    { key: 'engagement.acknowledgements_heading', type: 'string', maxLength: 200,
      label: 'What the client confirms — heading',
      default: 'What you confirm by accepting',
      help: 'The heading above the numbered list. Ignored when the list is empty.' },
    { key: 'engagement.acknowledgements_intro', type: 'string', maxLength: 300,
      label: 'The line that introduces that list',
      default: 'By accepting these terms, the client confirms that they:',
      help: 'Ignored when the list above is empty.' },
    { key: 'engagement.closing', type: 'text', label: 'How the letter closes', maxLength: 2000,
      default: '',
      help: 'The paragraphs after the clauses and before the signature.' },
    { key: 'engagement.signature_name', type: 'string', label: 'Signed by', maxLength: 200,
      default: '',
      help: 'Left blank, the practice’s own name from Practice details is used.' },
    { key: 'engagement.signature_title', type: 'string', label: 'Under that name', maxLength: 200,
      default: '',
      help: 'For example Barrister, or Licensed Immigration Adviser.' },
  ],
};

/**
 * The administrative contacts, one to a line, exactly as the practice wrote them.
 *
 * **This was cleverer twice and wrong twice**, on 9 September 2026, the day it
 * shipped. First it read four fields by position — `Name | Short | Mobile |
 * Email` — and a line typed the natural way lost both email addresses off a
 * client's letter. Then it read the same line by *recognising* what each part
 * was, which rescued the addresses and printed them gathered onto their own
 * "Mobile:" and "Email:" lines at the foot of the section. The practice looked
 * at that and said the print must appear the same way as the box they typed it
 * into.
 *
 * They are right, and the second version was the same mistake as the first with
 * more machinery: the register was taking a sentence apart in order to put it
 * back together differently from how somebody wrote it. There is nothing here
 * it needs the pieces for — the letter prints the list and nothing else reads
 * it — so it does not take it apart at all.
 *
 * One non-empty line per person, printed verbatim. Whatever the practice writes
 * about how to reach somebody is between them and their client.
 */
export function parseAdminTeam(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean);
}

export interface EngagementText {
  subject: string;
  opening: string;
  termsTitle: string;
  termsSubtitle: string;
  scopeHeading: string;
  scopeTerms: string;
  addendumHeading: string;
  addendum: string;
  adminTeamHeading: string;
  adminTeamIntro: string;
  adminTeam: string[];
  adminTeamAlso: string;
  acknowledgementsHeading: string;
  acknowledgements: string[];
  acknowledgementsIntro: string;
  closing: string;
  signatureName: string;
  signatureTitle: string;
  /** True when there is enough here to print a letter worth sending. */
  configured: boolean;
}

export async function engagementText(env: Env): Promise<EngagementText> {
  const v = await readSettings(env, ENGAGEMENT_SETTINGS.settings);
  const opening = (v['engagement.opening'] ?? '').trim();
  return {
    subject: (v['engagement.subject'] ?? '').trim(),
    opening,
    termsTitle: (v['engagement.terms_title'] ?? '').trim(),
    termsSubtitle: (v['engagement.terms_subtitle'] ?? '').trim(),
    scopeHeading: (v['engagement.scope_heading'] ?? '').trim(),
    scopeTerms: (v['engagement.scope_terms'] ?? '').trim(),
    addendumHeading: (v['engagement.addendum_heading'] ?? '').trim(),
    addendum: (v['engagement.addendum'] ?? '').trim(),
    adminTeamHeading: (v['engagement.admin_team_heading'] ?? '').trim(),
    adminTeamIntro: (v['engagement.admin_team_intro'] ?? '').trim(),
    adminTeam: parseAdminTeam(v['engagement.admin_team'] ?? ''),
    adminTeamAlso: (v['engagement.admin_team_also'] ?? '').trim(),
    // One per line, blanks dropped — a stray empty line in a settings box would
    // otherwise print as an empty numbered item in a contract.
    acknowledgementsHeading: (v['engagement.acknowledgements_heading'] ?? '').trim(),
    // **Any numbering the practice typed is taken off**, because the list is
    // printed as a numbered list and two sets of numbers is worse than either.
    // Asked for on 9 September 2026 with a list of twenty-five items pasted
    // from a document where they were already numbered — and one of them
    // carried a stray bullet in front of its number, which is what pasting from
    // a word processor does. A line that is *only* a number is dropped rather
    // than printed empty.
    acknowledgements: (v['engagement.acknowledgements'] ?? '')
      .split('\n')
      .map((line) => line.trim().replace(/^[•\-*\u2022]?\s*\d+\s*[.)]\s*/, '').trim())
      .filter(Boolean),
    acknowledgementsIntro: (v['engagement.acknowledgements_intro'] ?? '').trim(),
    closing: (v['engagement.closing'] ?? '').trim(),
    signatureName: (v['engagement.signature_name'] ?? '').trim(),
    signatureTitle: (v['engagement.signature_title'] ?? '').trim(),
    // The opening is the test rather than all of it: a letter with an opening
    // and clauses is a letter, and the rest is the practice's choice. A letter
    // with no opening at all is an empty page with a signature on it.
    configured: opening.length > 0,
  };
}

export interface ClauseRow {
  id: string;
  position: number;
  heading: string;
  body: string;
  case_types: string;
  active: number;
}

/** Every clause, including the switched-off ones, for the page that edits them. */
export async function allClauses(env: Env): Promise<ClauseRow[]> {
  return all<ClauseRow>(
    env.DB, 'SELECT * FROM engagement_clauses ORDER BY position, created_at');
}

/** The keys a clause names, as a list. Empty means every matter. */
export function clauseTypes(clause: Pick<ClauseRow, 'case_types'>): string[] {
  return clause.case_types.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
}

/**
 * The clauses that belong on one letter.
 *
 * A quotation can cover more than one matter, so this takes every case type the
 * quotation touches and includes a clause named by any of them. The alternative
 * — only clauses matching every type — would silently drop the partnership
 * assessment page from a quotation that covered a partner visa *and* a
 * dependent child, which is exactly the letter that most needs it.
 *
 * A clause naming no type at all is on every letter.
 */
export async function clausesFor(env: Env, caseTypes: string[]): Promise<ClauseRow[]> {
  const wanted = new Set(caseTypes.filter(Boolean));
  const rows = await all<ClauseRow>(
    env.DB,
    'SELECT * FROM engagement_clauses WHERE active = 1 ORDER BY position, created_at');
  return rows.filter((clause) => {
    const types = clauseTypes(clause);
    return types.length === 0 || types.some((t) => wanted.has(t));
  });
}
