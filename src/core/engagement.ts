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

export interface EngagementText {
  subject: string;
  opening: string;
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
