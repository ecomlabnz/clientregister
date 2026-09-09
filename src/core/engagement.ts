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
      default: 'Immigration Legal Services (Direct Access)',
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
        + 'separate paragraphs. Nothing is supplied: this is your wording, not the register’s.' },

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
      help: 'One person per line, as Name | Short name | Mobile | Email — for example '
        + '“Ms A B Example | Ann | +64 21 000 0000 | ann@example.com”. The short name is what '
        + 'appears in brackets beside their number; leave it out if you would rather it did not. '
        + 'Only the name is required. Leave the whole box empty and the section is not printed.' },
    { key: 'engagement.admin_team_also', type: 'string', maxLength: 300,
      label: 'And anyone else', default: 'or any other person nominated by them',
      help: 'Printed as the last item of the list. Leave blank to name only the people above.' },

    { key: 'engagement.acknowledgements', type: 'text', label: 'What the client confirms',
      maxLength: 4000, default: '',
      help: 'One per line. Printed as a numbered list above the signature, introduced by the line '
        + 'below. Leave blank to print no list at all.' },
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

/** One of the practice's administrative contacts, as the letter names them. */
export interface AdminContact {
  name: string;
  /** What appears in brackets beside their number. Optional. */
  short: string;
  mobile: string;
  email: string;
}

/**
 * The people on one line of the setting.
 *
 * `Name | Short | Mobile | Email`, and only the name is required — a practice
 * that lists a person with no mobile should get their name printed, not a
 * dangling "Mobile:" with nothing after it. Extra fields past the fourth are
 * ignored rather than run together into the email, because a stray pipe in
 * somebody's title should not put rubbish on a contract.
 */
export function parseAdminTeam(raw: string): AdminContact[] {
  return raw.split('\n')
    .map((line) => line.split('|').map((part) => part.trim()))
    .filter((parts) => (parts[0] ?? '') !== '')
    .map((parts) => ({
      name: parts[0]!, short: parts[1] ?? '', mobile: parts[2] ?? '', email: parts[3] ?? '',
    }));
}

export interface EngagementText {
  subject: string;
  opening: string;
  termsTitle: string;
  termsSubtitle: string;
  scopeHeading: string;
  scopeTerms: string;
  adminTeamHeading: string;
  adminTeamIntro: string;
  adminTeam: AdminContact[];
  adminTeamAlso: string;
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
    adminTeamHeading: (v['engagement.admin_team_heading'] ?? '').trim(),
    adminTeamIntro: (v['engagement.admin_team_intro'] ?? '').trim(),
    adminTeam: parseAdminTeam(v['engagement.admin_team'] ?? ''),
    adminTeamAlso: (v['engagement.admin_team_also'] ?? '').trim(),
    // One per line, blanks dropped — a stray empty line in a settings box would
    // otherwise print as an empty numbered item in a contract.
    acknowledgements: (v['engagement.acknowledgements'] ?? '')
      .split('\n').map((line) => line.trim()).filter(Boolean),
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
