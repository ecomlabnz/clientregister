/**
 * Module: quotes.
 *
 * What was quoted, to whom, when, and what came of it. A quote is a proposal;
 * once accepted it can be pushed into the case's fee lines in one action so the
 * money is recorded exactly once.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { everyTermClausePlain } from '../../core/search';
import { all, count, getSetting, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { emphasise, html, join, raw, type Raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, stamp, statusTone, table,
  testDataBand,
} from '../../ui/components';
import { dateInputValue, dateLong, dateShort, money, printedAt } from '../../ui/format';
import {
  QUOTE_PARTY_KIND_LABELS, QUOTE_PARTY_KINDS, QUOTE_PARTY_ROLE_LABELS, QUOTE_PARTY_ROLES,
  QUOTE_STATUS_LABELS, QUOTE_STATUSES,
  type QuotePartyKind, type QuotePartyRole, type QuoteStatus,
} from '../../domain';
import { clientOptions, openCaseOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';
import { applyTemplate, saveTemplateFrom } from '../../core/quotetemplate';
import {
  computeGst, FEE_KIND_LABELS, FEE_KINDS, GST_TREATMENT_LABELS, GST_TREATMENTS,
  type FeeKind, type GstTreatment,
  moneySettings,
} from '../../core/money';
import {
  computeLine, formatQuantity, parseQuantityToMilli, pluraliseUnit, summariseQuote, validUntil,
  type QuoteTotals,
} from '../../core/quotes';
import { asInteger, readSettings, type SettingsGroup } from '../../core/settings';

import { caseTypes, labelFor, type Term } from '../../core/vocabulary';
import { quoteNameFrom } from '../../core/casename';
import { practiceDetails } from '../../core/practice';
import { shareTokenFor, shareUrl } from '../../core/quotelink';
import { fallbackWarning, publicBase } from '../../core/publicurl';
import { fillTemplate, tidyBlankLines, unknownPlaceholders } from '../../core/template';
import {
  ENGAGEMENT_SETTINGS, allClauses, clauseTypes, clausesFor, engagementText, type ClauseRow,
} from '../../core/engagement';
import { invoiceFromQuote } from '../../core/invoices';
import { renderEmailHtml, renderRichText, toPlainText } from '../../core/richtext';
import { mailConfigured } from '../../mail/provider';
import { flushQueue, queueEmail } from '../../mail/queue';
import { emailsForEntity, mailLinkFor, recordMailHref, sendState } from '../../mail/stored';
import { quoteRecipients, unrecognisedRecipients } from '../../mail/recipients';

/**
 * **A paragraph is one line, however long.**
 *
 * This letter was wrapped at about seventy-six characters, the way a plain-text
 * letter is typed. Two things went wrong with that, both reported on
 * 11 September 2026 with the formatted email in front of the practice:
 * *"the HTML format - this is how it is breaking down - incorrectly"*.
 *
 * 1. A newline inside a paragraph becomes a line break in the formatted email,
 *    so the client read "for the / proposed work." — the plain-text wrapping,
 *    baked into a medium that does its own wrapping at the reader's own window
 *    width.
 * 2. Emphasis cannot span a line break, by the deliberate design of
 *    `core/richtext.ts` (a marker that could run away over several lines would
 *    swallow half a letter when somebody forgot to close it). So
 *    `**acceptance ... successful**`, wrapped across two lines, printed its own
 *    asterisks.
 *
 * Both go away by not wrapping. A plain-text mail client wraps a long line to
 * the reader's window, which is better than wrapping it here to a width nobody
 * chose; and the blank lines between paragraphs are what carry the shape.
 *
 * So: **never hard-wrap a paragraph in this letter, or in anything filling a
 * placeholder in it.** Blank lines between paragraphs, and a line break only
 * where one is meant — an address, a signature.
 */
const DEFAULT_EMAIL_BODY = [
  'Dear {client_name},',
  '',
  'Thank you for your enquiry and for discussing your matter with us.',
  '',
  'As discussed, I am pleased to provide you with our **fee quotation{and_letter}** for the proposed work.',
  '',
  '{total}',
  '',
  '{link_block}',
  '',
  '{terms}',
  '',
  'Please note that **acceptance of the quotation does not constitute a guarantee that any visa, immigration application or other outcome will be successful**. Immigration decisions are made by Immigration New Zealand in accordance with the applicable legislation, immigration instructions and its decision-making powers.',
  '',
  '{closing_date} {capacity}',
  '',
  '{how_to_accept}',
  '',
  'If you have any questions about the quotation, scope of work or terms of engagement, please contact us before accepting it. We will be happy to clarify any aspect of the proposed engagement.',
  '',
  'Kind regards,',
  '{signature}',
].join('\n');

export const QUOTE_SETTINGS: SettingsGroup = {
  id: 'quotes',
  title: 'Quotes',
  description: 'How quotes are put together and how long they stand.',
  order: 35,
  settings: [
    { key: 'quotes.email_subject', type: 'string', maxLength: 200,
      label: 'Subject line of the quotation email',
      default: 'Fee quote {quote_ref} \u2014 {matter}',
      help: 'Placeholders in braces are filled in: {quote_ref}, {matter}, {client_name}, '
        + '{practice_name}. Anything else in braces prints as you typed it, so a misspelling '
        + 'shows up on the preview screen rather than reaching the client.' },
    { key: 'quotes.email_body', type: 'text', maxLength: 20000,
      label: 'The quotation email',
      default: DEFAULT_EMAIL_BODY,
      help: 'The covering letter sent with every quotation. Placeholders in braces are filled '
        + 'in from the quotation \u2014 {client_name}, {total}, {link_block}, {terms}, '
        + '{closing_date}, {capacity}, {how_to_accept}, {signature} and others; the Email page '
        + 'lists them all. You still see and can edit every letter before it goes, and the '
        + 'Preview screen shows exactly what the client will read.' },
    { key: 'quotes.validity_days', type: 'integer', label: 'A quote stands for (days)', default: '7',
      min: 1, max: 365,
      help: 'Counted inclusive of the day it is issued — issued on the 28th, seven days means it is good through the 3rd. The quote shows the date, never a number of days, so the client does not have to work it out.' },
    { key: 'quotes.capacity_note', type: 'text', label: 'Capacity wording', maxLength: 400,
      default: 'This quote is subject to our capacity to accept the work at the time you accept it.',
      help: 'Printed on every quote beneath the total. Leave blank to omit it.' },
    { key: 'quotes.payment_terms', type: 'text', label: 'Payment wording', maxLength: 400,
      default: 'Fees are payable in advance into the practice trust account. Disbursements are payable as they fall due.',
      help: 'Printed on every quote. Leave blank to omit it.' },
    { key: 'quotes.default_unit_label', type: 'string', label: 'Default unit', default: 'item', maxLength: 30,
      help: 'What one of something is called when a line does not say otherwise.' },

    // --- The shape every quotation starts from -----------------------------
    //
    // Written by the "Use as the template" button on a quotation rather than
    // typed, and editable here afterwards. See `core/quotetemplate.ts` for why
    // the amounts are deliberately not part of it.
    { key: 'quotes.template_lines', type: 'text', maxLength: 4000, default: '',
      label: 'New quotations start with these lines',
      help: 'One per line, as kind | Description | GST — for example '
        + '“professional | Professional time | exclusive” or '
        + '“disbursement | INZ application fee | inclusive”. Kind is professional, disbursement '
        + 'or third_party. Every line arrives with no amount. Easiest set by opening a quotation '
        + 'you are happy with and pressing “Use as the template”.' },
    { key: 'quotes.template_stages', type: 'text', maxLength: 4000, default: '',
      label: 'And these payment stages',
      help: 'One per line, as Label | What it is for and when it falls due | GST. Every stage '
        + 'arrives with no amount. Leave both boxes empty and new quotations start blank, as '
        + 'they always did.' },
  ],
};

export interface QuoteSettings {
  validityDays: number;
  capacityNote: string;
  paymentTerms: string;
  defaultUnitLabel: string;
  /** The covering letter and its subject, as the practice wrote them. */
  emailSubject: string;
  emailBody: string;
}

export async function quoteSettings(env: Env): Promise<QuoteSettings> {
  const values = await readSettings(env, QUOTE_SETTINGS.settings);
  return {
    validityDays: asInteger(values['quotes.validity_days'], 7),
    capacityNote: values['quotes.capacity_note'] ?? '',
    paymentTerms: values['quotes.payment_terms'] ?? '',
    defaultUnitLabel: values['quotes.default_unit_label'] || 'item',
    // `||` rather than `??`: a practice that empties the box wants the letter
    // back, not an empty email. There is no way to send nothing on purpose.
    emailSubject: values['quotes.email_subject'] || 'Fee quote {quote_ref} \u2014 {matter}',
    emailBody: values['quotes.email_body'] || DEFAULT_EMAIL_BODY,
  };
}

export interface ServiceItemRow {
  id: string; name: string; description: string | null; kind: FeeKind;
  unit_label: string; unit_amount_cents: number; gst_treatment: GstTreatment;
  active: number; sort_order: number;
}

export interface QuoteItemRow {
  id: string; quote_id: string; position: number; service_item_id: string | null;
  /** The kind of work, as the vocabulary's own key. See migration 0074. */
  case_type: string | null;
  description: string; kind: FeeKind; unit_label: string; quantity_milli: number;
  unit_amount_cents: number; gst_treatment: GstTreatment; gst_rate_bp: number;
  net_cents: number; gst_cents: number; gross_cents: number;
}

export async function quoteLines(env: Env, quoteId: string): Promise<QuoteItemRow[]> {
  return all<QuoteItemRow>(
    env.DB,
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, created_at',
    quoteId,
  );
}

export interface QuoteStageRow {
  id: string; quote_id: string; position: number; label: string; description: string;
  amount_cents: number; gst_treatment: GstTreatment; gst_rate_bp: number;
  net_cents: number; gst_cents: number; gross_cents: number;
}

export async function quoteStages(env: Env, quoteId: string): Promise<QuoteStageRow[]> {
  return all<QuoteStageRow>(
    env.DB, 'SELECT * FROM quote_stages WHERE quote_id = ? ORDER BY position, created_at', quoteId);
}

export interface QuotePartyRow {
  id: string; quote_id: string; position: number;
  role: QuotePartyRole; kind: QuotePartyKind;
  full_name: string; relationship: string | null; date_of_birth: string | null;
  organisation: string | null; email: string | null; phone: string | null;
  client_id: string | null; is_representative: number;
}

/**
 * Everybody named on the engagement, in the order the letter reads them.
 *
 * Ordered by role first — applicants, then associated parties, then the
 * administrative contacts — because that is the order the letter puts them in
 * and a document whose sections shuffle between drafts is a document nobody
 * trusts. `position` orders within a role, so the practice can say which
 * applicant is first.
 */
export async function quoteParties(env: Env, quoteId: string): Promise<QuotePartyRow[]> {
  return all<QuotePartyRow>(
    env.DB,
    `SELECT * FROM quote_parties WHERE quote_id = ?
      ORDER BY CASE role WHEN 'applicant' THEN 0 WHEN 'associated' THEN 1 ELSE 2 END,
               position, created_at`,
    quoteId);
}

export async function catalogue(env: Env, includeRetired = false): Promise<ServiceItemRow[]> {
  return all<ServiceItemRow>(
    env.DB,
    `SELECT * FROM service_items ${includeRetired ? '' : 'WHERE active = 1'}
      ORDER BY sort_order, name`,
  );
}

/**
 * The unit a line is priced in, which may be nothing at all.
 *
 * **Reported on 9 September 2026:** *"for some reason cannot remove 'item' word
 * even if i edit it"*. Quite right, and it could not be removed by anybody:
 * both routes that write the column ended in `|| defaultUnitLabel`, so an empty
 * box was indistinguishable from an absent one and became "item" again on the
 * way to the database. Clearing the field and saving looked exactly like not
 * having tried.
 *
 * The distinction is between a field that is **absent** — a form that does not
 * carry it, where the practice's default is the right answer — and a field that
 * is **present and empty**, which is somebody saying they do not want one. Only
 * the first falls back.
 *
 * An empty unit prints as nothing: `pluraliseUnit` already returns the empty
 * string for it, so a line reads "1" rather than "1 item".
 */
export function unitFrom(submitted: unknown, fallback: string): string {
  if (submitted === null || submitted === undefined) return fallback;
  return String(submitted).trim().slice(0, 30);
}

/**
 * Recalculate the header figures from the lines.
 *
 * `quotes.amount_cents`, `gst_cents` and `disbursements_cents` remain the
 * columns every list, dashboard and conversion-to-fees already reads. Rather
 * than change all of that, the lines are the truth and these are kept in step
 * with them after every edit — one place that writes them, so they cannot
 * disagree with the itemisation a client was sent.
 */
export async function refreshQuoteTotals(env: Env, quoteId: string): Promise<QuoteTotals> {
  const lines = await quoteLines(env, quoteId);
  const totals = summariseQuote(lines.map((l) => ({
    kind: l.kind, lineAmountCents: l.unit_amount_cents, netCents: l.net_cents,
    gstCents: l.gst_cents, grossCents: l.gross_cents,
  })));
  await run(
    env.DB,
    `UPDATE quotes SET amount_cents = ?, gst_cents = ?, disbursements_cents = ?, updated_at = ? WHERE id = ?`,
    totals.feesNetCents, totals.gstCents, totals.disbursementsNetCents, nowIso(), quoteId,
  );
  return totals;
}

export interface QuoteRow {
  /**
   * 1 when this is test data — a record the practice is only trying things
   * with, which Admin → Test data will delete. See migration 0083.
   */
  is_test: number;

  id: string; ref: string; client_id: string | null; case_id: string | null; inquiry_id: string | null;
  /** The kind of work, since 0075. What the letter chooses its clauses from. */
  case_type: string | null;
  description: string; amount_cents: number; gst_cents: number; disbursements_cents: number;
  currency: string; status: QuoteStatus; valid_until: string | null; sent_at: string | null;
  responded_at: string | null; notes: string | null; created_at: string; updated_at: string;
  issued_on: string | null; validity_days: number | null; stage_note: string | null;
  /** 1, 0, or null when nobody has yet decided. See migration 0067. */
  with_letter: number | null;
  /** The client's private link, minted when the quotation is emailed. See 0078. */
  share_token: string | null;
  /** Set together, once, and never again. See 0078. */
  accepted_at: string | null;
  accepted_name: string | null;
  accepted_from: string | null;
}

function quoteTotal(q: Pick<QuoteRow, 'amount_cents' | 'gst_cents' | 'disbursements_cents'>): number {
  return q.amount_cents + q.gst_cents + q.disbursements_cents;
}

/**
 * The columns of the fee lines on a quotation, on screen.
 *
 * **Named once because the totals beneath them are derived from it.** Amount
 * moved to the right of GST on 9 September 2026 and the totals stayed where
 * they were, so every figure in the totals block printed one column to the left
 * of the figures it was totalling — under GST. Reported the same day: *"you
 * swapped the columns but left the totals under gst - not acceptable."*
 *
 * Two facts had to agree and each was written down separately, which is the
 * arrangement that guarantees they will eventually disagree. Now there is one:
 * move a column here and the totals move with it.
 */
const ITEM_COLUMNS = ['Description', 'Qty', 'Unit', 'GST', 'Amount', ''] as const;

/**
 * How wide each of those columns is, as a share of the table.
 *
 * **Reported on 9 September 2026:** *"the money figures move from one quote to
 * another — slightly — why? They must be fixed, but the columns must be
 * flexible when changing the width of the window."*
 *
 * Because the columns were sized by their contents. A quotation whose largest
 * figure is $598.00 gives its money columns less room than one whose largest is
 * $7,000.00, so the same column lands in a different place on every quotation —
 * and the practice reads them side by side.
 *
 * Shares rather than pixels, which is what makes both halves of the instruction
 * true at once: the columns hold the same *proportions* on every quotation, and
 * they still give and take as the window changes. Description takes whatever is
 * left, because it is the one column whose content genuinely varies.
 */
const ITEM_WIDTHS: Record<string, string | undefined> = {
  Qty: '7', Unit: '14', GST: '14', Amount: '16', '': '6',
};

/** Where the figures live, and how far the label beside them may reach. */
/** The columns whose figures are right-aligned, and whose headings must be too. */
const ITEM_NUMERIC = new Set<string>(['Qty', 'Unit', 'GST', 'Amount']);

const AMOUNT_COLUMN = ITEM_COLUMNS.indexOf('Amount');
const COLUMNS_AFTER_AMOUNT = ITEM_COLUMNS.length - AMOUNT_COLUMN - 1;

/**
 * The totals under a quotation's fee lines, each figure under Amount.
 *
 * A row is dropped rather than printed as nil when it does not apply — there is
 * no Disbursements line on a quotation with no disbursements, and no GST line
 * on a practice that is not registered.
 */
function totalRows(
  rows: Array<[label: string, cents: number, shown: boolean]>, currency: string,
): Raw[] {
  return rows.filter(([, , shown]) => shown).map(([label, cents]) => html`
    <tr class="totals-row">
      <td colspan="${String(AMOUNT_COLUMN)}">${label}</td>
      <td class="num strong">${money(cents, currency)}</td>
      ${COLUMNS_AFTER_AMOUNT > 0
        ? html`<td colspan="${String(COLUMNS_AFTER_AMOUNT)}"></td>` : ''}
    </tr>`);
}

/**
 * A first draft of the covering email, for editing rather than sending as-is.
 *
 * **The practice's own letter, given on 9 September 2026**, with the figures,
 * the dates and the address filled in: *"use this as a template for the emails
 * to the clients... adapt it but I like the contents so keep them as much as
 * possible."* So the words are theirs and this file's job is to be careful
 * about the handful of places where a sentence of theirs would be untrue of a
 * particular quotation:
 *
 * - **"and Letter of Engagement"** comes out when the quotation is going
 *   without one. Promising a document that is not there is worse than a
 *   shorter sentence.
 * - **"inclusive of GST"** comes out when the practice is not GST registered,
 *   and **"and the disbursements specified"** when there are none. Both are
 *   statements about a figure on a contract.
 * - **The capacity sentence** is the practice's `quotes.capacity_note` setting
 *   where they have written one, and their sentence from this letter where they
 *   have not — so the setting stays live rather than being said twice.
 * - **The closing date** is left out entirely if the quotation has none, rather
 *   than printing a sentence with a blank in it.
 *
 * The `**` marks are the practice's, kept as they wrote them: they print as
 * bold when the email is sent formatted, and as asterisks in plain text, which
 * is how emphasis has always been written in a plain-text letter.
 */
/**
 * The facts of one quotation, as the names a template may use.
 *
 * Every value is a finished piece of prose rather than a raw field, because the
 * sentences around them differ by what is true: a quotation with a letter of
 * engagement says "them", one without says "it", and a total is "inclusive of
 * GST and the disbursements specified" only where both are so. Working that out
 * in a template would need conditionals, and a letter is not a program.
 *
 * So the register decides what is true and hands over the words; the practice
 * decides the letter they sit in.
 */
export function quoteEmailValues(
  q: QuoteRow & { client_name: string | null },
  practice: { legalName: string; termsLabel: string; termsUrl: string; contactEmail: string; contactPhone: string; emailSignature: string },
  items: QuoteItemRow[] = [],
  capacityNote = '',
  link = '',
): Record<string, string> {
  const totals = summariseQuote(items.map((l) => ({
    kind: l.kind, lineAmountCents: l.unit_amount_cents,
    netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
  })));

  const withLetter = q.with_letter === 1;
  const andLetter = withLetter ? ' and Letter of Engagement' : '';
  const them = withLetter ? 'them' : 'it';
  const hasDisbursements = items.some((l) => l.kind !== 'professional');

  // What the total is inclusive *of*, said only where it is true.
  const inclusive = [
    totals.hasGst ? 'GST' : '',
    hasDisbursements ? 'the disbursements specified in the quotation' : '',
  ].filter(Boolean).join(' and ');

  const total = items.length
    ? (inclusive
        ? `The total quoted amount is **${money(totals.totalCents, q.currency)}, inclusive of ${inclusive}**.`
        : `The total quoted amount is **${money(totals.totalCents, q.currency)}**.`)
    : '';

  // Not reachable from the compose screen, which mints a link before drafting.
  // Said plainly rather than sending a letter that points nowhere.
  // **Reworded by the practice on 11 September 2026**, who supplied the
  // replacement sentences: the documents are no longer named a second time
  // (the paragraph above has just named them), and the paragraph runs on rather
  // than restating the title in bold.
  const linkBlock = link
    ? [
        `You can review and accept the quotation${andLetter} here:`,
        '',
        link,
        '',
        withLetter
          ? 'Please read the documents carefully before accepting them. Together, these documents'
            + ' set out the proposed scope of our work, the applicable fees, payment arrangements,'
            + ' and the terms on which we would act for you.'
          : `Please read the quotation carefully before accepting ${them}. It sets out the`
            + ' proposed scope of our work, the applicable fees, payment arrangements, and the'
            + ' terms on which we would act for you.',
      ].join('\n')
    : '[This quotation has no link yet. Open it in the register and press Email again '
      + 'so that one is created before sending.]';

  const terms = practice.termsUrl
    ? [
        'This engagement is also subject to our **Standard Terms of Engagement**, which are'
          + ' available here:',
        '',
        practice.termsUrl,
      ].join('\n')
    : '';

  // The closing date and the capacity sentence are one paragraph in the
  // practice's letter and two independent facts. A quotation with no closing
  // date still needs the capacity sentence — the first draft of this dropped it
  // with the date, so a quotation left open indefinitely was also the one that
  // never told the client the engagement could still be declined.
  const closing = q.valid_until
    ? `The quotation is open for acceptance until **${dateLong(q.valid_until)}**.` : '';
  const capacity = capacityNote
    || 'Acceptance is also subject to our **availability and capacity to accept the engagement**'
       + ' at that time.';

  const howToAccept = link
    ? 'If you are happy to proceed, please sign electronically at the end of the quotation page.'
      + ' You will be asked to provide your full name and the date of acceptance.'
    : '';

  // **Asked on 11 September 2026**, seeing the letter for the first time on the
  // preview screen: *"signature should look something like this, in plain text
  // ... where did you take this signature from?"* From here — it was three
  // settings glued together, which is a placeholder, not a signature. A
  // practice's sign-off is a title, a mobile, and usually a confidentiality
  // notice, and none of that can be derived.
  //
  // So it is now Settings → Practice → Email signature, and the three-line
  // version below is only what a practice that has not written one yet gets.
  const signature = practice.emailSignature.trim()
    || [practice.legalName, practice.contactEmail, practice.contactPhone]
         .filter(Boolean).join('\n');

  return {
    client_name: q.client_name ?? 'Sir or Madam',
    quote_ref: q.ref,
    matter: q.description ?? '',
    and_letter: andLetter,
    total,
    link,
    link_block: linkBlock,
    terms,
    closing_date: closing,
    capacity,
    how_to_accept: howToAccept,
    practice_name: practice.legalName,
    practice_email: practice.contactEmail,
    practice_phone: practice.contactPhone,
    signature,
  };
}

/**
 * The letter as the practice wrote it, filled with this quotation's facts.
 *
 * The wording is `quotes.email_body`; this only fills it. Until 11 September
 * 2026 the wording lived in this file, which is why the practice asked *"where
 * do i change my email template"* and the answer was nowhere.
 */
/**
 * One line of a placeholder's value, for the list beside the compose box.
 *
 * Cut at a word rather than mid-date, and said to be cut. It was ending
 * "open for acceptance until **16 September 20", which reads as a wrong date
 * rather than a shortened one.
 */
function shorten(value: string, max = 60): string {
  const plain = toPlainText(value).trim();
  if (plain === '') return '\u2014';
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}\u2026`;
}

export function quoteEmailBody(template: string, values: Record<string, string>): string {
  return tidyBlankLines(fillTemplate(template, values));
}

/**
 * The built-in letter, filled for one quotation.
 *
 * The same words `quotes.email_body` defaults to, so this is what a practice
 * that has never touched the setting sends. It exists as a function because the
 * suite tests the default wording — that a quotation with no letter of
 * engagement says "it" rather than "them", that a total is only "inclusive of
 * GST" where there is GST — and those are properties of the letter the register
 * ships, not of whatever a practice writes afterwards.
 */
export function defaultQuoteEmail(
  q: QuoteRow & { client_name: string | null },
  practice: { legalName: string; termsLabel: string; termsUrl: string; contactEmail: string; contactPhone: string; emailSignature: string },
  items: QuoteItemRow[] = [],
  capacityNote = '',
  link = '',
): string {
  return quoteEmailBody(DEFAULT_EMAIL_BODY, quoteEmailValues(q, practice, items, capacityNote, link));
}

export const quotesModule: AppModule = {
  name: 'quotes',
  title: 'Quotes',
  basePaths: ['/quotes'],
  nav: [{ href: '/quotes', label: 'Quotes', permission: 'register:read', order: 60, group: 'Money' }],
  settings: [QUOTE_SETTINGS, ENGAGEMENT_SETTINGS],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const q0 = (c.req.query('q') ?? '').trim();
      // Four ways of looking at the pipeline. "Live" is the one that matters
      // day to day: what is out and what has been agreed but not yet billed.
      const view = c.req.query('view') ?? 'live';
      const status = c.req.query('status') ?? '';
      const conds: string[] = [];
      const params: unknown[] = [];
      if ((QUOTE_STATUSES as readonly string[]).includes(status)) { conds.push('q.status = ?'); params.push(status); }
      else if (view === 'live') conds.push(`q.status IN ('draft','sent')`);
      else if (view === 'accepted') conds.push(`q.status = 'accepted'`);
      else if (view === 'closed') conds.push(`q.status IN ('declined','expired','withdrawn')`);
      if (q0) {
        // Plain placeholders, like every other condition here — this used ?1
        // while its neighbours used ?, so filtering by status and by text at
        // once made both read the same value.
        const m = everyTermClausePlain(['q.ref', 'q.description', 'cl.full_name'], q0);
        if (m.sql) { conds.push(m.sql); params.push(...m.params); }
      }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await all<QuoteRow & { client_name: string | null; case_ref: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id
           LEFT JOIN cases k ON k.id = q.case_id
           ${whereSql} ORDER BY q.created_at DESC LIMIT 200`,
        ...params,
      );

      const accepted = rows.filter((q) => q.status === 'accepted');
      const outstanding = rows.filter((q) => q.status === 'sent');

      const counts = await one<{ live: number; accepted: number; closed: number; total: number }>(
        c.env.DB,
        `SELECT SUM(status IN ('draft','sent')) AS live,
                SUM(status = 'accepted') AS accepted,
                SUM(status IN ('declined','expired','withdrawn')) AS closed,
                COUNT(*) AS total FROM quotes`,
      );
      const views = [
        { id: 'live', label: 'Live', count: counts?.live ?? 0 },
        { id: 'accepted', label: 'Accepted', count: counts?.accepted ?? 0 },
        { id: 'closed', label: 'Closed', count: counts?.closed ?? 0 },
        { id: 'all', label: 'All', count: counts?.total ?? 0 },
      ];

      return page(c, { title: 'Quotes', active: '/quotes' }, html`
        ${pageHeader('Quotes', undefined,
          can(c.get('user'), 'quote:write') ? html`<a class="btn btn-primary" href="/quotes/new">New quote</a>` : undefined)}
        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Awaiting reply</span><span class="stat-value">${outstanding.length}</span></div>
          <div class="stat"><span class="stat-label">Value out</span><span class="stat-value">${money(outstanding.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
          <div class="stat"><span class="stat-label">Accepted</span><span class="stat-value">${money(accepted.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
        </div>
        <nav class="tabs">
          ${views.map((v) => html`
            <a class="${v.id === view && !status ? 'tab current' : 'tab'}"
               href="/quotes?view=${v.id}">${v.label} <span class="muted">${v.count}</span></a>`)}
        </nav>
        <form method="get" action="/quotes" class="filters" data-live-search>
          <input type="hidden" name="view" value="${view}">
          <input type="search" name="q" value="${q0}" placeholder="Search reference, description or client">
          <select name="status"><option value="">Any status in this view</option>
            ${QUOTE_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${QUOTE_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary js-hide" type="submit">Filter</button>
        </form>
        <div data-live-results>
        ${table([
          { label: 'Reference', width: '12', hideOn: 'sm' },
          { label: 'Client', width: '18', hideOn: 'sm' },
          { label: 'Description', width: '32' },
          { label: 'Total', width: '14', align: 'right' },
          { label: 'Valid until', width: '12' },
          { label: 'Status', width: '12', hideOn: 'sm' },
        ], rows.map((row) => html`
          <tr>
            <td class="col-sm-hide"><a href="/quotes/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small col-sm-hide">${row.client_id ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>` : '—'}</td>
            <td><a class="clamp-2" href="/quotes/${row.id}">${row.description}</a>
                ${row.is_test === 1 ? html` ${badge('Test', 'amber')}` : ''}
                ${row.case_ref ? html`<div class="muted small">${row.case_ref}</div>` : ''}
                <div class="row-meta show-sm">
                  <code>${row.ref}</code>
                  ${row.client_name ? html`<span class="muted">${row.client_name}</span>` : ''}
                  ${badge(QUOTE_STATUS_LABELS[row.status], statusTone(row.status))}
                </div></td>
            <td class="num strong">${money(quoteTotal(row), row.currency)}</td>
            <td class="small">${dateShort(row.valid_until)}</td>
            <td class="col-sm-hide">${badge(QUOTE_STATUS_LABELS[row.status], statusTone(row.status))}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'No quotes in this view.' })}
        </div>`);
    });

    r.get('/new', requirePermission('quote:write'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const [clients, qs, matters, types] = await Promise.all([
        clientOptions(c.env), quoteSettings(c.env), openCaseOptions(c.env), caseTypes(c.env),
      ]);
      const presetClient = c.req.query('client_id') ?? '';
      const presetCase = c.req.query('case_id') ?? '';
      const presetInquiry = c.req.query('inquiry_id') ?? '';
      const today = nowIso().slice(0, 10);

      return page(c, { title: 'New quote', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'New' }])}
        ${pageHeader('New quote')}
        <form method="post" action="/quotes" class="form-grid" data-draft>
          ${csrfField(csrf)}
          <input type="hidden" name="inquiry_id" value="${presetInquiry}">
          ${'' /* The quotation is named rather than described. The practice, on
                   the old free-text box: "this field called Scope seems
                   superfluous. why do i need to enter details in it when that
                   will be in the quotation?" The items are the scope; this is
                   the name, and it is composed the same way a matter's is —
                   type first, so sorting by name groups by kind of work. */}
          <div class="form-section">
            <h3>Who and what</h3>
            ${select({ label: 'Matter', name: 'case_id', value: presetCase, options: matters,
                       includeBlank: 'No matter yet',
                       hint: 'Choose one and the quotation takes its name, its type and its '
                         + 'client from the matter \u2014 the other three boxes are then ignored.' })}
            ${select({ label: 'Client', name: 'client_id', value: presetClient, options: clients,
                       includeBlank: 'No client yet' })}
            ${select({ label: 'Visa type', name: 'case_type', value: '',
                       options: types.map((t) => ({ value: t.key, label: t.label })),
                       includeBlank: '\u2014 choose \u2014',
                       hint: 'What the work is. The same list the matters use, editable under '
                         + 'Settings \u2192 Vocabulary.' })}
            ${field({ label: 'Anything to add', name: 'descriptor', maxlength: 120,
                      placeholder: 'e.g. Grandparent',
                      hint: 'Only what tells this quotation apart from another of the same kind '
                        + 'for the same person. It joins the type in the name.' })}
          </div>
          ${'' /* A mandatory choice, with no default, at the moment the
                   quotation is composed. The practice's instruction on
                   8 September 2026: a letter must never be omitted by oversight
                   and never sent by one. `quotes.with_letter` is nullable for
                   the same reason — NULL means nobody has decided yet. */}
          <div class="form-section">
            <h3>Does this go out with a letter of engagement?</h3>
            ${select({ label: 'Letter of engagement', name: 'with_letter', value: '',
                       includeBlank: '— choose —', required: true,
                       options: [
                         { value: '1', label: 'Yes — send the letter with this quotation' },
                         { value: '0', label: 'No — the quotation on its own' },
                       ],
                       hint: 'The letter states no parties, no scope and no fees: those are on '
                         + 'this quotation, and the letter refers to it. What the letter says is '
                         + 'under Settings → Letter of engagement and Quotes → Letter clauses.' })}
          </div>
          <div class="form-section">
            <h3>Validity</h3>
            ${field({ label: 'Date of issue', name: 'issued_on', type: 'date', value: today })}
            ${field({ label: 'Stands for (days)', name: 'validity_days', value: String(qs.validityDays), maxlength: 3,
                      hint: `Counted inclusive of the day of issue, so ${qs.validityDays} days from ${today} means it is good through ${validUntil(today, qs.validityDays)}. The quote prints that date, not a number of days.` })}
          </div>
          <div class="form-section">
            <h3>Notes</h3>
            ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 4, maxlength: 4000,
                      hint: 'For the file. Never printed on the quote.' })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Create and add items</button>
            <a class="btn btn-secondary" href="/quotes">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/', requirePermission('quote:write'), async (c) => {
      const user = c.get('user')!;
      const qs = await quoteSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const caseId = f.optional('case_id', { max: 60 });
      const inquiryId = f.optional('inquiry_id', { max: 60 });
      // The name is composed, never typed. Three ways in, one place that
      // decides — `core/casename.ts`, the same place a matter's name comes
      // from, so the two cannot drift into different conventions.
      const caseType = f.optional('case_type', { max: 80 });
      const descriptor = f.optional('descriptor', { max: 120 });
      const issuedOn = f.date('issued_on') ?? nowIso().slice(0, 10);
      const days = f.int('validity_days', { min: 1, max: 365 }) ?? qs.validityDays;
      const notes = f.optional('notes', { max: 4000 });
      // Answered, either way, before the quotation exists. Refused rather than
      // defaulted: a default is how a letter gets omitted by oversight, or sent
      // by one, and either is a mistake in front of a client.
      const withLetter = f.enum('with_letter', ['0', '1'] as const, { required: true,
        label: 'Whether a letter of engagement goes with this quotation' });
      if (!f.valid) return redirectWith(c, '/quotes/new', Object.values(f.errors)[0] ?? 'Invalid quote.', 'err');

      // A matter answers all three questions at once, and its answer wins: the
      // quotation takes the matter's name, and its client, so a quotation
      // cannot end up naming one person and billing another.
      const matter = caseId
        ? await one<{ title: string; client_id: string; case_type: string }>(
            c.env.DB, 'SELECT title, client_id, case_type FROM cases WHERE id = ?', caseId)
        : null;
      const matterType = matter?.case_type ?? null;
      if (caseId && !matter) {
        return redirectWith(c, '/quotes/new', 'That matter no longer exists.', 'err');
      }
      const forClient = matter ? matter.client_id : (clientId || null);
      if (!matter && !caseType) {
        return redirectWith(c, '/quotes/new',
          'Choose a matter, or a visa type for the quotation to be named after.', 'err');
      }
      const types = await caseTypes(c.env);
      const client = forClient
        ? await one<{ full_name: string }>(
            c.env.DB, 'SELECT full_name FROM clients WHERE id = ?', forClient)
        : null;
      const description = matter
        ? matter.title
        : quoteNameFrom(types, caseType, descriptor, client?.full_name ?? null);

      // The date is worked out and stored now. A quote that says "valid for
      // 7 days" makes the reader do arithmetic from a date they have to find
      // first, and they will do it differently from you.
      const until = validUntil(issuedOn, days);

      const id = newId('quo');
      const ref = await nextRef(c.env.DB, 'quote', 'Q');
      await run(
        c.env.DB,
        `INSERT INTO quotes (id, ref, client_id, case_id, inquiry_id, description, case_type,
            amount_cents, gst_cents,
            disbursements_cents, currency, status, issued_on, validity_days, valid_until, notes,
            with_letter, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?, 0, 0, 0, 'NZD', 'draft', ?,?,?,?,?,?,?,?)`,
        id, ref, forClient, caseId || null, inquiryId || null, description,
        // The kind of work, kept rather than used once to make the name. It is
        // what the letter chooses its clauses from — see 0075.
        matter ? matterType : caseType,
        issuedOn, days, until, notes, withLetter === '1' ? 1 : 0,
        nowIso(), nowIso(), user.id,
      );
      // The practice's standard shape, if they have set one. Every row arrives
      // at zero: a template that carried figures would put the last client's
      // price on this client's quotation, and the first time somebody did not
      // notice would be the time it went out.
      const fees = await moneySettings(c.env);
      const laid = await applyTemplate(c.env, id, {
        unitLabel: qs.defaultUnitLabel, gstRateBp: fees.gstRateBp,
        gstRegistered: fees.gstRegistered,
      });

      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
        body: `Quote ${ref} started — valid until ${until}.`
          + (laid.lines || laid.stages
            ? ` Started from the practice's template: ${laid.lines} line(s) and `
              + `${laid.stages} stage(s), all at nil until priced.`
            : ''),
        createdBy: user.id });
      if (forClient) {
        await addEntry(c.env, { entityType: 'client', entityId: forClient, kind: 'system',
          body: `Quote ${ref} drafted: ${description}.`, createdBy: user.id });
      }
      if (inquiryId) {
        await run(c.env.DB, `UPDATE inquiries SET status = 'quoted', updated_at = ? WHERE id = ? AND status IN ('new','triaged','responded')`, nowIso(), inquiryId);
      }
      await auditFrom(c, { action: 'quote.created', entityType: 'quote', entityId: id, meta: { ref } });
      return redirectWith(c, `/quotes/${id}`, `Quote ${ref} started. Add the items below.`);
    });

    // Registered before the ':id' routes below: Hono matches in the order
    // routes are added, so '/catalogue' would otherwise be read as a quote id.
    // --- The catalogue behind the description dropdown ----------------------

    r.get('/catalogue', requirePermission('quote:write'), async (c) => {
      const items = await catalogue(c.env, true);
      const csrf = c.get('session')!.csrf;
      const fees = await moneySettings(c.env);
      const qs = await quoteSettings(c.env);
      const editing = c.req.query('edit');
      const item = editing ? items.find((i) => i.id === editing) ?? null : null;

      return page(c, { title: 'Standard items', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'Standard items' }])}
        ${'' /* A quote keeps its own copy of a line, so a price changed here
                 never alters a quotation already sent. Said in one sentence
                 below rather than explained. */}
        ${pageHeader('Standard items',
          'Changing a price here does not change a quote already sent.')}

        ${table(['Item', 'Type', 'Unit', 'Usual price', 'GST', ''], items.map((it) => html`
          <tr class="${it.active ? '' : 'row-muted'}">
            <td><span class="strong">${it.name}</span>
              ${it.description ? html`<div class="muted small">${it.description}</div>` : ''}</td>
            <td class="small">${FEE_KIND_LABELS[it.kind]}</td>
            <td class="small">${it.unit_label}</td>
            <td class="num">${it.unit_amount_cents ? money(it.unit_amount_cents) : html`<span class="muted">not set</span>`}</td>
            <td class="small">${GST_TREATMENT_LABELS[it.gst_treatment]}</td>
            <td>
              <a class="btn btn-small btn-secondary" href="/quotes/catalogue?edit=${it.id}">Edit</a>
              ${actionButton(`/quotes/catalogue/${it.id}/toggle`, csrf, it.active ? 'Retire' : 'Restore',
                { className: 'btn btn-small btn-link' })}
            </td>
          </tr>`))}

        ${card(item ? `Edit “${item.name}”` : 'Add a standard item', html`
          <form method="post" action="${item ? `/quotes/catalogue/${item.id}` : '/quotes/catalogue'}" class="form-grid">
            ${csrfField(csrf)}
            <div class="form-section">
              ${field({ label: 'Name', name: 'name', required: true, maxlength: 120, value: item?.name,
                        hint: 'What appears in the dropdown.' })}
              ${field({ label: 'Description', name: 'description', type: 'textarea', rows: 2, maxlength: 300,
                        value: item?.description,
                        hint: 'What is written on the quote line. Left blank, the name is used.' })}
            </div>
            <div class="form-section">
              ${select({ label: 'Type', name: 'kind', value: item?.kind ?? 'professional', includeBlank: false,
                         options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS),
                         hint: 'Only professional fees are apportioned in the revenue split. Disbursements are passed through whole.' })}
              ${field({ label: 'Unit', name: 'unit_label', maxlength: 30,
                        value: item?.unit_label ?? qs.defaultUnitLabel,
                        hint: 'hour, application, response, item…' })}
              ${field({ label: 'Usual price per unit', name: 'unit_amount',
                        value: item ? (item.unit_amount_cents / 100).toFixed(2) : '',
                        placeholder: '0.00', hint: 'Leave blank if it varies every time.' })}
              ${select({ label: 'GST', name: 'gst_treatment',
                         value: item?.gst_treatment ?? (fees.gstRegistered ? fees.defaultTreatment : 'none'),
                         includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">${item ? 'Save changes' : 'Add item'}</button>
              ${item ? html`<a class="btn btn-secondary" href="/quotes/catalogue">Cancel</a>` : ''}
            </div>
          </form>`)}`);
    });

    r.post('/catalogue', requirePermission('quote:write'), async (c) => {
      const f = new FormReader(await c.req.formData());
      const fields = readCatalogueForm(f);
      if (!f.valid) return redirectWith(c, '/quotes/catalogue', Object.values(f.errors)[0]!, 'err');
      const now = nowIso();
      try {
        await run(
          c.env.DB,
          `INSERT INTO service_items (id, name, description, kind, unit_label, unit_amount_cents,
              gst_treatment, active, sort_order, created_at, updated_at, created_by)
           VALUES (?,?,?,?,?,?,?,1,100,?,?,?)`,
          newId('svc'), fields.name, fields.description, fields.kind, fields.unitLabel,
          fields.unitAmount, fields.treatment, now, now, c.get('user')!.id,
        );
      } catch {
        // The unique index on the name is what refuses a duplicate; saying so
        // is more use than the generic error page.
        return redirectWith(c, '/quotes/catalogue', `There is already an item called “${fields.name}”.`, 'err');
      }
      await auditFrom(c, { action: 'quote.catalogue_added', entityType: 'service_item', meta: { name: fields.name } });
      return redirectWith(c, '/quotes/catalogue', `Added “${fields.name}”.`);
    });

    r.post('/catalogue/:itemId', requirePermission('quote:write'), async (c) => {
      const itemId = c.req.param('itemId')!;
      const f = new FormReader(await c.req.formData());
      const fields = readCatalogueForm(f);
      if (!f.valid) return redirectWith(c, `/quotes/catalogue?edit=${itemId}`, Object.values(f.errors)[0]!, 'err');
      await run(
        c.env.DB,
        `UPDATE service_items SET name = ?, description = ?, kind = ?, unit_label = ?,
            unit_amount_cents = ?, gst_treatment = ?, updated_at = ? WHERE id = ?`,
        fields.name, fields.description, fields.kind, fields.unitLabel,
        fields.unitAmount, fields.treatment, nowIso(), itemId,
      );
      await auditFrom(c, { action: 'quote.catalogue_updated', entityType: 'service_item', entityId: itemId,
        meta: { name: fields.name } });
      return redirectWith(c, '/quotes/catalogue', 'Saved.');
    });

    r.post('/catalogue/:itemId/toggle', requirePermission('quote:write'), async (c) => {
      const itemId = c.req.param('itemId')!;
      // Retired rather than deleted: quotes that used it keep their own copy of
      // the wording and the price, and reporting can still resolve the link.
      await run(c.env.DB,
        'UPDATE service_items SET active = 1 - active, updated_at = ? WHERE id = ?', nowIso(), itemId);
      await auditFrom(c, { action: 'quote.catalogue_toggled', entityType: 'service_item', entityId: itemId });
      return redirectWith(c, '/quotes/catalogue', 'Updated.');
    });

    // --- The clauses a letter of engagement carries --------------------------

    /**
     * The body of the letter, edited by an administrator.
     *
     * Under `admin:settings` rather than `quote:write`, and the difference is
     * deliberate: writing a quotation is daily work, and rewriting the terms a
     * client is asked to accept is not. A specialist can send a letter; only an
     * administrator decides what it says.
     *
     * Nothing is seeded. The register ships no wording for a contract between a
     * lawyer and a client — a letter carrying terms the register invented would
     * be worse than one that went out empty, because the empty one is obvious.
     */
    r.get('/clauses', requirePermission('admin:settings'), async (c) => {
      const [clauses, types] = await Promise.all([allClauses(c.env), caseTypes(c.env)]);
      const csrf = c.get('session')!.csrf;
      const editing = c.req.query('edit');
      const clause = editing ? clauses.find((cl) => cl.id === editing) ?? null : null;
      const chosen = new Set(clause ? clauseTypes(clause) : []);

      const named = (cl: ClauseRow) => {
        const keys = clauseTypes(cl);
        return keys.length === 0
          ? html`<span class="muted small">every matter</span>`
          : html`<span class="small">${keys.map((k) => labelFor(types, k)).join(', ')}</span>`;
      };

      return page(c, { title: 'Letter clauses', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'Letter clauses' }])}
        ${'' /* These are the headed sections in the middle of a letter of
                 engagement. The parties, the work and the fees are not here —
                 they are on the quotation the letter goes out with. A clause
                 can be limited to certain kinds of matter. */}
        ${pageHeader('Letter clauses')}

        ${clauses.length === 0
          ? card('Nothing yet', emptyState(
              'No clauses yet — a letter of engagement will print without any.'))
          : table(['Order', 'Clause', 'On which matters', ''], clauses.map((cl: ClauseRow) => html`
              <tr class="${cl.active ? '' : 'row-muted'}">
                <td class="num small">${String(cl.position)}</td>
                <td><span class="strong">${cl.heading}</span>
                  <div class="muted small clamp-2">${cl.body}</div></td>
                <td>${named(cl)}</td>
                <td>
                  <a class="btn btn-small btn-secondary" href="/quotes/clauses?edit=${cl.id}">Edit</a>
                  ${actionButton(`/quotes/clauses/${cl.id}/toggle`, csrf,
                    cl.active ? 'Switch off' : 'Switch on', { className: 'btn btn-small btn-link' })}
                </td>
              </tr>`))}

        ${card(clause ? `Edit “${clause.heading}”` : 'Add a clause', html`
          <form method="post" action="${clause ? `/quotes/clauses/${clause.id}` : '/quotes/clauses'}" class="stack">
            ${csrfField(csrf)}
            ${field({ label: 'Heading', name: 'heading', required: true, maxlength: 200,
                      value: clause?.heading ?? '',
                      hint: 'Printed as the section heading, in your own numbering if you use one.' })}
            ${field({ label: 'What it says', name: 'body', type: 'textarea', rows: 10,
                      required: true, maxlength: 8000, value: clause?.body ?? '',
                      hint: 'Blank lines separate paragraphs. A line beginning with “- ” is printed '
                        + 'as a bullet.' })}
            ${field({ label: 'Order', name: 'position', value: String(clause?.position ?? clauses.length),
                      maxlength: 4, hint: 'Lowest first. Clauses sharing a number keep the order they were added in.' })}
            ${'' /* Tick boxes rather than a multiple-selection list: there are
                     sixty-seven case types, and a multiple-selection list needs
                     a modifier key nobody has on a phone. */}
            <div class="field">
              <label>On which matters</label>
              <p class="hint">Tick none to print it on every matter.</p>
              <div class="pick-grid">
                ${types.map((t: Term) => html`
                  <label class="check small">
                    <input type="checkbox" name="case_types" value="${t.key}"
                           ${chosen.has(t.key) ? raw('checked') : ''}>
                    ${t.label}
                  </label>`)}
              </div>
            </div>
            <div class="filters">
              <button class="btn btn-primary" type="submit">${clause ? 'Save the clause' : 'Add the clause'}</button>
              ${clause ? html`<a class="btn btn-secondary" href="/quotes/clauses">Cancel</a>` : ''}
            </div>
          </form>`)}`);
    });

    /** Add a clause, or save an edit to one. Both go through here. */
    const saveClause = async (c: any, id: string | null) => {
      const form = await c.req.formData();
      const f = new FormReader(form);
      const heading = f.text('heading', { required: true, label: 'Heading', max: 200 });
      const body = f.text('body', { required: true, label: 'What it says', max: 8000 });
      const position = f.int('position', { min: 0, max: 9999 }) ?? 0;
      const back = id ? `/quotes/clauses?edit=${id}` : '/quotes/clauses';
      if (!f.valid) {
        return redirectWith(c, back, Object.values(f.errors)[0] ?? 'Give the clause a heading and a body.', 'err');
      }
      // Space-separated, because that is how the column stores it and a comma
      // inside a key would be indistinguishable from a separator.
      const chosen = [...new Set(form.getAll('case_types').map(String).filter(Boolean))].join(' ');
      const now = nowIso();
      try {
        if (id) {
          await run(
            c.env.DB,
            `UPDATE engagement_clauses SET heading = ?, body = ?, case_types = ?, position = ?,
                updated_at = ? WHERE id = ?`,
            heading, body, chosen, position, now, id);
        } else {
          await run(
            c.env.DB,
            `INSERT INTO engagement_clauses (id, position, heading, body, case_types, active,
                created_at, updated_at)
             VALUES (?,?,?,?,?,1,?,?)`,
            newId('ecl'), position, heading, body, chosen, now, now);
        }
      } catch (err) {
        // The database refuses an empty heading or body whoever is writing.
        const text = err instanceof Error ? err.message : String(err);
        const at = text.indexOf(': ');
        return redirectWith(c, back, (at >= 0 ? text.slice(at + 2) : text).trim(), 'err');
      }
      await auditFrom(c, { action: id ? 'engagement.clause_updated' : 'engagement.clause_added',
        entityType: 'engagement_clause', entityId: id ?? heading, meta: { heading, types: chosen } });
      return redirectWith(c, '/quotes/clauses', id ? 'Clause saved.' : 'Clause added.');
    };

    r.post('/clauses', requirePermission('admin:settings'), (c) => saveClause(c, null));
    r.post('/clauses/:clauseId', requirePermission('admin:settings'), (c) =>
      saveClause(c, c.req.param('clauseId')!));

    r.post('/clauses/:clauseId/toggle', requirePermission('admin:settings'), async (c) => {
      const clauseId = c.req.param('clauseId')!;
      // Switched off, never deleted: a clause withdrawn from new letters must
      // not vanish from the letters already sent, and somebody will want it
      // back.
      await run(c.env.DB,
        'UPDATE engagement_clauses SET active = 1 - active, updated_at = ? WHERE id = ?',
        nowIso(), clauseId);
      await auditFrom(c, { action: 'engagement.clause_toggled',
        entityType: 'engagement_clause', entityId: clauseId });
      return redirectWith(c, '/quotes/clauses', 'Updated.');
    });

    r.get('/:id', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null; case_ref: string | null; inquiry_ref: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref, i.ref AS inquiry_ref FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id
           LEFT JOIN cases k ON k.id = q.case_id
           LEFT JOIN inquiries i ON i.id = q.inquiry_id
          WHERE q.id = ?`,
        id,
      );
      if (!q) return c.notFound();

      // What has actually been emailed about this quotation, read here so the
      // file notes below can offer the letter itself. Only for somebody who may
      // open one — see the `mail` module for why that is `mail:send` — so the
      // query is not run for a reader who would be shown nothing.
      const canReadMail = can(c.get('user'), 'mail:send');
      const [entries, terms, lines, items, lineTypes, fees, qSettings, stages, parties, quoteInvoices, sentMail] = await Promise.all([
        listEntries(c.env, 'quote', id),
        practiceDetails(c.env),
        quoteLines(c.env, id),
        catalogue(c.env),
        caseTypes(c.env),
        moneySettings(c.env),
        quoteSettings(c.env),
        quoteStages(c.env, id),
        quoteParties(c.env, id),
        all<{ id: string; ref: string; status: string; gross_cents: number }>(
          c.env.DB, `SELECT id, ref, status, gross_cents FROM invoices WHERE quote_id = ? ORDER BY created_at`, id),
        canReadMail ? emailsForEntity(c.env, 'quote', id) : Promise.resolve([]),
      ]);
      const stageTotal = stages.reduce((sum, s) => sum + s.gross_cents, 0);
      const csrf = c.get('session')!.csrf;
      // Whether this quotation is still the practice's to change — which is two
      // questions, not one.
      //
      // **Reported on 9 September 2026:** *"in quote 12 I managed to delete a
      // line! should not be possible."* It asked only whether the user may edit
      // quotations at all, never whether *this* quotation was still open, so an
      // accepted one kept every button it had before the client signed.
      //
      // The database refuses it outright now (migration 0079). This is the
      // courtesy: the buttons go away rather than appearing and then failing.
      const writable = can(c.get('user'), 'quote:write') && !q.accepted_at;
      const totals = summariseQuote(lines.map((l) => ({
        kind: l.kind, lineAmountCents: l.unit_amount_cents,
        netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
      })));

      return page(c, { title: q.ref, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: q.ref }])}
        ${testDataBand({ isTest: q.is_test === 1, table: 'quotes', id: q.id,
                         csrf: c.get('session')!.csrf, canMark: can(c.get('user'), 'data:test'),
                         noun: 'quotation', returnTo: `/quotes/${q.id}`, oneWay: true })}
        ${'' /* **Asked for on 11 September 2026:** *"can you mark them so that I can
                 reinstate them to unaccepted state to test? so i can send them and
                 accept them many times - because i need to test the system."* Only on
                 a quotation marked test data, because on a real one this would be
                 un-forming a contract. */}
        ${q.is_test === 1 && q.accepted_at && can(c.get('user'), 'data:test')
          ? html`<div class="test-band">
              <p class="test-band-said">Accepted ${dateShort(q.accepted_at)} by
                 ${q.accepted_name}. Wind it back to a draft to send and accept it again.</p>
              ${actionButton(`/quotes/${q.id}/reopen`, csrf, 'Unaccept and start again', {
                className: 'btn btn-secondary btn-small',
                confirm: 'Clear the acceptance and put this test quotation back to draft?',
              })}
            </div>`
          : ''}
        ${pageHeader(q.description, `${q.ref} · ${QUOTE_STATUS_LABELS[q.status]}`, html`
          <a class="btn btn-secondary" href="/quotes/${q.id}/print" target="_blank" rel="noopener">Print</a>
          ${q.with_letter === 1
            ? html`<a class="btn btn-secondary" href="/quotes/${q.id}/letter" target="_blank"
                      rel="noopener">Letter of engagement</a>`
            : ''}
          ${writable ? html`
            <a class="btn btn-secondary" href="/quotes/${q.id}/edit">Edit</a>
            <a class="btn btn-primary" href="/quotes/${q.id}/email">Email to client</a>
            ${q.status !== 'withdrawn' && q.status !== 'accepted'
              ? actionButton(`/quotes/${q.id}/status`, csrf, 'Cancel quote',
                  { className: 'btn btn-danger', fields: { status: 'withdrawn' },
                    confirm: `Cancel quote ${q.ref}? It stays on the file, marked withdrawn.` })
              : ''}` : ''}
          ${'' /* Behind admin:settings rather than quote:write. Pressing it
                 changes what *every* future quotation starts from, which is a
                 configuration act wearing the clothes of a quotation one. */}
          ${can(c.get('user'), 'admin:settings') && (lines.length > 0 || stages.length > 0)
            ? actionButton(`/quotes/${q.id}/template`, csrf, 'Use as the template',
                { className: 'btn btn-secondary',
                  confirm: `Make the shape of ${q.ref} the starting point for every new `
                    + 'quotation? The wording and GST treatment are copied; no amounts are.' })
            : ''}`)}

        <div class="cols">
          <div class="col-main">
            ${terms.termsUrl
              ? html`<div class="alert alert-ok">
                       This quotation is subject to the Letter of Engagement, the Short Form Terms
                       printed with it, and the
                       <a href="${terms.termsUrl}" target="_blank" rel="noopener noreferrer">Standard
                       Terms of Engagement</a> — which is the address the client gets the current
                       edition from.
                     </div>`
              : ''}

            ${card('Items', html`
              ${lines.length === 0
                ? emptyState('No lines yet. Add the first one below.')
                // Amount last, to the right of GST, at the practice's
                // instruction of 9 September 2026: the eye runs along a fee line
                // to the figure that matters, and that is what the line comes to.
                // **Reported on 11 September 2026:** *"the column heading
                // shifted"*. The figures in these columns are right-aligned and
                // the headings were not, so Qty, Unit, GST and Amount each sat
                // to the left of the column they name — by more, the wider the
                // window. The alignment is stated once here, beside the widths,
                // and the heading now sits over its own figures.
                : table(ITEM_COLUMNS.map((label) => ({
                    label,
                    width: ITEM_WIDTHS[label],
                    align: ITEM_NUMERIC.has(label) ? ('right' as const) : undefined,
                  })), [
                    ...lines.map((l) => html`
                      <tr>
                        <td>
                          <span class="strong">${l.description}</span>
                          <div class="muted small">${FEE_KIND_LABELS[l.kind]}</div>
                        </td>
                        <td class="num">${formatQuantity(l.quantity_milli)}
                          <div class="muted small">${pluraliseUnit(l.unit_label, l.quantity_milli)}</div></td>
                        <td class="num">${money(l.unit_amount_cents, q.currency)}</td>
                        <td class="num">${l.gst_cents ? money(l.gst_cents, q.currency)
                          : html`<span class="muted">—</span>`}</td>
                        <td class="num strong">${money(l.net_cents, q.currency)}</td>
                        <td class="row-action">${writable
                          ? actionButton(`/quotes/${q.id}/items/${l.id}/remove`, csrf,
                              `Remove “${l.description}”`,
                              { className: 'btn-remove', icon: '\u00d7',
                                confirm: `Remove “${l.description}” from this quote?` })
                          : ''}</td>
                      </tr>`),
                    // A total belongs under the column it totals. The label
                    // spans everything up to Amount and the figure sits in
                    // Amount, so a total lines up with the figures above it.
                    // It spanned one column fewer until 9 September 2026, when
                    // Amount moved to the right of GST and the totals were left
                    // where they were — reported the same day as "you swapped
                    // the columns but left the totals under gst". Both are now
                    // derived from ITEM_COLUMNS, so moving a column moves the
                    // totals with it.
                    // **Asked on 11 September 2026:** "are these lines superfluous?
                    // the body of the quotation already says what is what - why do we
                    // duplicate it? clients can calculate subtotals themselves - lets
                    // save some space." They were. Every line above already says
                    // whether it is a professional fee or a disbursement, so the two
                    // subtotals restated the column beside them, and Subtotal restated
                    // Total payable minus the GST directly under it. Five rows, two
                    // of them load-bearing.
                    ...totalRows([
                      ['GST', totals.gstCents, totals.hasGst],
                      ['Total payable', totals.totalCents, true],
                    ], q.currency),
                  ], { compact: true, fixed: true })}

              ${writable && lines.length > 0 ? html`
                <details class="add-block">
                  <summary>Edit the lines</summary>
                  <p class="hint mb">Change anything on any line, reorder them, or cross one out to
                     remove it.
                     Saving recalculates the totals and rewrites the quote.</p>
                  <form method="post" action="/quotes/${q.id}/items">
                    ${csrfField(csrf)}
                    <input type="hidden" name="_action" value="save">
                    <div class="table-wrap">
                      <table class="edit-table">
                        <thead><tr>
                          <th>#</th><th>Description</th><th>Qty</th><th>Unit</th>
                          <th>Price per unit</th><th>Type</th><th>GST</th><th></th>
                        </tr></thead>
                        <tbody>
                          ${lines.map((l, i) => html`
                            <tr>
                              <td><input name="position_${l.id}" value="${i + 1}" size="2" inputmode="numeric"
                                         aria-label="Order"></td>
                              <td><input name="description_${l.id}" value="${l.description}" maxlength="300"
                                         required aria-label="Description"></td>
                              <td><input name="quantity_${l.id}" value="${formatQuantity(l.quantity_milli)}"
                                         size="4" inputmode="decimal" required aria-label="Quantity"></td>
                              <td><input name="unit_${l.id}" value="${l.unit_label}" size="8" maxlength="30"
                                         aria-label="Unit"></td>
                              <td><input name="amount_${l.id}" value="${(l.unit_amount_cents / 100).toFixed(2)}"
                                         size="8" inputmode="decimal" required aria-label="Price per unit"></td>
                              <td><select name="kind_${l.id}" aria-label="Type">
                                ${FEE_KINDS.map((k) => html`<option value="${k}" ${k === l.kind ? raw('selected') : ''}>${FEE_KIND_LABELS[k]}</option>`)}
                              </select></td>
                              <td><select name="gst_${l.id}" aria-label="GST">
                                ${GST_TREATMENTS.map((g) => html`<option value="${g}" ${g === l.gst_treatment ? raw('selected') : ''}>${GST_TREATMENT_LABELS[g]}</option>`)}
                              </select></td>
                              ${'' /* A red cross, like the one beside the line
                                     above. **Asked for on 9 September 2026:**
                                     *"the remove words need to be replaced here
                                     too."*

                                     Still a checkbox underneath, because this
                                     is a batch: nothing happens until Save, so
                                     several lines can go at once and a slip can
                                     be unticked. The box is the control; the
                                     cross is what it looks like. It fills red
                                     when ticked, so what is about to go is
                                     visible before saving.

                                     `input:checked + span` rather than `:has()`,
                                     so the ticked state shows in any browser
                                     rather than in most of them. */}
                              <td class="row-action">
                                <label class="tick-remove">
                                  <input type="checkbox" name="remove_${l.id}"
                                         aria-label="Remove ${l.description} when you save">
                                  <span class="tick-remove-mark" aria-hidden="true">×</span>
                                </label>
                              </td>
                            </tr>`)}
                        </tbody>
                      </table>
                    </div>
                    <button class="btn btn-primary" type="submit">Save the lines</button>
                  </form>
                </details>` : ''}

              ${writable ? html`
                <details class="add-block" ${lines.length === 0 ? raw('open') : ''}>
                  <summary>Add a line</summary>
                  <p class="hint mb">Choosing something from the catalogue fills the rest of the line
                     in, and you can still change any of it. Manage that list under
                     <a href="/quotes/catalogue">standard items</a>.</p>
                  <form method="post" action="/quotes/${q.id}/items" class="row-form js-quote-line">
                    ${csrfField(csrf)}
                    <div class="field">
                      <label for="f_service_item_id">From the catalogue</label>
                      ${'' /* One list, in two groups. The case types are read live
                               from the vocabulary rather than copied into the
                               catalogue — the copy had already drifted by two
                               types within a week, and one of the two was the
                               work being quoted when the practice noticed.
                               See migration 0074. */}
                      <select id="f_service_item_id" name="service_item_id" class="js-catalogue">
                        <option value="">— type it in below —</option>
                        <optgroup label="Visa and case types">
                          ${lineTypes.map((t) => html`<option value="${`type:${t.key}`}"
                              data-description="${t.label}"
                              data-kind="professional"
                              data-unit="${qSettings.defaultUnitLabel}"
                              data-amount=""
                              data-gst="exclusive">${t.label}</option>`)}
                        </optgroup>
                        <optgroup label="Standard items">
                          ${items.map((it) => html`<option value="${it.id}"
                              data-description="${it.description || it.name}"
                              data-kind="${it.kind}"
                              data-unit="${it.unit_label}"
                              data-amount="${(it.unit_amount_cents / 100).toFixed(2)}"
                              data-gst="${it.gst_treatment}">${it.name}${it.unit_amount_cents
                                ? ` — ${money(it.unit_amount_cents, q.currency)}/${it.unit_label}` : ''}</option>`)}
                        </optgroup>
                      </select>
                    </div>
                    ${field({ label: 'Description', name: 'description', required: true, maxlength: 300 })}
                    ${field({ label: 'Quantity', name: 'quantity', value: '1', required: true, maxlength: 10 })}
                    ${field({ label: 'Unit', name: 'unit_label', value: qSettings.defaultUnitLabel, maxlength: 30 })}
                    ${field({ label: 'Price per unit', name: 'unit_amount', required: true, placeholder: '0.00' })}
                    ${select({ label: 'Type', name: 'kind', value: 'professional', includeBlank: false,
                               options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS) })}
                    ${select({ label: 'GST', name: 'gst_treatment',
                               value: fees.gstRegistered ? fees.defaultTreatment : 'none',
                               includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS),
                               hint: 'Disbursements are normally “No GST” — an INZ fee is passed through as it stands.' })}
                    <button class="btn btn-primary" type="submit">Add line</button>
                  </form>
                </details>` : ''}`)}

            ${'' /* A block per person rather than a row per person. The first
                     version of this was a four-column table, and at 390px the
                     name column was one character wide — the same fault the
                     practice had just reported on the dashboard, built fresh.
                     Editing several people is a form, and forms stack. */}
            ${card('The people on this engagement', html`
              <p class="hint mb">The client does not need a row — they are already on the
                 quotation.</p>
              ${parties.length === 0
                ? emptyState('Nobody else named yet — the letter will name the client alone.')
                : writable
                  ? html`
                    <form method="post" action="/quotes/${q.id}/parties">
                      ${csrfField(csrf)}
                      <input type="hidden" name="_action" value="save">
                      ${parties.map((party) => html`
                        <fieldset class="party-edit">
                          <legend>${QUOTE_PARTY_ROLE_LABELS[party.role]}${
                            party.is_representative ? ' · nominated to instruct' : ''}</legend>
                          <input type="hidden" name="${`kind_${party.id}`}" value="${party.kind}">
                          <div class="form-section">
                            ${field({ label: 'Full name', name: `full_name_${party.id}`,
                                      value: party.full_name, maxlength: 200 })}
                            ${field({ label: 'Relationship', name: `relationship_${party.id}`,
                                      value: party.relationship ?? '', maxlength: 60,
                                      placeholder: 'partner, son, employer' })}
                            ${select({ label: 'On this engagement', name: `role_${party.id}`,
                                       value: party.role, includeBlank: false,
                                       options: optionsFrom(QUOTE_PARTY_ROLES, QUOTE_PARTY_ROLE_LABELS) })}
                            ${party.kind === 'organisation'
                              ? html`<div class="field"><label>Date of birth</label>
                                       <p class="hint">An organisation has none.</p></div>`
                              : field({ label: 'Date of birth', name: `date_of_birth_${party.id}`,
                                        type: 'date', value: party.date_of_birth ?? '' })}
                            ${field({ label: 'Agency or company', name: `organisation_${party.id}`,
                                      value: party.organisation ?? '', maxlength: 200 })}
                            ${field({ label: 'Email', name: `email_${party.id}`, type: 'email',
                                      value: party.email ?? '', maxlength: 200 })}
                            ${field({ label: 'Phone', name: `phone_${party.id}`,
                                      value: party.phone ?? '', maxlength: 60 })}
                          </div>
                          <div class="party-edit-flags">
                            <label class="check">
                              <input type="checkbox" name="${`representative_${party.id}`}"
                                     ${party.is_representative ? raw('checked') : ''}>
                              Nominated to instruct on everybody's behalf
                            </label>
                            <label class="check">
                              <input type="checkbox" name="${`remove_${party.id}`}">
                              Take them off this quotation
                            </label>
                          </div>
                        </fieldset>`)}
                      <div class="filters mt">
                        <button class="btn btn-primary" type="submit">Save the people</button>
                        <span class="hint">Ticking the second box takes somebody off when you save.</span>
                      </div>
                    </form>`
                  : html`<ul class="list">${parties.map((party) => html`
                      <li>
                        <strong>${party.full_name}</strong>
                        ${party.relationship ? html` — ${party.relationship}` : ''}
                        ${party.is_representative ? badge('nominated to instruct', 'blue') : ''}
                        <div class="muted small">
                          ${QUOTE_PARTY_ROLE_LABELS[party.role]}
                          ${party.date_of_birth ? html` · ${dateShort(party.date_of_birth)}` : ''}
                          ${party.organisation ? html` · ${party.organisation}` : ''}
                          ${party.email ? html` · ${party.email}` : ''}
                          ${party.phone ? html` · ${party.phone}` : ''}
                        </div>
                      </li>`)}</ul>`}

              ${!parties.some((p) => p.is_representative) ? html`
                <p class="hint">Nobody is nominated to instruct, so the letter will say the client
                   is.</p>` : ''}

              ${writable ? html`
                <details class="reveal mt">
                  <summary class="btn btn-secondary reveal-open">Add somebody</summary>
                  <form method="post" action="/quotes/${q.id}/parties" class="form-section">
                    ${csrfField(csrf)}
                    ${field({ label: 'Full name', name: 'full_name', required: true, maxlength: 200,
                              hint: 'As it is written on their passport, if they are applying.' })}
                    ${select({ label: 'On this engagement', name: 'role', value: 'associated',
                               includeBlank: false,
                               options: optionsFrom(QUOTE_PARTY_ROLES, QUOTE_PARTY_ROLE_LABELS),
                               hint: 'An administrative contact may be told how it is going. '
                                 + 'They may not instruct, and the letter says so.' })}
                    ${select({ label: 'A person or an organisation', name: 'kind', value: 'person',
                               includeBlank: false,
                               options: optionsFrom(QUOTE_PARTY_KINDS, QUOTE_PARTY_KIND_LABELS) })}
                    ${field({ label: 'Relationship', name: 'relationship', maxlength: 60,
                              placeholder: 'partner, son, employer',
                              hint: 'In your own words. It is printed as you write it.' })}
                    ${field({ label: 'Date of birth', name: 'date_of_birth', type: 'date',
                              hint: 'For a person. Left off an organisation.' })}
                    ${field({ label: 'Agency or company', name: 'organisation', maxlength: 200 })}
                    ${field({ label: 'Email', name: 'email', type: 'email', maxlength: 200 })}
                    ${field({ label: 'Phone', name: 'phone', maxlength: 60,
                              hint: 'An administrative contact needs one of these two.' })}
                    <label class="check">
                      <input type="checkbox" name="is_representative" value="1">
                      Nominated to instruct on everybody's behalf
                    </label>
                    <button class="btn btn-primary" type="submit">Add them</button>
                  </form>
                </details>` : ''}`)}

            ${card('Payment stages', html`
              ${'' /* Kept apart from the items above because the two do not line
                       up: one piece of work can be split across a deposit and a
                       balance, and one stage can gather several fees into a
                       single payment. */}
              <p class="hint mb">When each part falls due.</p>
              ${'' /* The figure the client pays, and the same one the
                       printed quotation shows.

                       **Reported on 9 September 2026**, looking at this card:
                       *"do not like how this is formatted in the register."*
                       Three things were wrong with it and they compounded.

                       The figure was the *net* amount with "+ GST" beside it
                       and the inclusive figure in grey underneath — the
                       arrangement the printed quotation stopped using earlier
                       the same day, when the practice said the stages "should
                       already be showing the GST inclusive amounts". So the
                       screen and the paper disagreed about the same five
                       numbers, and the screen is where the practice checks them
                       before they go out.

                       And it broke across three lines. "$2,000.00 +" / "GST" /
                       "$2,300.00 incl." is not a price, and "Stage 1" was
                       splitting after "Stage" in a column narrow enough to make
                       it. Both are now held on one line.

                       What is underneath says how much of the figure is tax,
                       which works for a stage of either treatment — "+ GST" was
                       a lie on the INZ fee, which is GST inclusive: nothing is
                       added to it. */}
              ${stages.length === 0
                ? emptyState('No stages set out — payment terms alone will be printed.')
                : table(['Stage', 'Description', 'Amount'], [
                    ...stages.map((s) => html`
                      <tr>
                        <td class="small strong nowrap">${s.label || '—'}</td>
                        <td>${s.description}</td>
                        <td class="num">
                          <span class="nowrap">${money(s.gross_cents, q.currency)}</span>
                          ${s.gst_cents
                            ? html`<div class="muted small nowrap">includes
                                     ${money(s.gst_cents, q.currency)} GST</div>` : ''}
                        </td>
                      </tr>`),
                    html`<tr class="totals-row">
                      <td colspan="2" class="strong">Scheduled</td>
                      <td class="num strong nowrap ${stageTotal !== totals.totalCents ? 'warn' : ''}">
                        ${money(stageTotal, q.currency)}</td></tr>`,
                  ], { compact: true })}

              ${'' /* What is left to allocate, said before the mistake rather
                     than after it.

                     **Asked for on 9 September 2026:** *"there is a hint as to
                     how much has been allocated — make sure that it also tells
                     how much is left to allocate, and that it does not allow
                     for allocating more than the total fee."*

                     Both halves. The figure still to be scheduled is the one a
                     person is actually working out in their head while they
                     type, and it was the one number the page did not show; and
                     the schedule can no longer be taken past the quotation at
                     all, which the database enforces (migration 0077).

                     Three states, because they mean different things:
                     under-allocated is work in progress and is said plainly;
                     fully allocated is the finished article and says so;
                     over-allocated can now only be reached by lowering a fee
                     line under a schedule already written, which is a warning
                     rather than a refusal — see the migration for why that
                     direction is deliberately not blocked. */}
              ${stages.length > 0 || stageTotal > 0 ? html`
                <p class="${stageTotal > totals.totalCents ? 'alert alert-warn' : 'hint mt'}">
                  ${stageTotal > totals.totalCents
                    ? html`The stages come to <strong>${money(stageTotal, q.currency)}</strong>,
                           which is ${money(stageTotal - totals.totalCents, q.currency)} more than
                           the quotation's ${money(totals.totalCents, q.currency)}. Lower a
                           stage to match before this goes out.`
                    : stageTotal === totals.totalCents
                    ? html`<strong>${money(stageTotal, q.currency)}</strong> allocated across
                           ${String(stages.length)} stage(s) — the whole quotation. Nothing left to
                           allocate.`
                    : html`<strong>${money(stageTotal, q.currency)}</strong> allocated of
                           ${money(totals.totalCents, q.currency)}.
                           <strong>${money(totals.totalCents - stageTotal, q.currency)}</strong>
                           left to allocate.`}
                </p>` : ''}

              ${q.stage_note ? html`<p class="prewrap small mt"><strong>Note:</strong> ${q.stage_note}</p>` : ''}

              ${writable ? html`
                ${lines.length > 0 && stages.length === 0
                  ? html`<form method="post" action="/quotes/${q.id}/stages/generate" class="mb">
                           ${csrfField(csrf)}
                           <button class="btn btn-secondary" type="submit">Draft stages from the items</button>
                           <p class="hint">One stage per item, in order, which you can then reword,
                              split or merge.</p>
                         </form>`
                  : ''}

                ${stages.length > 0 ? html`
                  <details class="add-block">
                    <summary>Edit the stages</summary>
                    <form method="post" action="/quotes/${q.id}/stages">
                      ${csrfField(csrf)}
                      <input type="hidden" name="_action" value="save">
                      <div class="table-wrap">
                        <table class="edit-table">
                          <thead><tr><th>#</th><th>Stage</th><th>Description</th><th>Amount</th><th>GST</th><th></th></tr></thead>
                          <tbody>
                            ${stages.map((s, i) => html`
                              <tr>
                                <td><input name="position_${s.id}" value="${i + 1}" size="2" inputmode="numeric" aria-label="Order"></td>
                                <td><input name="label_${s.id}" value="${s.label}" size="8" maxlength="40" aria-label="Stage"></td>
                                <td><input name="description_${s.id}" value="${s.description}" maxlength="500" required aria-label="Description"></td>
                                <td><input name="amount_${s.id}" value="${(s.amount_cents / 100).toFixed(2)}" size="9" inputmode="decimal" required aria-label="Amount"></td>
                                <td><select name="gst_${s.id}" aria-label="GST">
                                  ${GST_TREATMENTS.map((g) => html`<option value="${g}" ${g === s.gst_treatment ? raw('selected') : ''}>${GST_TREATMENT_LABELS[g]}</option>`)}
                                </select></td>
                                <td class="row-action">
                                  <label class="tick-remove">
                                    <input type="checkbox" name="remove_${s.id}"
                                           aria-label="Remove ${s.label || 'this stage'} when you save">
                                    <span class="tick-remove-mark" aria-hidden="true">×</span>
                                  </label>
                                </td>
                              </tr>`)}
                          </tbody>
                        </table>
                      </div>
                      ${field({ label: 'Note under the schedule', name: 'stage_note', type: 'textarea',
                                rows: 2, maxlength: 1000, value: q.stage_note })}
                      <button class="btn btn-primary" type="submit">Save the stages</button>
                    </form>
                  </details>` : ''}

                <details class="add-block" ${stages.length === 0 ? raw('open') : ''}>
                  <summary>Add a stage</summary>
                  <form method="post" action="/quotes/${q.id}/stages" class="row-form">
                    ${csrfField(csrf)}
                    ${field({ label: 'Stage', name: 'label', maxlength: 40,
                              value: `Stage ${stages.length + 1}`, placeholder: 'Stage 1' })}
                    ${field({ label: 'Description', name: 'description', required: true, maxlength: 500,
                              placeholder: 'Case review and preparation — due on instruction' })}
                    ${field({ label: 'Amount', name: 'amount', required: true, placeholder: '0.00' })}
                    ${select({ label: 'GST', name: 'gst_treatment',
                               value: fees.gstRegistered ? fees.defaultTreatment : 'none',
                               includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
                    <button class="btn btn-primary" type="submit">Add stage</button>
                  </form>
                </details>` : ''}`)}


            ${writable ? card('Invoices', html`
              ${quoteInvoices.length === 0
                ? html`<p class="small muted">Nothing has been invoiced from this quote yet.</p>`
                : html`<ul class="list">${quoteInvoices.map((inv) => html`
                    <li class="list-row">
                      <div><a href="/invoices/${inv.id}"><code>${inv.ref}</code></a>
                        <span class="muted small">${money(inv.gross_cents, q.currency)}</span></div>
                      <div>${badge(inv.status, statusTone(inv.status === 'paid' ? 'approved' : inv.status))}</div>
                    </li>`)}</ul>`}
              <form method="post" action="/quotes/${q.id}/invoice" class="row-form mt">
                ${csrfField(csrf)}
                ${field({ label: 'Payment terms (days)', name: 'term_days', type: 'number', value: '7' })}
                <button class="btn btn-primary" type="submit">Raise an invoice</button>
              </form>
              ${'' /* Nothing here consumes the quote: a quote can reasonably be
                       invoiced more than once — staged fees are precisely that. */}
              <p class="hint">The lines are copied onto a new draft invoice; this quote is left
                 as it is.</p>`) : ''}

            ${'' /* A note of an email sent offers the email.

                     **The practice, 11 September 2026:** *"why do we not have
                     the entire email that was sent out in the file note,
                     recorded as an email?"* The whole letter was in the
                     register the whole time and nothing showed it.

                     The link is worked out here, at the moment the page is
                     drawn, by matching the note against what the queue stored
                     for this quotation — never written into the note. File
                     notes are append-only: they say what was said at the time,
                     and adding a link to one afterwards would be editing the
                     record. Deriving it instead means every email the practice
                     has *already* sent becomes readable, not only the next
                     one. `mailLinkFor` decides, and refuses to guess when two
                     letters answer to the same note. */}
            ${card('File notes', entries.length === 0 ? emptyState('Nothing recorded yet.') : html`
              <ul class="timeline">${entries.map((e) => {
                const link = canReadMail ? mailLinkFor(e, sentMail, recordMailHref('quote', q.id)) : null;
                return html`
                <li class="timeline-item">
                  <div class="timeline-meta"><span class="muted small">${stamp(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span></div>
                  <div class="timeline-body">${e.body}</div>
                  ${link ? html`<p class="small mt"><a href="${link.href}">${link.label}</a></p>` : ''}
                </li>`;
              })}</ul>`)}

            ${'' /* Quiet, and below the notes rather than beside them: this is
                     a reference for when somebody asks "what exactly did we
                     send them, and when", not the business of the page. The
                     notes are still the running record. */}
            ${canReadMail && sentMail.length > 0 ? card('Emails sent', html`
              <ul class="list">${sentMail.map((m) => html`
                <li class="list-row">
                  <div>
                    <a href="/mail/${m.id}">${m.subject || '(no subject)'}</a>
                    <div class="muted small">${m.to_addr} · ${stamp(m.sent_at ?? m.created_at)}</div>
                  </div>
                  <div>${badge(sendState(m).words, sendState(m).tone)}</div>
                </li>`)}</ul>`) : ''}
          </div>

          <div class="col-side">
            ${'' /* Where the client is up to, above everything else on the
                   side, because it is the question the practice opens this page
                   to answer once a quotation has gone out.

                   It shows the link only when there is one. A quotation gets
                   its link when the practice presses Email, so a draft has none
                   and there is nothing to explain. */}
            ${q.accepted_at ? html`
              ${card('Accepted by the client', html`
                <p class="alert alert-ok"><strong>${q.accepted_name ?? 'The client'}</strong>
                   accepted this quotation.</p>
                <dl class="kv">
                  <dt>Received</dt><dd>${printedAt(q.accepted_at)}</dd>
                  ${q.accepted_from ? html`<dt>Recorded</dt><dd class="small">${q.accepted_from}</dd>` : ''}
                </dl>
                ${'' /* It is the moment the contract was formed, which is why
                         nothing here can undo it. */}
                <p class="hint">An acceptance cannot be undone — issue a new quotation if it was
                   made in error.</p>`)}`
              : q.share_token ? html`
              ${card('The client\u2019s link', html`
                ${'' /* The link carries the quotation, the letter of engagement
                         where there is one, and the acceptance form. It does not
                         change once sent. */}
                <p><a class="break-url small" href="/q/${q.share_token}" target="_blank"
                      rel="noopener">/q/${q.share_token}</a></p>
                <p class="hint">Anybody holding this address can read the quotation.</p>`)}`
              : ''}

            ${card('Status', html`
              <p>${badge(QUOTE_STATUS_LABELS[q.status], statusTone(q.status))}</p>
              ${writable ? html`
                <form method="post" action="/quotes/${q.id}/status" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Set status', name: 'status', value: q.status, includeBlank: false,
                             options: optionsFrom(QUOTE_STATUSES, QUOTE_STATUS_LABELS) })}
                  <button class="btn btn-secondary" type="submit">Update</button>
                </form>` : ''}`)}

            ${card('Letter of engagement', html`
              ${q.with_letter === 1
                ? html`<p class="small">This quotation goes out <strong>with</strong> a letter of
                         engagement.</p>
                       <a class="btn btn-secondary btn-block" href="/quotes/${q.id}/letter"
                          target="_blank" rel="noopener">Read the letter</a>`
                : q.with_letter === 0
                  ? html`<p class="small">This quotation goes out <strong>on its own</strong>.</p>`
                  /* Quotations made before the question existed are in this state. */
                  : html`<p class="small">Nobody has said yet whether this goes out with a
                           letter.</p>`}
              ${writable ? html`
                <form method="post" action="/quotes/${q.id}/letter" class="mt">
                  ${csrfField(csrf)}
                  ${select({ label: 'Send with a letter of engagement?', name: 'with_letter',
                             value: q.with_letter === null ? '' : String(q.with_letter),
                             includeBlank: '— choose —', required: true,
                             options: [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }] })}
                  <button class="btn btn-secondary btn-small" type="submit">Save</button>
                </form>` : ''}`)}

            ${card('Linked to', html`
              <dl class="kv">
                <dt>Client</dt><dd>${q.client_id ? html`<a href="/clients/${q.client_id}">${q.client_name}</a>` : '—'}</dd>
                <dt>Case</dt><dd>${q.case_id ? html`<a href="/cases/${q.case_id}"><code>${q.case_ref}</code></a>` : '—'}</dd>
                <dt>Inquiry</dt><dd>${q.inquiry_id ? html`<a href="/inquiries/${q.inquiry_id}"><code>${q.inquiry_ref}</code></a>` : '—'}</dd>
                <dt>Issued</dt><dd>${dateShort(q.issued_on)}</dd>
                <dt>Valid until</dt><dd>${q.valid_until
                  ? html`${dateShort(q.valid_until)}
                         <div class="muted small">${q.validity_days ?? qSettings.validityDays} days including the day of issue</div>`
                  : '—'}</dd>
                <dt>Sent</dt><dd>${stamp(q.sent_at)}</dd>
                <dt>Answered</dt><dd>${stamp(q.responded_at)}</dd>
              </dl>
              ${writable ? html`
                <form method="post" action="/quotes/${q.id}/issue" class="mt">
                  ${csrfField(csrf)}
                  ${field({ label: 'Date of issue', name: 'issued_on', type: 'date',
                            value: dateInputValue(q.issued_on ?? nowIso()) })}
                  ${field({ label: 'Stands for (days)', name: 'validity_days',
                            value: String(q.validity_days ?? qSettings.validityDays), maxlength: 3 })}
                  <button class="btn btn-secondary btn-small" type="submit">Set validity</button>
                  <p class="hint">Counted inclusive of the day of issue.</p>
                </form>` : ''}`)}

            ${card('Notes', html`<p class="prewrap">${q.notes || '—'}</p>`)}
          </div>
        </div>`);
    });

    /**
     * A printable quote. Rendered without the application chrome so that what
     * comes out of the printer is the document, not the screen around it.
     */
    /**
     * The letter of engagement, as the client reads it.
     *
     * A covering letter and nothing else. It states no parties, no scope and no
     * fees — the practice's decision on 8 September 2026 — because the quotation
     * attached to it states all three, and a covering letter that restates a fee
     * schedule is a document that can disagree with its own attachment.
     *
     * So what is on this page is: who it is to, what it is about, the practice's
     * standing words, the clauses that belong on this kind of matter, what the
     * client confirms by accepting, and a signature. Everything particular to
     * this engagement is a reference to the quotation.
     */
    r.get('/:id/letter', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const d = await loadLetter(c.env, id);
      if (!d) return c.notFound();
      await auditFrom(c, { action: 'quote.letter_printed', entityType: 'quote', entityId: id });
      return page(c, { title: `Letter of engagement — ${d.q.ref}`, bare: true, paper: true },
        letterArticle(d, html`
          <footer class="quote-doc-foot no-print">
            <button class="btn btn-primary" data-print type="button">Print this letter</button>
            <a class="btn btn-secondary" href="/quotes/${id}/print">The quotation</a>
            <a class="btn btn-secondary" href="/quotes/${id}">Back to the quote</a>
          </footer>`));
    });

    r.get('/:id/print', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const d = await loadQuotation(c.env, id);
      if (!d) return c.notFound();
      await auditFrom(c, { action: 'quote.printed', entityType: 'quote', entityId: id });
      return page(c, { title: `Quote ${d.q.ref}`, bare: true, paper: true },
        quotationArticle(d, html`
          <footer class="quote-doc-foot no-print">
            <button class="btn btn-primary" data-print type="button">Print this quote</button>
            <a class="btn btn-secondary" href="/quotes/${id}">Back to the quote</a>
          </footer>`));
    });

    /** Compose an email of the quote. It is queued and recorded, never sent blind. */
    r.get('/:id/email', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null; client_email: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, cl.email AS client_email FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id WHERE q.id = ?`,
        id,
      );
      if (!q) return c.notFound();

      const [practice, items, qs, recipients] = await Promise.all([
        practiceDetails(c.env), quoteLines(c.env, id), quoteSettings(c.env),
        // Everybody the register can already write to, best first. One query;
        // see `mail/recipients.ts` for why there is no address book behind it.
        quoteRecipients(c.env, q),
      ]);
      const csrf = c.get('session')!.csrf;
      const configured = mailConfigured(c.env);

      // The client's link, minted here if the quotation has not got one.
      //
      // Here rather than when the quotation is created, because this is the
      // moment it is about to leave the office. A quotation that is never sent
      // never gets a link, and there is nothing to guess at.
      //
      // The address is the practice's own where they have set one, so a client
      // reads their fee quote at the firm's address rather than at
      // workers.dev — the same rule the reminder emails follow.
      const token = await shareTokenFor(c.env, id);
      const address = await publicBase(c.env, new URL(c.req.url).origin);
      const shareLink = token ? shareUrl(address.base, token) : '';
      // Said before the email goes, not after: the link is minted here and the
      // client keeps it for good, so an address sent by mistake cannot be
      // corrected by changing a setting afterwards.
      const addressWarning = fallbackWarning(address);

      // The letter is the practice's, from Settings → Quotes; the register only
      // supplies the facts. Drafted here rather than in the template so the
      // sentences that depend on what is true — "them" or "it", what a total is
      // inclusive of — are decided by the register rather than by a conditional
      // somebody has to write in a settings box.
      const values = quoteEmailValues(q, practice, items, qs.capacityNote, shareLink);
      const draft = c.req.query('body');
      const draftSubject = c.req.query('subject');
      // Formatted unless the practice has just chosen otherwise and come back.
      const asHtml = (c.req.query('format') ?? 'html') !== 'text';
      const body = draft ?? quoteEmailBody(qs.emailBody, values);
      const subject = (draftSubject ?? fillTemplate(qs.emailSubject, values)).slice(0, 200);

      return page(c, { title: `Email ${q.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { href: `/quotes/${q.id}`, label: q.ref }, { label: 'Email' }])}
        ${pageHeader(`Email quote ${q.ref}`, q.client_name ?? undefined)}

        ${addressWarning ? html`<div class="alert alert-warn">${addressWarning}</div>` : ''}

        ${configured
          ? ''
          /* It is still recorded, and sends as soon as a provider is set up. */
          : html`<div class="alert alert-warn">No outgoing mail provider is configured, so this
                   will be queued but not delivered — see Settings → Integrations.</div>`}

        ${'' /* Laid out the way every mail client lays this out: one column,
                 the addresses stacked at the top, the subject under them, then
                 the body filling the width with its toolbar attached to it.

                 It was on the ordinary three-column form grid, which is right
                 for entering a client's details and wrong for writing a
                 message: To sat in one column, Copy to and the message in the
                 second, the subject in a third, and the formatting buttons
                 floated on their own away from the box they act on. The
                 practice's words: "this is just ugly — I asked for a Gmail
                 style experience". */}
        <form method="post" action="/quotes/${q.id}/email/preview" class="compose js-compose">
          ${csrfField(csrf)}

          ${'' /* **The people already in the register, offered — not a second
                   place to keep addresses.** The practice's question is what
                   settled it: *"is this not a case that 99% of emails from the
                   system are to be sent to those who are already in the
                   register? if so - why create separate email register? should
                   we not be able to find the email that is already in the
                   system and the name of the person holding it?"*

                   A `<datalist>` rather than a widget, because the register
                   works with JavaScript switched off: with scripting on it is a
                   suggestion list, and with it off the box beside it is an
                   ordinary text input that still takes an address nobody has
                   ever written to. It is attached to the input rather than
                   replacing it for the same reason a `<select>` was wrong —
                   a list you cannot type past is a list that refuses a new
                   client's first email.

                   The `label` carries "Name — address" so the writer sees who
                   they are picking; the `value` is the bare address, which is
                   what lands in the box and what `FormReader.emails()` parses,
                   unchanged. */}
          ${recipients.length ? html`
            <datalist id="known-recipients">
              ${recipients.map((p) => html`
                <option value="${p.address}" label="${p.name} — ${p.address}"></option>`)}
            </datalist>` : ''}

          <div class="compose-headers">
            <div class="compose-row">
              <label for="f_to">To</label>
              <input id="f_to" name="to" type="text" required maxlength="2000"
                     value="${q.client_email ?? ''}" autocomplete="off"
                     ${recipients.length ? raw('list="known-recipients"') : ''}
                     placeholder="somebody@example.com">
            </div>
            <div class="compose-row">
              <label for="f_cc">Copy to</label>
              <input id="f_cc" name="cc" type="text" maxlength="2000" autocomplete="off"
                     ${recipients.length ? raw('list="known-recipients"') : ''}
                     placeholder="Separate several with commas">
            </div>
            <div class="compose-row">
              <label for="f_subject">Subject</label>
              <input id="f_subject" name="subject" required maxlength="200"
                     value="${subject}">
            </div>
          </div>

          ${recipients.length ? html`
            ${'' /* An address on nobody's record can still be typed in full; the
                     preview screen names it before anything is sent. */}
            <p class="hint">Start typing a name or an address to pick from the people the register
               already holds.</p>` : ''}

          <div class="compose-bar">
            <div class="compose-tools">
              <button type="button" class="btn btn-small btn-secondary" data-wrap="**" title="Bold"><b>B</b></button>
              <button type="button" class="btn btn-small btn-secondary" data-wrap="*" title="Italic"><i>I</i></button>
              <button type="button" class="btn btn-small btn-secondary" data-prefix="## " title="Heading">H</button>
              <button type="button" class="btn btn-small btn-secondary" data-prefix="- " title="Bulleted list">&bull; List</button>
              <button type="button" class="btn btn-small btn-secondary" data-prefix="1. " title="Numbered list">1. List</button>
            </div>
            ${'' /* **Asked for on 11 September 2026:** *"make the formatted version
                     of my email as a default when i want to email quotation and LoE,
                     can switch to plain text whenever needed."* Formatted is what the
                     letter is written for — the bold marks in it mean something — and
                     the plain text goes out alongside it either way, so a client whose
                     mail reader will not render HTML still gets a readable letter.
                     The choice also survives Back to edit now; it used to reset. */}
            <fieldset class="compose-format">
              <legend class="visually-hidden">Send as</legend>
              <label><input type="radio" name="format" value="html"
                            ${asHtml ? raw('checked') : ''}> Formatted</label>
              <label><input type="radio" name="format" value="text"
                            ${asHtml ? '' : raw('checked')}> Plain text</label>
            </fieldset>
          </div>

          <label class="visually-hidden" for="f_body">Message</label>
          <textarea id="f_body" name="body" rows="24" required maxlength="20000"
                    class="compose-body">${body}</textarea>

          ${'' /* Preview, never send, asked for on 11 September 2026: *"must
                   have PREVIEW page before it goes out with an additional send
                   button, so PREVIEW button and on the preview screen - send
                   button or go back to edit"*. Nothing leaves this screen. */}
          <div class="compose-actions">
            <button class="btn btn-primary" type="submit">Preview</button>
            <a class="btn btn-secondary" href="/quotes/${q.id}">Cancel</a>
            <label class="check"><input type="checkbox" name="mark_sent" checked>
              Mark this quote as sent</label>
          </div>

          ${'' /* Under the button, not between the writer and the box: it
                   explains a choice already made rather than one being made. */}
          <details class="compose-help">
            <summary>What “Formatted” does</summary>
            <p class="hint"><strong>Formatted</strong> sends an HTML version as well:
               <code>**bold**</code>, <code>*italic*</code>, <code>## heading</code>, lines
               starting <code>-</code> or <code>1.</code> for lists, and web addresses become
               links.</p>
          </details>
        </form>`);
    });

    /**
     * What the client will actually read, before anybody can send it.
     *
     * **Asked for on 11 September 2026:** *"must have PREVIEW page before it
     * goes out with an additional send button, so PREVIEW button and on the
     * preview screen - send button or go back to edit"*.
     *
     * Three things this page has to get right:
     *
     *  1. **It is the only way to the send route from the compose screen.** The
     *     compose form's button says Preview and posts here; nothing on it
     *     sends. A preview somebody can skip is decoration.
     *  2. **Going back must return what was written**, not the template again.
     *     The edited subject and body travel back as query parameters and the
     *     compose page prefers them over the draft it would otherwise make.
     *  3. **A misspelled placeholder is named, not merely visible.** It prints
     *     as written — the practice's choice, and the right one — and this page
     *     says which word is wrong and lists the real ones, because "why does
     *     my letter say {clietn_name}" is a worse way to find out.
     *
     * Nothing is written here. The page renders and forgets; the send route is
     * unchanged and still does the validating.
     */
    /**
     * Wind a test quotation back to a draft.
     *
     * Only ever a quotation marked test data. On a real one this would be
     * un-forming a contract, and the database refuses it outright — migrations
     * 0078 and 0079 freeze an accepted quotation, and 0083 exempts test data
     * alone. The check here is so the button is honest, not so the rule holds.
     */
    r.post('/:id/reopen', requirePermission('data:test'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();
      if (q.is_test !== 1) {
        return redirectWith(c, `/quotes/${id}`,
          'Only a quotation marked as test data can be unaccepted. A real one is answered '
          + 'with a new quotation.', 'err');
      }

      await run(
        c.env.DB,
        `UPDATE quotes
            SET accepted_at = NULL, accepted_name = NULL, accepted_from = NULL,
                status = 'draft', responded_at = NULL, sent_at = NULL, updated_at = ?
          WHERE id = ?`,
        nowIso(), id);
      await auditFrom(c, { action: 'quote.test_reopened', entityType: 'quote', entityId: id,
        meta: { ref: q.ref } });
      return redirectWith(c, `/quotes/${id}`,
        'Back to a draft. Send it and accept it as many times as you need.', 'ok');
    });

    r.post('/:id/email/preview', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id WHERE q.id = ?`, id);
      if (!q) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const to = f.text('to', { required: true, label: 'To', max: 2000 });
      const cc = f.optional('cc', { max: 2000 }) ?? '';
      const subject = f.text('subject', { required: true, label: 'Subject', max: 200 });
      const body = f.text('body', { required: true, label: 'Message', max: 20000 });
      const asHtml = f.text('format', { max: 10 }) === 'html';
      const markSent = f.bool('mark_sent') === 1;
      if (!f.valid) {
        return redirectWith(c, `/quotes/${id}/email`,
          Object.values(f.errors)[0] ?? 'Invalid message.', 'err');
      }

      const [practice, items, qs, strangers] = await Promise.all([
        practiceDetails(c.env), quoteLines(c.env, id), quoteSettings(c.env),
        // Which of these addresses the register does not hold on anybody.
        //
        // Split here only to ask the question — the addresses themselves are
        // parsed once, by `FormReader.emails()` on the send route, and that
        // parsing is untouched: it still refuses the whole list if one address
        // is bad, and it still accepts an address nobody has written to before.
        unrecognisedRecipients(c.env, [...to.split(/[,;]/), ...cc.split(/[,;]/)]),
      ]);
      const token = await shareTokenFor(c.env, id);
      const address = await publicBase(c.env, new URL(c.req.url).origin);
      const values = quoteEmailValues(
        q, practice, items, qs.capacityNote, token ? shareUrl(address.base, token) : '');
      const unknown = [
        ...unknownPlaceholders(subject, values), ...unknownPlaceholders(body, values),
      ].filter((v, i, all) => all.indexOf(v) === i);

      const csrf = c.get('session')!.csrf;
      // The offer to put an unknown address on a client record is only made to
      // somebody who could act on it. `mail:send` reaches this screen; writing
      // to the register is a separate permission.
      const canAddClient = can(c.get('user'), 'register:write');
      const carry = { to, cc, subject, body, format: asHtml ? 'html' : 'text',
                      ...(markSent ? { mark_sent: 'on' } : {}) };
      const backTo = `/quotes/${id}/email?subject=${encodeURIComponent(subject)}`
        + `&body=${encodeURIComponent(body)}`
        + `&format=${asHtml ? 'html' : 'text'}`;

      return page(c, { title: `Preview ${q.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' },
                       { href: `/quotes/${q.id}`, label: q.ref }, { label: 'Preview' }])}
        ${pageHeader(`Preview \u2014 ${q.ref}`, 'Nothing has been sent yet.')}

        ${unknown.length ? html`
          <div class="alert alert-warn">
            <strong>${unknown.length === 1 ? 'This word' : 'These words'} in braces
              ${unknown.length === 1 ? 'is not' : 'are not'} something the register can fill:</strong>
            ${unknown.map((name) => html`<code>{${name}}</code> `)}
            <div class="small mt-sm">${unknown.length === 1 ? 'It' : 'They'} will be sent to the
              client exactly as written.</div>
          </div>` : ''}

        ${'' /* The letter as the client reads it. Rendered by the same function
                 the email uses, so the words, the emphasis and the lists are
                 what will arrive; only the colours belong to this page. Said
                 plainly below rather than implied. */}
        <div class="cols">
          <div class="col-main">
            ${card('The message', html`
              <dl class="kv">
                <dt>To</dt><dd>${to}</dd>
                ${cc ? html`<dt>Copy to</dt><dd>${cc}</dd>` : ''}
                <dt>Subject</dt><dd><strong>${subject}</strong></dd>
                <dt>Sent as</dt><dd>${asHtml ? 'Formatted, with a plain-text copy' : 'Plain text'}</dd>
              </dl>
              ${'' /* **An address on nobody's record is named, not remembered.**
                       This is the other half of the practice's answer about a
                       separate email register: if the register does not know an
                       address, the fix is to put it on the record of the person
                       who holds it, so there is one name for it and one place
                       that name is kept. Storing it here instead would create
                       the second owner they said not to create.

                       Said before the send button rather than after it, because
                       at this point it is still a typo somebody can correct. */}
              ${strangers.length ? html`
                <p class="hint" data-unknown-recipients>
                  ${strangers.length === 1
                    ? 'This address is on nobody’s record in the register:'
                    : 'These addresses are on nobody’s record in the register:'}
                  ${join(strangers.map((a) => html`<strong>${a}</strong>${canAddClient ? html`
                    (<a href="/clients?q=${encodeURIComponent(a)}">find who holds it</a> or
                     <a href="/clients/new?email=${encodeURIComponent(a)}">add them as a client</a>)` : ''}`), '; ')}.
                  ${strangers.length === 1 ? 'It will still be sent.' : 'They will still be sent.'}
                </p>` : ''}
              <div class="email-preview">
                ${'' /* Plain text is previewed with the emphasis marks off, because
                         that is what the client will receive. Reported 11 September
                         2026: "what are the ** characters in the body?" */}
                ${asHtml ? renderRichText(body) : html`<pre class="prewrap-pre">${toPlainText(body)}</pre>`}
              </div>
              ${'' /* The colours belong to this page; the words, the bold and the
                       lists are the email's. */}
              <p class="hint">${asHtml
                ? 'Formatted exactly as it will be sent.'
                : 'Sent exactly as shown, as plain text.'}</p>`)}

            <div class="compose-actions">
              <form method="post" action="/quotes/${q.id}/email" class="inline-form">
                ${csrfField(csrf)}
                ${Object.entries(carry).map(([k, v]) => html`
                  <input type="hidden" name="${k}" value="${v}">`)}
                <button class="btn btn-primary" type="submit">Send it</button>
              </form>
              <a class="btn btn-secondary" href="${backTo}">Back to edit</a>
              <a class="btn btn-link-danger" href="/quotes/${q.id}">Cancel</a>
            </div>
            ${markSent ? html`<p class="hint">Sending will also mark the quotation as sent.</p>` : ''}
          </div>

          <div class="col-side">
            ${card('Words you can use in braces', html`
              <p class="small">Set the letter itself under
                 <a href="/settings#quotes">Settings \u2192 Quotes</a>. These are filled in from
                 this quotation:</p>
              <dl class="kv small">
                ${Object.keys(values).sort().map((name) => html`
                  <dt><code>{${name}}</code></dt>
                  <dd class="muted">${shorten((values[name] ?? '').split('\n')[0] ?? '')}</dd>`)}
              </dl>`)}
          </div>
        </div>`);
    });

    r.post('/:id/email', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const f = new FormReader(await c.req.formData());
      // Several addresses, comma or semicolon separated. Asked for on
      // 8 September 2026. One bad address refuses the whole list rather than
      // being dropped: a message the practice believes went to three people
      // and went to two is worse than one that did not send.
      const toList = f.emails('to', { required: true, label: 'To' });
      const cc = f.emails('cc', { label: 'Copy to' }).join(', ') || null;
      const to = toList.join(', ') || null;
      const subject = f.text('subject', { required: true, label: 'Subject', max: 200 });
      const body = f.text('body', { required: true, label: 'Message', max: 20000 });
      const asHtml = f.text('format', { max: 10 }) === 'html';
      const markSent = f.bool('mark_sent') === 1;
      if (!f.valid || !to) {
        return redirectWith(c, `/quotes/${id}/email`, Object.values(f.errors)[0] ?? 'Invalid message.', 'err');
      }

      // The plain text is sent either way. A formatted message is a multipart
      // one carrying both, so a client that cannot or will not render HTML
      // still gets a readable letter rather than a wall of markup.
      const outboundId = await queueEmail(c.env, {
        to, cc, subject, text: toPlainText(body),
        html: asHtml ? renderEmailHtml(body) : null,
        entityType: 'quote', entityId: id, createdBy: user.id,
      });

      if (markSent && q.status === 'draft') {
        await run(c.env.DB, `UPDATE quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`,
          q.sent_at ?? nowIso(), nowIso(), id);
      }
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'email_out',
        body: `Quote emailed to ${to}${cc ? ` (copy to ${cc})` : ''}.\n\nSubject: ${subject}`,
        createdBy: user.id });
      if (q.client_id) {
        await addEntry(c.env, { entityType: 'client', entityId: q.client_id, kind: 'email_out',
          body: `Quote ${q.ref} emailed to ${to}.`, createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.emailed', entityType: 'quote', entityId: id,
        meta: { to, outboundId, format: asHtml ? 'html' : 'text' } });

      // Try to deliver straight away; the daily job picks up anything left.
      const result = await flushQueue(c.env, 5);
      return redirectWith(c, `/quotes/${id}`,
        result.sent > 0
          ? `Quote emailed to ${to}.`
          : `Quote queued for ${to}. It will send once an email provider is configured.`);
    });

    r.get('/:id/edit', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const [clients, settings] = await Promise.all([
        clientOptions(c.env),
        moneySettings(c.env),
      ]);
      const csrf = c.get('session')!.csrf;

      // The stored figures are already net and GST, so present the treatment
      // that reproduces them rather than guessing what was originally typed.
      const treatment: GstTreatment = q.gst_cents > 0 ? 'exclusive' : 'none';

      return page(c, { title: `Edit ${q.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { href: `/quotes/${q.id}`, label: q.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${q.ref}`)}
        <form method="post" action="/quotes/${q.id}" class="form-grid" data-draft>
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>Who and what</h3>
            ${select({ label: 'Client', name: 'client_id', value: q.client_id ?? '', options: clients, includeBlank: 'No client yet' })}
            ${field({ label: 'Description', name: 'description', value: q.description, required: true, maxlength: 500 })}
          </div>
          <div class="form-section">
            <h3>Money</h3>
            ${field({ label: 'Professional fee', name: 'amount', value: (q.amount_cents / 100).toFixed(2), required: true,
                      hint: 'Enter it the way the GST treatment below describes.' })}
            ${select({ label: 'GST treatment', name: 'gst_treatment', value: treatment, includeBlank: false,
                       options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
            ${field({ label: 'Disbursements', name: 'disbursements', value: (q.disbursements_cents / 100).toFixed(2) })}
            ${field({ label: 'Valid until', name: 'valid_until', type: 'date', value: dateInputValue(q.valid_until) })}
            <p class="hint">GST is recalculated at the practice's current rate
               (${(settings.gstRateBp / 100).toFixed(2)}%).</p>
          </div>
          <div class="form-section">
            <h3>Notes</h3>
            ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 4, value: q.notes, maxlength: 4000 })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save changes</button>
            <a class="btn btn-secondary" href="/quotes/${q.id}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!existing) return c.notFound();

      const settings = await moneySettings(c.env);
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const description = f.text('description', { required: true, label: 'Description', max: 500 });
      const amount = f.money('amount', { required: true, label: 'Professional fee' });
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: settings.defaultTreatment })! as GstTreatment;
      const disbursements = f.money('disbursements') ?? 0;
      const validUntil = f.date('valid_until');
      const notes = f.optional('notes', { max: 4000 });
      if (!f.valid || amount === null) {
        return redirectWith(c, `/quotes/${id}/edit`, Object.values(f.errors)[0] ?? 'Invalid quote.', 'err');
      }

      const rateBp = settings.gstRegistered ? settings.gstRateBp : 0;
      const { net, gst } = computeGst(amount, treatment, rateBp);

      // A quotation on a matter is for that matter's client, and the matter
      // decides. Refused rather than silently corrected: somebody who picked a
      // different client on this form meant something, and it is either "this
      // is the wrong matter" or "this is the wrong client" — the register
      // cannot tell which, and guessing writes a contract naming the wrong
      // person.
      //
      // The database refuses it too, since migration 0075. This is here so the
      // message names the box rather than arriving as a 500.
      if (existing.case_id && clientId) {
        const matterClient = (await one<{ client_id: string }>(
          c.env.DB, 'SELECT client_id FROM cases WHERE id = ?', existing.case_id))?.client_id;
        if (matterClient && matterClient !== clientId) {
          return redirectWith(c, `/quotes/${id}/edit`,
            'This quotation is on a matter, so it is for that matter\u2019s client. '
              + 'Take the matter off it first if it should be for somebody else.', 'err');
        }
      }

      await run(
        c.env.DB,
        `UPDATE quotes SET client_id = ?, description = ?, amount_cents = ?, gst_cents = ?,
           disbursements_cents = ?, valid_until = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        clientId || null, description, net, gst, disbursements, validUntil, notes, nowIso(), id,
      );

      const before = existing.amount_cents + existing.gst_cents + existing.disbursements_cents;
      const after = net + gst + disbursements;
      if (before !== after) {
        await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
          body: `Quote total changed from ${money(before, existing.currency)} to ${money(after, existing.currency)}.`,
          createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.updated', entityType: 'quote', entityId: id,
        meta: { before, after } });
      return redirectWith(c, `/quotes/${id}`, 'Quote updated.');
    });

    /**
     * Make this quotation's shape the one every new quotation starts from.
     *
     * **Asked for on 9 September 2026:** *"I would like to have its stems to be
     * a default template for all, without the money figures, so each new one
     * can be adjusted with ease."*
     *
     * The wording and the GST treatment are copied; no amount is. What it
     * writes is the two settings under Quotes, so the practice can read what
     * they have captured and edit it there without pressing this again.
     */
    r.post('/:id/template', requirePermission('admin:settings'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<{ ref: string }>(c.env.DB, 'SELECT ref FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const saved = await saveTemplateFrom(c.env, id);
      if (saved.lines === 0 && saved.stages === 0) {
        return redirectWith(c, `/quotes/${id}`,
          'That quotation has no lines or stages to take a shape from.', 'err');
      }
      await auditFrom(c, { action: 'quote.template_saved', entityType: 'quote', entityId: id,
        meta: { ref: q.ref, lines: saved.lines, stages: saved.stages } });
      return redirectWith(c, `/quotes/${id}`,
        `New quotations will start from ${q.ref}: ${saved.lines} line(s) and `
        + `${saved.stages} stage(s), with no amounts. Edit it under Settings → Quotes.`);
    });

    r.post('/:id/status', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', QUOTE_STATUSES, { required: true });
      if (!status) return redirectWith(c, `/quotes/${id}`, 'Unknown status.', 'err');

      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      await run(
        c.env.DB,
        `UPDATE quotes SET status = ?, sent_at = ?, responded_at = ?, updated_at = ? WHERE id = ?`,
        status,
        status === 'sent' ? (q.sent_at ?? nowIso()) : q.sent_at,
        status === 'accepted' || status === 'declined' ? (q.responded_at ?? nowIso()) : q.responded_at,
        nowIso(), id,
      );
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
        body: `Quote ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`, createdBy: user.id });
      if (q.client_id) {
        await addEntry(c.env, { entityType: 'client', entityId: q.client_id, kind: 'system',
          body: `Quote ${q.ref} ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`, createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.status_changed', entityType: 'quote', entityId: id, meta: { status } });
      return redirectWith(c, `/quotes/${id}`, `Quote marked ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`);
    });

    /** Turn an accepted quote into fee lines on its case. */

    // --- Quote lines --------------------------------------------------------

    /** Answer, or change the answer to, the letter question. */
    r.post('/:id/letter', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const choice = f.enum('with_letter', ['0', '1'] as const, { required: true,
        label: 'Whether a letter of engagement goes with this quotation' });
      if (!f.valid) {
        return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0]!, 'err');
      }
      await run(c.env.DB, 'UPDATE quotes SET with_letter = ?, updated_at = ? WHERE id = ?',
        choice === '1' ? 1 : 0, nowIso(), id);
      await auditFrom(c, { action: 'quote.letter_choice', entityType: 'quote', entityId: id,
        meta: { withLetter: choice === '1' } });
      return redirectWith(c, `/quotes/${id}`,
        choice === '1' ? 'This quotation goes out with a letter of engagement.'
                       : 'This quotation goes out on its own.');
    });

    r.post('/:id/items', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const fees = await moneySettings(c.env);
      const qs = await quoteSettings(c.env);
      const form = await c.req.formData();
      const f = new FormReader(form);

      // The same route both adds a line and saves edits to the existing ones,
      // because both end in exactly the same place: recalculate the lines, then
      // bring the quote's header totals back into step with them.
      if (form.get('_action') === 'save') {
        const existing = await quoteLines(c.env, id);
        const problems: string[] = [];
        let removed = 0;

        for (const line of existing) {
          if (form.get(`remove_${line.id}`)) {
            await run(c.env.DB, 'DELETE FROM quote_items WHERE id = ? AND quote_id = ?', line.id, id);
            removed += 1;
            continue;
          }

          const description = String(form.get(`description_${line.id}`) ?? '').trim().slice(0, 300);
          const quantity = parseQuantityToMilli(String(form.get(`quantity_${line.id}`) ?? ''));
          const unitAmount = parseMoneyToCents(String(form.get(`amount_${line.id}`) ?? ''));
          const kind = FEE_KINDS.includes(String(form.get(`kind_${line.id}`)) as never)
            ? String(form.get(`kind_${line.id}`)) : line.kind;
          const treatment = GST_TREATMENTS.includes(String(form.get(`gst_${line.id}`)) as never)
            ? String(form.get(`gst_${line.id}`)) : line.gst_treatment;
          const positionRaw = Number(String(form.get(`position_${line.id}`) ?? ''));
          const position = Number.isFinite(positionRaw) ? Math.max(0, Math.trunc(positionRaw)) : line.position;

          // A line that cannot be read is left exactly as it was rather than
          // being written half-changed or silently dropped — and, unlike the
          // payment stages before 11 September 2026, it is *said*: the message
          // below names every line it skipped. That naming is the whole
          // difference between this being a safe default and the trap the
          // stages had, where the same silence collided with the budget
          // refusal and the practice could not see why a schedule would not
          // come down.
          if (!description || quantity === null || unitAmount === null) {
            problems.push(line.description);
            continue;
          }

          const gstRateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
          const amounts = computeLine({
            quantityMilli: quantity, unitAmountCents: unitAmount,
            gstTreatment: (fees.gstRegistered ? treatment : 'none') as GstTreatment, gstRateBp,
          });
          await run(
            c.env.DB,
            `UPDATE quote_items SET position = ?, description = ?, kind = ?, unit_label = ?,
                quantity_milli = ?, unit_amount_cents = ?, gst_treatment = ?, gst_rate_bp = ?,
                net_cents = ?, gst_cents = ?, gross_cents = ?, updated_at = ?
              WHERE id = ? AND quote_id = ?`,
            position, description, kind,
            unitFrom(form.get(`unit_${line.id}`), line.unit_label),
            quantity, unitAmount, fees.gstRegistered ? treatment : 'none', gstRateBp,
            amounts.netCents, amounts.gstCents, amounts.grossCents, nowIso(), line.id, id,
          );
        }

        const totals = await refreshQuoteTotals(c.env, id);
        await auditFrom(c, { action: 'quote.lines_saved', entityType: 'quote', entityId: id,
          meta: { removed, rejected: problems.length, total: totals.totalCents } });

        return problems.length
          ? redirectWith(c, `/quotes/${id}`,
              `Saved, except ${problems.length} line(s) with a quantity or price that could not be `
              + `read: ${problems.join('; ')}. Those lines are unchanged. An empty box is not nil `
              + '\u2014 type 0 to set one to nothing.', 'err')
          : redirectWith(c, `/quotes/${id}`, removed ? `Saved. ${removed} line(s) removed.` : 'Lines saved.');
      }

      const description = f.text('description', { required: true, label: 'Description', max: 300 });
      const unitAmount = f.money('unit_amount', { required: true, label: 'Price per unit' });
      const quantity = parseQuantityToMilli(f.text('quantity', { max: 10 }) || '1');
      const kind = f.enum('kind', FEE_KINDS, { fallback: 'professional' })!;
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!;
      // One box, two kinds of answer. A "type:" value is a kind of work from the
      // vocabulary and goes in `case_type`; anything else is a catalogue row.
      // Kept apart in the database rather than sharing one column, because the
      // letter's clauses are chosen from the first and would never match the
      // second — which is exactly the bug 0074 fixed.
      const chosen = f.optional('service_item_id', { max: 80 });
      const caseTypeChosen = chosen?.startsWith('type:') ? chosen.slice(5) : null;
      const serviceItemId = caseTypeChosen ? null : chosen;
      if (!f.valid) return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0]!, 'err');
      if (quantity === null) {
        return redirectWith(c, `/quotes/${id}`, 'Give the quantity as a number, e.g. 1, 2 or 0.25.', 'err');
      }

      // The rate is stamped on the line, not looked up later, so reopening an
      // old quote shows the arithmetic that was actually sent.
      const gstRateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
      const amounts = computeLine({
        quantityMilli: quantity, unitAmountCents: unitAmount!,
        gstTreatment: fees.gstRegistered ? treatment : 'none', gstRateBp,
      });

      const nextPosition = await count(c.env.DB,
        'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quote_items WHERE quote_id = ?', id);
      const now = nowIso();
      await run(
        c.env.DB,
        `INSERT INTO quote_items (id, quote_id, position, service_item_id, case_type, description, kind, unit_label,
            quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
            net_cents, gst_cents, gross_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('qit'), id, nextPosition, serviceItemId || null, caseTypeChosen, description, kind,
        unitFrom(form.get('unit_label'), qs.defaultUnitLabel),
        quantity, unitAmount, fees.gstRegistered ? treatment : 'none', gstRateBp,
        amounts.netCents, amounts.gstCents, amounts.grossCents, now, now,
      );

      const totals = await refreshQuoteTotals(c.env, id);
      await auditFrom(c, { action: 'quote.line_added', entityType: 'quote', entityId: id,
        meta: { description, total: totals.totalCents } });
      return redirectWith(c, `/quotes/${id}`, `Added “${description}”.`);
    });

    r.post('/:id/items/:itemId/remove', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      await run(c.env.DB, 'DELETE FROM quote_items WHERE id = ? AND quote_id = ?', c.req.param('itemId')!, id);
      await refreshQuoteTotals(c.env, id);
      await auditFrom(c, { action: 'quote.line_removed', entityType: 'quote', entityId: id });
      return redirectWith(c, `/quotes/${id}`, 'Line removed.');
    });

    /**
     * Set the date of issue and how long the quote stands.
     *
     * Both are stored on the quote rather than read from settings at print
     * time: a quote already given to a client promised a particular date, and
     * changing the practice's default afterwards must not silently rewrite it.
     */
    r.post('/:id/issue', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const qs = await quoteSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const issuedOn = f.date('issued_on') ?? nowIso().slice(0, 10);
      const days = f.int('validity_days', { min: 1, max: 365 }) ?? qs.validityDays;
      if (!f.valid) return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0]!, 'err');

      const until = validUntil(issuedOn, days);
      await run(
        c.env.DB,
        'UPDATE quotes SET issued_on = ?, validity_days = ?, valid_until = ?, updated_at = ? WHERE id = ?',
        issuedOn, days, until, nowIso(), id,
      );
      await auditFrom(c, { action: 'quote.validity_set', entityType: 'quote', entityId: id,
        meta: { issuedOn, days, until } });
      return redirectWith(c, `/quotes/${id}`, `Valid until ${until}.`);
    });


    // --- The people on the engagement ---------------------------------------

    /**
     * Add somebody to the quotation, or save the ones already on it.
     *
     * One route for both, like the lines and the stages above: the page shows
     * the list and an add form, and whichever was submitted arrives here.
     *
     * Almost nothing is checked in this handler. A blank name, a birthday on a
     * company, a date of birth in the future, an administrative contact with no
     * way to reach them, two people nominated to instruct — every one of those
     * is refused by the database (migration 0065), because this is not the only
     * thing that will ever write these rows: acceptance will, and so will
     * whatever creates a quotation from an inquiry. What is here is the reading
     * of the form and the message a person sees when the refusal comes back.
     */
    r.post('/:id/parties', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT id FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();
      const form = await c.req.formData();
      const now = nowIso();

      // A refusal from a trigger is a sentence written for the practice. It is
      // shown as it stands rather than replaced with "could not save", which
      // is the message that sends somebody to the developer.
      const said = (err: unknown): string => {
        const text = err instanceof Error ? err.message : String(err);
        const at = text.indexOf(': ');
        return (at >= 0 ? text.slice(at + 2) : text).trim() || 'That could not be saved.';
      };

      if (form.get('_action') === 'save') {
        const existing = await quoteParties(c.env, id);
        const problems: string[] = [];
        let removed = 0;

        for (const party of existing) {
          if (form.get(`remove_${party.id}`)) {
            await run(c.env.DB, 'DELETE FROM quote_parties WHERE id = ? AND quote_id = ?', party.id, id);
            removed += 1;
            continue;
          }
          const g = (name: string) => String(form.get(`${name}_${party.id}`) ?? '').trim();
          const role = QUOTE_PARTY_ROLES.includes(g('role') as never)
            ? g('role') as QuotePartyRole : party.role;
          const kind = QUOTE_PARTY_KINDS.includes(g('kind') as never)
            ? g('kind') as QuotePartyKind : party.kind;
          const positionRaw = Number(g('position'));
          try {
            await run(
              c.env.DB,
              `UPDATE quote_parties
                  SET position = ?, role = ?, kind = ?, full_name = ?, relationship = ?,
                      date_of_birth = ?, organisation = ?, email = ?, phone = ?,
                      is_representative = ?, updated_at = ?
                WHERE id = ? AND quote_id = ?`,
              Number.isFinite(positionRaw) ? Math.max(0, Math.trunc(positionRaw)) : party.position,
              role, kind, g('full_name').slice(0, 200),
              g('relationship').slice(0, 60) || null,
              kind === 'organisation' ? null : (g('date_of_birth').slice(0, 10) || null),
              g('organisation').slice(0, 200) || null,
              g('email').slice(0, 200) || null,
              g('phone').slice(0, 60) || null,
              form.get(`representative_${party.id}`) ? 1 : 0,
              now, party.id, id,
            );
          } catch (err) {
            problems.push(`${party.full_name || 'a party'}: ${said(err)}`);
          }
        }

        await auditFrom(c, { action: 'quote.parties_saved', entityType: 'quote', entityId: id,
          meta: { removed, rejected: problems.length } });
        return problems.length
          ? redirectWith(c, `/quotes/${id}`, problems[0]!, 'err')
          : redirectWith(c, `/quotes/${id}`,
              removed ? `Saved. ${removed} removed.` : 'The people on this quotation are saved.');
      }

      const f = new FormReader(form);
      const fullName = f.text('full_name', { required: true, label: 'Name', max: 200 });
      const role = f.enum('role', QUOTE_PARTY_ROLES, { fallback: 'associated' })!;
      const kind = f.enum('kind', QUOTE_PARTY_KINDS, { fallback: 'person' })!;
      if (!f.valid) {
        return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0] ?? 'Give them a name.', 'err');
      }

      const position = await count(c.env.DB,
        'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quote_parties WHERE quote_id = ?', id);
      try {
        await run(
          c.env.DB,
          `INSERT INTO quote_parties (id, quote_id, position, role, kind, full_name, relationship,
              date_of_birth, organisation, email, phone, is_representative, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          newId('qp'), id, position, role, kind, fullName,
          f.optional('relationship', { max: 60 }),
          kind === 'organisation' ? null : f.optional('date_of_birth', { max: 10 }),
          f.optional('organisation', { max: 200 }),
          f.optional('email', { max: 200 }),
          f.optional('phone', { max: 60 }),
          f.checkbox('is_representative') ? 1 : 0,
          now, now,
        );
      } catch (err) {
        return redirectWith(c, `/quotes/${id}`, said(err), 'err');
      }

      await auditFrom(c, { action: 'quote.party_added', entityType: 'quote', entityId: id,
        meta: { role, kind } });
      return redirectWith(c, `/quotes/${id}`, `${fullName} added to this quotation.`);
    });

    // --- Payment stages -----------------------------------------------------

    /** Add one stage, or save edits to all of them. */
    r.post('/:id/stages', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(
        c.env.DB,
        `SELECT id, currency, amount_cents, gst_cents, disbursements_cents
           FROM quotes WHERE id = ?`, id);
      if (!q) return c.notFound();
      // What there is to divide up: the figure printed as Total payable.
      const budget = quoteTotal(q);

      const fees = await moneySettings(c.env);
      const form = await c.req.formData();
      const now = nowIso();

      const figures = (amountCents: number, treatment: GstTreatment) => {
        const rateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
        const gst = computeGst(amountCents, fees.gstRegistered ? treatment : 'none', rateBp);
        return { rateBp, net: gst.net, gstCents: gst.gst, gross: gst.gross };
      };

      if (form.get('_action') === 'save') {
        const existing = await quoteStages(c.env, id);
        const problems: string[] = [];

        // Read the whole form before writing any of it.
        //
        // Two reasons, and the second is the one that bites. The obvious one is
        // that a schedule which would come to more than the quotation should be
        // refused whole rather than half-applied. The other is that the
        // database refuses each *row* that takes the total over — so a
        // rebalance that is perfectly correct at the end can be refused in the
        // middle of itself. Moving $1,000 from the last stage to the first, row
        // by row, briefly asks for $1,000 more than the quotation.
        //
        // So: work out the intended schedule, check it, then take every stage
        // to nil and build it back up. The sum only ever rises towards a figure
        // already known to fit, and the schedule the practice typed is the
        // schedule that gets written.
        const removing = existing.filter((s) => form.get(`remove_${s.id}`));
        const keeping = existing.filter((s) => !form.get(`remove_${s.id}`));
        const planned = keeping.map((stage) => {
          const description = String(form.get(`description_${stage.id}`) ?? '').trim().slice(0, 500);
          const amount = parseMoneyToCents(String(form.get(`amount_${stage.id}`) ?? ''));
          if (!description || amount === null) {
            problems.push(stage.label || stage.description);
            // Counted at its old figure only so the refusal below can be
            // written; nothing is saved while `problems` has anything in it.
            return { stage, keepAsIs: true as const, gross: stage.gross_cents };
          }
          const treatment = (GST_TREATMENTS.includes(String(form.get(`gst_${stage.id}`)) as never)
            ? String(form.get(`gst_${stage.id}`)) : stage.gst_treatment) as GstTreatment;
          const positionRaw = Number(String(form.get(`position_${stage.id}`) ?? ''));
          const f2 = figures(amount, treatment);
          return {
            stage,
            keepAsIs: false as const,
            gross: f2.gross,
            position: Number.isFinite(positionRaw)
              ? Math.max(0, Math.trunc(positionRaw)) : stage.position,
            label: String(form.get(`label_${stage.id}`) ?? '').trim().slice(0, 40),
            description, amount, treatment: fees.gstRegistered ? treatment : 'none',
            rateBp: f2.rateBp, net: f2.net, gstCents: f2.gstCents,
          };
        });

        const intended = planned.reduce((sum, p) => sum + p.gross, 0);
        const current = existing.reduce((sum, stage) => sum + stage.gross_cents, 0);

        // **Reported on 11 September 2026:** *"i am trying to adjust the bottom
        // to make it match but it does not let me."*
        //
        // Because an empty amount box quietly put the old amount back. A blank
        // read as `null`, the stage was written back exactly as it was, and its
        // old figure still counted towards the total — so a practice clearing
        // three boxes to bring an $11,382.70 schedule down to $3,959.40 was
        // told the schedule came to more than the quotation, with no hint that
        // the boxes they had emptied had been refilled behind them. The
        // "saved, except N stages" line that would have said so came *after*
        // the budget refusal, and never ran.
        //
        // An empty box is now a refusal that names the stage, and it is checked
        // first — because a total that includes a figure nobody typed is not a
        // total worth arguing about.
        if (problems.length) {
          const names = problems.join(', ');
          return redirectWith(c, `/quotes/${id}`,
            problems.length === 1
              ? `${names} has no amount the register can read, so nothing was saved. `
                + 'An empty box is not nil \u2014 type 0 to set a stage to nothing.'
              : `${problems.length} stages have no amount the register can read (${names}), so `
                + 'nothing was saved. An empty box is not nil \u2014 type 0 to set a stage to '
                + 'nothing.', 'err');
        }

        if (intended > budget) {
          // Nothing is written, so the schedule on the page is still the one
          // that was there before. **Said explicitly on 9 September 2026**,
          // when the practice saw this message over a schedule showing a third
          // figure and asked why there were two warnings: the refusal talks
          // about what was typed, the warning underneath the schedule talks
          // about what is saved, and without a sentence joining them the two
          // read as the register contradicting itself.
          return redirectWith(c, `/quotes/${id}`,
            `That schedule comes to ${money(intended, q.currency)}, which is `
            + `${money(intended - budget, q.currency)} more than the quotation's `
            + `${money(budget, q.currency)}. Nothing was saved, so the schedule below still shows `
            + `the ${money(current, q.currency)} it was at. A schedule divides up the fees and `
            + 'disbursements; it cannot add to them.', 'err');
        }

        for (const stage of removing) {
          await run(c.env.DB, 'DELETE FROM quote_stages WHERE id = ? AND quote_id = ?', stage.id, id);
        }
        const removed = removing.length;

        // Down to nil first. See the note above: this is what stops a correct
        // rebalance being refused halfway through itself.
        await run(
          c.env.DB,
          `UPDATE quote_stages SET amount_cents = 0, net_cents = 0, gst_cents = 0, gross_cents = 0
             WHERE quote_id = ?`, id);

        for (const p of planned) {
          // Unreachable: an unreadable amount refused the whole save above.
          // Kept as an assertion rather than deleted, because the type still
          // allows it and a silent write-back is the fault this replaced.
          if (p.keepAsIs) throw new Error('a stage with an unreadable amount reached the write');
          await run(
            c.env.DB,
            `UPDATE quote_stages SET position = ?, label = ?, description = ?, amount_cents = ?,
                gst_treatment = ?, gst_rate_bp = ?, net_cents = ?, gst_cents = ?, gross_cents = ?,
                updated_at = ? WHERE id = ? AND quote_id = ?`,
            p.position, p.label, p.description, p.amount, p.treatment, p.rateBp,
            p.net, p.gstCents, p.gross, now, p.stage.id, id,
          );
        }

        await run(c.env.DB, 'UPDATE quotes SET stage_note = ?, updated_at = ? WHERE id = ?',
          String(form.get('stage_note') ?? '').trim().slice(0, 1000) || null, now, id);
        await auditFrom(c, { action: 'quote.stages_saved', entityType: 'quote', entityId: id,
          meta: { removed, rejected: problems.length } });

        return redirectWith(c, `/quotes/${id}`,
          removed ? `Saved. ${removed} stage(s) removed.` : 'Stages saved.');
      }

      const f = new FormReader(form);
      const description = f.text('description', { required: true, label: 'Description', max: 500 });
      const amount = f.money('amount', { required: true, label: 'Amount' });
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!;
      if (!f.valid || amount === null) {
        return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0] ?? 'Give the stage an amount.', 'err');
      }

      const position = await count(c.env.DB,
        'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quote_stages WHERE quote_id = ?', id);
      const fig = figures(amount, treatment);

      // The database refuses this outright — see migration 0077 — but a refusal
      // surfaces as an error page, and this is a form somebody is standing in
      // front of. Said here in the figures they are looking at.
      const already = await count(c.env.DB,
        'SELECT COALESCE(SUM(gross_cents), 0) AS n FROM quote_stages WHERE quote_id = ?', id);
      if (fig.gross > 0 && already + fig.gross > budget) {
        const left = Math.max(0, budget - already);
        return redirectWith(c, `/quotes/${id}`,
          left === 0
            ? `The quotation's ${money(budget, q.currency)} is already fully allocated. `
              + 'Lower a stage first, or add the work to the items.'
            : `That stage would take the schedule past the quotation. There is `
              + `${money(left, q.currency)} left to allocate.`, 'err');
      }
      await run(
        c.env.DB,
        `INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
            gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('qst'), id, position, f.optional('label', { max: 40 }) ?? '', description, amount,
        fees.gstRegistered ? treatment : 'none', fig.rateBp, fig.net, fig.gstCents, fig.gross, now, now,
      );
      await auditFrom(c, { action: 'quote.stage_added', entityType: 'quote', entityId: id,
        meta: { description } });
      return redirectWith(c, `/quotes/${id}`, 'Stage added.');
    });

    /**
     * A first draft of the schedule, one stage per item.
     *
     * A starting point, not an answer: most practices split the professional
     * work into a deposit and a balance, which is a judgement about this client
     * and this matter. Getting the wording and the figures onto the page is the
     * tedious part, and this does that.
     */
    r.post('/:id/stages/generate', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const existing = await quoteStages(c.env, id);
      if (existing.length > 0) {
        return redirectWith(c, `/quotes/${id}`, 'This quote already has stages — edit those instead.', 'err');
      }
      const lines = await quoteLines(c.env, id);
      if (lines.length === 0) return redirectWith(c, `/quotes/${id}`, 'Add some items first.', 'err');

      const now = nowIso();
      let n = 0;
      for (const line of lines) {
        n += 1;
        const due = line.kind === 'professional'
          ? 'due when this part is performed'
          : 'due when the application is ready for lodgement';
        await run(
          c.env.DB,
          `INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
              gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          newId('qst'), id, n - 1, `Stage ${n}`,
          `${line.description} — ${due}.`,
          line.unit_amount_cents * (line.quantity_milli / 1000),
          line.gst_treatment, line.gst_rate_bp,
          line.net_cents, line.gst_cents, line.gross_cents, now, now,
        );
      }
      await auditFrom(c, { action: 'quote.stages_generated', entityType: 'quote', entityId: id, meta: { stages: n } });
      return redirectWith(c, `/quotes/${id}`, `Drafted ${n} stage(s). Reword them to suit the matter.`);
    });

    r.post('/:id/invoice', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const raw0 = Number(f.optional('term_days', { max: 4 }) ?? '7');
      const termDays = Number.isFinite(raw0) ? Math.max(0, Math.min(365, Math.round(raw0))) : 7;

      const result = await invoiceFromQuote(c.env, id, c.get('user')!.id, { termDays });
      if (!result.ok) return redirectWith(c, `/quotes/${id}`, result.message, 'err');

      await auditFrom(c, { action: 'quote.invoiced', entityType: 'quote', entityId: id,
        meta: { invoice: result.ref } });
      return redirectWith(c, `/invoices/${result.id}`,
        `${result.ref} raised as a draft. Check it, then issue it.`, 'ok');
    });

    app.route('/quotes', r);
  },
};

/* ---------------------------------------------------------------------------
 * The two documents, in one place each.
 *
 * **Split out on 9 September 2026**, so that a client reading their quotation
 * at a private link reads the *same* document the practice prints — not a
 * second rendering of it. These are contracts. Two templates for one contract
 * is the "one fact, one owner" rule broken in the place it matters most: they
 * would agree the day they were written and drift the first time only one of
 * them was corrected.
 *
 * Each is a loader and a renderer. The loader gathers what the document needs
 * and answers `null` for a quotation that is not there; the renderer takes that
 * and a footer, which is the one part that genuinely differs — the practice
 * gets Print and Back, the client gets the acceptance panel.
 * ------------------------------------------------------------------------ */

/** Blank lines separate paragraphs; a line starting "- " is a bullet. */
function prose(body: string): Raw {
  const blocks = body.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return html`${blocks.map((block) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.every((line) => line.startsWith('- '))
      ? html`<ul>${lines.map((line) => html`<li>${emphasise(line.slice(2))}</li>`)}</ul>`
      : html`<p>${emphasise(lines.join(' '))}</p>`;
  })}`;
}

export async function loadLetter(env: Env, id: string) {
    const q = await one<QuoteRow & { client_name: string | null; client_phone: string | null;
                                     client_email: string | null; case_ref: string | null }>(
      env.DB,
      `SELECT q.*, cl.full_name AS client_name, cl.phone AS client_phone,
              cl.email AS client_email, k.ref AS case_ref
         FROM quotes q
         LEFT JOIN clients cl ON cl.id = q.client_id
         LEFT JOIN cases k ON k.id = q.case_id
        WHERE q.id = ?`,
      id,
    );
    if (!q) return null;

    const [practice, text, lines, parties, types] = await Promise.all([
      practiceDetails(env), engagementText(env), quoteLines(env, id),
      quoteParties(env, id), caseTypes(env),
    ]);

    // Which clauses belong on this letter depends on the work, and the work
    // is the quotation's. A quotation covering more than one kind of matter
    // gets the clauses of all of them — see `clausesFor`.
    // Every kind of work on the quotation, from all three places one can be
    // recorded — and the union, not one instead of the others.
    //
    // This read the matter's type *or* the lines', never both, so a quotation
    // covering a partnership residence application and a dependent child got
    // the clauses of whichever branch won. The comment above it promised the
    // opposite. Found by Fable's audit, 8 September 2026.
    //
    // `quotes.case_type` is the third, added by 0075: the New quote form asked
    // for the kind of work and then threw it away, so a quotation with no
    // matter and no case-type line had none recorded anywhere and printed
    // with no work-specific clauses at all.
    const kinds = [...new Set([
      q.case_type,
      q.case_id
        ? (await one<{ case_type: string }>(
            env.DB, 'SELECT case_type FROM cases WHERE id = ?', q.case_id))?.case_type ?? null
        : null,
      ...lines.map((l) => l.case_type),
    ].filter(Boolean))] as string[];
    const clauses = await clausesFor(env, kinds);

    const issuedOn = q.issued_on ?? q.created_at.slice(0, 10);
    const representative = parties.find((p) => p.is_representative === 1) ?? null;
  return { q, practice, text, clauses, issuedOn, representative };
}

export function letterArticle(
  d: NonNullable<Awaited<ReturnType<typeof loadLetter>>>, footer: Raw,
): Raw {
  const { q, practice, text, clauses, issuedOn, representative } = d;
  return html`
        <article class="quote-doc letter-doc">
          <header class="quote-doc-head">
            <div>
              <h1>${practice.legalName}</h1>
              ${practice.adviserDetails ? html`<p class="prewrap small">${practice.adviserDetails}</p>` : ''}
              ${practice.postalAddress ? html`<p class="prewrap small">${practice.postalAddress}</p>` : ''}
              <p class="small">
                ${practice.contactPhone ? html`Mobile: ${practice.contactPhone}<br>` : ''}
                ${practice.contactEmail ? html`Email: ${practice.contactEmail}<br>` : ''}
                ${practice.gstNumber ? html`GST: ${practice.gstNumber}` : ''}
              </p>
            </div>
            <div class="quote-doc-ref">
              ${'' /* No "Letter of engagement" label here, removed on the
                     practice's instruction of 9 September 2026. The document
                     says what it is twice over — the RE: line names it, and the
                     rule further down heads the terms — and a third label in the
                     corner only competed with the practice's own name beside
                     it, which is the thing a reader should see first. */}
              <dl class="quote-doc-meta">
                <dt>Date</dt><dd>${dateShort(issuedOn)}</dd>
                <dt>Our Ref</dt><dd class="strong">${q.ref}</dd>
                ${q.case_ref ? html`<dt>Matter</dt><dd>${q.case_ref}</dd>` : ''}
              </dl>
            </div>
          </header>

          ${'' /* To whom, and how they are being written to.

                 **No postal address, by the practice's instruction of
                 9 September 2026:** *"The address is not required - it should
                 only have email and phone number."* It is a letter that goes by
                 email, to clients who are often between addresses — one of them
                 read "Summer Place (joint tenancy address; full address not
                 stated)", which is a note to the file rather than an address,
                 printed on a contract. How to reach somebody is what this block
                 is for. */}
          <section class="letter-to">
            ${'' /* "FOR:" rather than a bare name, asked for on 9 September
                   2026. The block sits under the practice's own contact details
                   and above the client's, and a name on its own between two sets
                   of contact details does not say which of them it belongs to.
                   Two characters settle it. */}
            <p class="strong">FOR: ${q.client_name ?? '—'}</p>
            ${q.client_email ? html`<p class="small">By email: ${q.client_email}</p>` : ''}
            ${'' /* "Mobile", not "Telephone": what the register holds for a
                   client is the number they answer, and every one of them is a
                   mobile. Asked for on 9 September 2026. */}
            ${q.client_phone ? html`<p class="small">Mobile: ${q.client_phone}</p>` : ''}
          </section>

          ${text.subject ? html`<p class="letter-re"><strong>RE: ${text.subject}</strong></p>` : ''}

          ${'' /* The salutation, which the letter had never had. Asked for on
                 9 September 2026: *"the letter of engagement must start with
                 'Dear CLIENT'S FULL NAME,'"*. It opened straight into "I am
                 pleased to act for you" under a bare name, which reads as a
                 form rather than as a letter from a person.

                 The full name as the register holds it, so it matches the name
                 the client signs under and the name on the quotation beside it.
                 A client with no name recorded cannot be greeted, so the line
                 is left out rather than printing "Dear ,". */}
          ${q.client_name ? html`<p class="letter-salutation">Dear ${q.client_name},</p>` : ''}

          ${text.configured
            ? prose(text.opening)
            : html`<p class="alert alert-error">This letter has no wording yet. It is set under
                     Settings → Letter of engagement, and the clauses under Quotes → Letter
                     clauses. Nothing is supplied by the register: the words a client is asked to
                     accept are the practice's own.</p>`}

          ${'' /* Where the covering letter ends and the terms begin.

                 **Asked for on 9 September 2026**, with a line drawn across a
                 screenshot at exactly this point: everything above is the
                 covering letter, everything below is the practice's short-form
                 terms. Two documents on one page, and nothing said where one
                 stopped.

                 It matters beyond tidiness, because the letter points at a
                 *second* set of terms — the Standard Terms of Engagement,
                 published at a web address further down. A client who cannot
                 see that the page in their hand is itself a set of terms has no
                 way to tell the two apart. */}
          ${text.termsTitle ? html`
            <div class="letter-terms-start">
              <h2>${text.termsTitle}</h2>
              ${text.termsSubtitle ? html`<p class="small">${text.termsSubtitle}</p>` : ''}
            </div>` : ''}

          ${'' /* The one thing the letter says about the work: where to find it.
                   The quotation carries the parties, the scope and the fees, and
                   is attached. The heading names all four, at the practice's
                   choice of 9 September 2026 — "the work" was too narrow for a
                   document that also settles who the parties are and when the
                   money falls due. */}
          <section class="letter-brief">
            <h3>The Parties, the Scope of Work, the Fees (Legal and Disbursements)
                and the Payment Terms</h3>
            ${'' /* "Quotation" capitalised: the opening defines it as a term
                   ("the \"Quotation\"") and a defined term is capitalised
                   wherever it appears. Asked for on 9 September 2026. */}
            <p>These are set out in <strong>Quotation ${q.ref}</strong>, which accompanies this
               letter and forms part of it${representative
                 ? html`, and in which <strong>${representative.full_name}</strong> is nominated to
                        give instructions on behalf of all parties named`
                 : ''}. Please read it alongside this letter.</p>
          </section>

          ${'' /* And immediately under it, what the retainer does not cover.
                 Its own section rather than inside the block above, by the
                 practice's choice: the block says where the work is written
                 down, this says the limits of it. Blank until the practice
                 writes it — the register does not compose the paragraph that
                 tells a client what their lawyer will not do. */}
          ${text.scopeTerms ? html`
            <section>
              ${text.scopeHeading ? html`<h3>${text.scopeHeading}</h3>` : ''}
              ${prose(text.scopeTerms)}
            </section>` : ''}

          ${clauses.map((clause) => html`
            <section>
              <h3>${clause.heading}</h3>
              ${prose(clause.body)}
            </section>`)}

          ${'' /* Who the client actually deals with day to day.

                 **Asked for on 9 September 2026.** The letter says that
                 day-to-day contact is with an administrative team whose role is
                 limited to support — no legal advice, no professional
                 judgement, no representation. That paragraph names people, and
                 the people change while the paragraph does not.

                 So the paragraph is a clause in the practice's own words, and
                 the people are settings. No name is written into this
                 repository.

                 It sits after the clauses, so the paragraph that explains the
                 limit is read before the names it applies to. It is on the
                 letter and not on the quotation, by the same instruction: the
                 quotation is the work and the fees; who answers the telephone
                 is a term of the engagement. */}
          ${text.adminTeam.length ? html`
            <section>
              ${text.adminTeamHeading ? html`<h3>${text.adminTeamHeading}</h3>` : ''}
              ${text.adminTeamIntro ? html`<p>${text.adminTeamIntro}</p>` : ''}
              ${'' /* Each line as the practice wrote it. The register used to
                     take the line apart and print the numbers and addresses
                     gathered at the foot of the section; the practice looked at
                     that and asked for the print to match the box they typed
                     into, which it now does. */}
              <ol class="letter-admin-team">
                ${text.adminTeam.map((line) => html`<li>${line}</li>`)}
                ${text.adminTeamAlso ? html`<li>${text.adminTeamAlso}</li>` : ''}
              </ol>
            </section>` : ''}

          ${practice.termsUrl ? html`
            <section>
              <h3>Standard terms of engagement</h3>
              ${'' /* Not justified. A web address cannot be broken between
                     words, so the line before it is stretched to the full
                     measure around whatever few words fit — which on the letter
                     read "published" ... "at" with most of a line of white
                     between them. Justification is for prose, and a paragraph
                     carrying an address is only mostly prose. */}
              <p class="letter-terms-link">This engagement is on the ${practice.termsLabel}, whose current edition is
                 ${'' /* A live link, asked for on 9 September 2026. The
                        address stays visible as the link's own text rather
                        than hidden behind words, because this document is
                        read on paper as often as on a screen and a printout
                        of "click here" is worth nothing. */}
                 published at <a class="break-url" href="${practice.termsUrl}"
                    target="_blank" rel="noopener noreferrer">${practice.termsUrl}</a>. Please read them
                 before accepting.</p>
            </section>` : ''}

          ${text.acknowledgements.length ? html`
            <section>
              ${text.acknowledgementsHeading
                ? html`<h3>${text.acknowledgementsHeading}</h3>` : ''}
              ${text.acknowledgementsIntro ? html`<p>${text.acknowledgementsIntro}</p>` : ''}
              <ol class="letter-acknowledgements">
                ${text.acknowledgements.map((line) => html`<li>${emphasise(line)}</li>`)}
              </ol>
            </section>` : ''}

          ${text.closing ? html`<section>${prose(text.closing)}</section>` : ''}

          <section class="letter-signature">
            <p>Yours faithfully,</p>
            <p class="strong">${text.signatureName || practice.legalName}</p>
            ${text.signatureTitle ? html`<p class="small">${text.signatureTitle}</p>` : ''}
          </section>

          ${'' /* The one thing the stylesheet cannot hold.
                 The document asks for a 20mm margin and Chrome's print dialogue
                 overrides it on any Margins setting but Default — which is how a
                 letter went out at 8.5mm on 9 September 2026 with the rule
                 correctly in place and live. Said here, beside the button,
                 because Help is not where somebody is standing when they press
                 it. */}
          <p class="hint no-print">In the print box, leave <strong>Margins</strong> on
             <strong>Default</strong>. Any other setting overrides the 20mm this document asks
             for.</p>
          ${'' /* After the signature, and on a page of its own.
                 It is not the practice speaking to this client about this
                 matter — it is what every client of any New Zealand lawyer must
                 be told — so it follows the letter rather than sitting inside
                 it, and starting a new page also keeps the signature on the
                 page with the letter it signs. */}
          ${text.addendum ? html`
            <section class="letter-addendum">
              ${text.addendumHeading ? html`<h2>${text.addendumHeading}</h2>` : ''}
              ${prose(text.addendum)}
            </section>` : ''}

          ${'' /* Which printing of this document the reader is holding.

                 **Asked for on 9 September 2026:** *"it is better if — when
                 Print button is clicked — a clean PDF is generated with full
                 date and time stamp."* A quotation is revised before it goes
                 out, and two printings of the same reference are otherwise
                 indistinguishable once they are on paper: the reference says
                 which document, this says which printing of it.

                 Rendered by the server at the moment the page is asked for,
                 which is what makes it honest — there is no script on these
                 pages and the register does not read the reader's clock. It is
                 on the screen as well as on the paper, because a document that
                 shows one thing on screen and another on paper is the fault
                 this register has spent the day removing. */}
          <p class="quote-doc-stamp">Printed ${printedAt(nowIso())}</p>
          ${footer}
        </article>`;
}

export async function loadQuotation(env: Env, id: string) {
    const q = await one<QuoteRow & { client_name: string | null; case_ref: string | null }>(
      env.DB,
      `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref FROM quotes q
         LEFT JOIN clients cl ON cl.id = q.client_id
         LEFT JOIN cases k ON k.id = q.case_id
        WHERE q.id = ?`,
      id,
    );
    if (!q) return null;
    const [practice, lines, qs, stages, parties] = await Promise.all([
      practiceDetails(env), quoteLines(env, id), quoteSettings(env), quoteStages(env, id),
      quoteParties(env, id),
    ]);

    const totals = summariseQuote(lines.map((l) => ({
      kind: l.kind, lineAmountCents: l.unit_amount_cents,
      netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
    })));
    const issuedOn = q.issued_on ?? q.created_at.slice(0, 10);
    const validTo = q.valid_until ?? validUntil(issuedOn, q.validity_days ?? qs.validityDays);
    const fees = lines.filter((l) => l.kind === 'professional');
    const disbursements = lines.filter((l) => l.kind !== 'professional');

    // Split once rather than filtered three times inside the template, so the
    // document's order is stated in one place and reads the way the letter
    // reads: applicants, then the people whose details the application needs,
    // then the people who may be told things.
    const applicants = parties.filter((p) => p.role === 'applicant');
    const associated = parties.filter((p) => p.role === 'associated');
    const contacts = parties.filter((p) => p.role === 'admin_contact');
    const representative = parties.find((p) => p.is_representative === 1) ?? null;

    /** Their relationship, birthday and how to reach them, in one line. */
    const partyDetail = (p: QuotePartyRow) => {
      const bits = [
        p.relationship,
        p.date_of_birth ? `born ${dateShort(p.date_of_birth)}` : null,
        p.email, p.phone,
      ].filter(Boolean) as string[];
      return bits.length ? html`<div class="small">${bits.join(' · ')}</div>` : '';
    };

    const lineRows = (rows: QuoteItemRow[]) => rows.map((l) => html`
      <tr>
        <td>${l.description}</td>
        <td class="num">${formatQuantity(l.quantity_milli)} ${pluraliseUnit(l.unit_label, l.quantity_milli)}</td>
        <td class="num">${money(l.unit_amount_cents, q.currency)}</td>
        <td class="num">${money(l.net_cents, q.currency)}</td>
      </tr>`);
  return {
    q, practice, qs, lines, stages, totals, issuedOn, validTo, fees, disbursements,
    applicants, associated, contacts, representative, partyDetail, lineRows,
  };
}

export function quotationArticle(
  d: NonNullable<Awaited<ReturnType<typeof loadQuotation>>>, footer: Raw,
): Raw {
  const {
    q, practice, qs, lines, stages, totals, issuedOn, validTo, fees, disbursements,
    applicants, associated, contacts, representative, partyDetail, lineRows,
  } = d;
  return html`
        ${'' /* `quote-doc-quotation` is what the fee quote's own headings hang
                off in `app.css`: the practice asked on 11 September 2026 for
                more room above the section headings of *this* document and a
                larger size on them, and `.quote-doc h3` is shared with the
                letter of engagement and the invoice, which were not in front of
                them. */}
        <article class="quote-doc quote-doc-quotation">
          ${'' /* Accepted, said at the top of the document itself.

                 **Asked for on 9 September 2026:** *"once it is accepted —
                 there should be a green stamp at the top stating ACCEPTED and
                 date and time and name."*

                 On the document rather than on the page around it, so it is
                 there wherever the quotation is rendered: the client's link,
                 the practice's print view, and the paper. A quotation that has
                 been accepted and does not say so is the one document here most
                 likely to be filed as though it had not been. */}
          ${q.accepted_at ? html`
            <p class="quote-doc-accepted">
              <strong>Accepted</strong>
              <span>${printedAt(q.accepted_at)}${q.accepted_name
                ? html` by ${q.accepted_name}` : ''}</span>
            </p>` : ''}
          ${'' /* Title left, practice right — the way the practice's own
                 Xero invoice is set, chosen by them on 9 September 2026 when
                 asked whether to match it. The letter of engagement keeps its
                 letterhead top-left, because a letter is not an invoice. */}
          <header class="quote-doc-head quote-doc-head-swap">
            <div>
              <h1>${practice.legalName}</h1>
              ${practice.adviserDetails ? html`<p class="prewrap small">${practice.adviserDetails}</p>` : ''}
              ${practice.postalAddress ? html`<p class="prewrap small">${practice.postalAddress}</p>` : ''}
              ${'' /* Labelled, at the practice's instruction of 9 September
                     2026. A bare address and a bare number under a firm's name
                     are two lines a reader has to work out; two words settle
                     it, and the GST number belongs with them because it is the
                     other thing a client copies off a fee document. */}
              <p class="small">
                ${practice.contactPhone ? html`Mobile: ${practice.contactPhone}<br>` : ''}
                ${practice.contactEmail ? html`Email: ${practice.contactEmail}<br>` : ''}
                ${practice.gstNumber ? html`GST: ${practice.gstNumber}` : ''}
              </p>
            </div>
            <div class="quote-doc-ref">
              ${'' /* What the document is, said large.

                     **Asked for on 9 September 2026**, then refined the same
                     hour: *"the word Fee Quote needs to be moved — into the
                     header above my name — x3 larger in font"*, and then
                     *"keep the position where it is but align it as the rest of
                     the text — on the right margin — and increase its font."*

                     So it stays at the head of the right-hand column, flush to
                     the right margin with the reference block beneath it, and
                     is simply much larger: it was set at the size of an
                     ordinary heading, which made it read as a label on the
                     reference rather than as the name of the document. */}
              <p class="quote-doc-kind">Fee quote</p>
              ${'' /* "Re", not a Scope paragraph. The name says what the
                       quotation is for in one line, the way a letter's subject
                       does; the items below say what that means. Taking the old
                       Scope section out left the document saying only "Fee
                       quote" and a reference, which a client cannot place. */}
              <dl class="quote-doc-meta">
                ${'' /* No "Re" line. **Asked for on 9 September 2026:**
                       *"remove the Re RV. Partner bit completely — the body of
                       the quote is telling enough."* Right: the items below name
                       the work, line by line, with a figure against each. A
                       heading that says "RV. Partner" above a list beginning
                       "RV. Partner" is the document repeating itself. */}
                <dt>Quote</dt><dd class="strong">${q.ref}</dd>
                <dt>Issued</dt><dd>${dateShort(issuedOn)}</dd>
                <dt>Valid until</dt><dd class="strong">${dateShort(validTo)}</dd>
                ${q.case_ref ? html`<dt>Matter</dt><dd>${q.case_ref}</dd>` : ''}
              </dl>
            </div>
          </header>

          ${'' /* The parties, as the letter of engagement states them — because
                   the letter will not state them itself. The practice's
                   decision, 8 September 2026: the letter is a covering letter
                   and the quotation attached to it is the substance, so this
                   document has to be able to stand as the record of who the
                   engagement is with.

                   Everybody is named in the same section rather than the
                   client in one place and the rest in another: a contract that
                   lists its parties in two lists invites the question of
                   whether the second list is party to it. */}
          <section>
            <h3>The parties</h3>
            <dl class="kv quote-doc-parties">
              ${'' /* "The Lawyer" and "The Client" are the defined terms the
                     letter and the terms of engagement use, so they are
                     capitalised here as they are there. */}
              <dt>The Lawyer</dt><dd>${practice.legalName}</dd>
              <dt>The Client</dt>
              ${'' /* The nomination sits beside the name in brackets rather
                     than on a line of its own beneath it: it qualifies who this
                     person is, and read underneath it looked like a second
                     fact about them. Smaller, because it is an aside. */}
              <dd><strong>${q.client_name ?? '—'}</strong>${
                representative
                  ? ''
                  : html` <span class="small muted">(Nominated representative for all
                          parties)</span>`}</dd>
              ${applicants.map((p) => html`
                <dt>Applicant</dt>
                <dd><strong>${p.full_name}</strong>${partyDetail(p)}</dd>`)}
              ${associated.map((p) => html`
                <dt>Associated party</dt>
                <dd><strong>${p.full_name}</strong>${partyDetail(p)}</dd>`)}
            </dl>
            ${representative ? html`
              <p class="small"><strong>${representative.full_name}</strong> is nominated to give
                 instructions on behalf of all parties named above.</p>` : ''}
            ${contacts.length ? html`
              <h4 class="quote-doc-subhead">Day-to-day administrative contact</h4>
              <dl class="kv quote-doc-parties">
                ${contacts.map((p) => html`
                  <dt>${p.organisation || 'Contact'}</dt>
                  <dd><strong>${p.full_name}</strong>${partyDetail(p)}</dd>`)}
              </dl>
              <p class="small">Their role is limited to administrative and clerical support on this
                 matter — collecting and organising documents, passing on progress, and dealing with
                 Immigration New Zealand on administrative matters only. They are not authorised to
                 give legal advice, to exercise professional judgement, or to act as your legal
                 representative. All legal advice and all decisions come from the lawyer named
                 above.</p>` : ''}
          </section>

          ${'' /* No Scope section. The practice, on the box that fed it: "this
                   field called Scope seems superfluous. why do i need to enter
                   details in it when that will be in the quotation?" Right about
                   the paragraph — the items below are the scope, and a sentence
                   beside them can only repeat them or disagree with them. The
                   value itself stays as the quotation's name, at the top. */}

          ${lines.length === 0
            ? html`<p class="muted">No items have been added to this quote yet.</p>`
            : html`
          <table class="quote-doc-table">
            <thead>
              <tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              ${fees.length ? html`
                <tr class="quote-doc-group"><td colspan="4">Professional fees</td></tr>
                ${lineRows(fees)}` : ''}
              ${disbursements.length ? html`
                <tr class="quote-doc-group"><td colspan="4">Disbursements — paid on your behalf</td></tr>
                ${lineRows(disbursements)}` : ''}
            </tbody>
            ${'' /* The same tidying as the quotation page, for the same reason:
                     the lines above are already grouped under "Professional
                     fees" and "Disbursements — paid on your behalf", so a
                     footer repeating those two figures said it a second time,
                     and the subtotal said the total minus the GST beneath
                     it. */}
            <tfoot>
              ${totals.hasGst
                ? html`<tr><td colspan="3">GST</td>
                           <td class="num">${money(totals.gstCents, q.currency)}</td></tr>`
                : html`<tr><td colspan="4" class="small muted">No GST applies to this quote.</td></tr>`}
              <tr class="totals-row">
                <td colspan="3" class="strong">Total payable</td>
                <td class="num strong">${money(totals.totalCents, q.currency)}</td></tr>
            </tfoot>
          </table>`}

          ${stages.length ? html`
          <section>
            <h3>Payment stages</h3>
            <table class="quote-doc-table">
              <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
              <tbody>
                ${stages.map((s) => html`
                  <tr>
                    <td>${s.label ? html`<strong>${s.label}</strong> ` : ''}${s.description}</td>
                    ${'' /* The figure the client pays, not the figure plus a
                           promise of tax. Asked for on 9 September 2026: the
                           stages "should already be showing the GST inclusive
                           amounts". A schedule of payments whose rows have to
                           be added to a percentage before they mean anything is
                           a schedule the client has to do arithmetic on, and
                           the total underneath was already inclusive — so the
                           rows and the total were in different currencies. */}
                    <td class="num">${money(s.gross_cents, q.currency)}</td>
                  </tr>`)}
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td class="strong">Total including GST</td>
                  <td class="num strong">${money(stages.reduce((n, s) => n + s.gross_cents, 0), q.currency)}</td>
                </tr>
              </tfoot>
            </table>
            ${q.stage_note ? html`<p class="small prewrap quote-doc-note"><strong>Note:</strong> ${q.stage_note}</p>` : ''}
          </section>` : ''}

          ${practice.showBankOnQuote && practice.bankAccountNumber ? html`
          <section>
            <h3>Payment</h3>
            <dl class="kv quote-doc-bank">
              ${practice.bankAccountHolder ? html`<dt>Account holder</dt><dd>${practice.bankAccountHolder}</dd>` : ''}
              ${practice.bankName ? html`<dt>Bank</dt><dd>${practice.bankName}</dd>` : ''}
              <dt>Account</dt><dd><strong>${practice.bankAccountNumber}</strong></dd>
            </dl>
            <p class="small muted">Please quote <strong>${q.ref}</strong> as the reference. If you
               receive an email appearing to change these details, telephone this office on the
               number above before paying anything.</p>
          </section>` : ''}

          <section class="quote-doc-terms">
            <h3>Conditions</h3>
            <ul class="quote-doc-conditions">
              <li>This quote is valid until <strong>${dateShort(validTo)}</strong>.</li>
              ${qs.capacityNote ? html`<li>${qs.capacityNote}</li>` : ''}
              ${qs.paymentTerms ? html`<li>${qs.paymentTerms}</li>` : ''}
              ${disbursements.length
                ? html`<li>Disbursements are amounts paid to third parties on your behalf and are
                           passed on to you without margin. Where an exact figure is not yet known,
                           the amount shown is an estimate and you will be told before it is
                           incurred.</li>`
                : ''}
              ${'' /* What the client is agreeing to, named.

                     **The practice's own sentence, given on 9 September 2026**,
                     replacing one that named a single document: *"This
                     Quotation (fee quote) is subject to the Letter of
                     Engagement, Short Form and Standard Terms of Engagement.
                     Please read them before accepting."*

                     Three documents rather than one, which is what a client is
                     actually held to — the covering letter, the short-form
                     terms printed under it, and the standard terms published
                     online. Naming only the last of them was the omission.

                     "Standard Terms of Engagement" is the linked phrase because
                     it is the only one of the three with an address of its own;
                     the other two are in the client's hand. It is written here
                     rather than taken from `practice.terms_label`, because it
                     is now part of a sentence that names three documents rather
                     than a label standing on its own. If a practice ever needs
                     to call it something else, that is a setting to add, not a
                     reason to keep the old sentence.

                     The address still prints beneath, and only on paper, where
                     a hyperlink is worth nothing. */}
              ${practice.termsUrl
                ? html`<li>This Quotation (fee quote) is subject to the Letter of Engagement,
                           Short Form and
                           <a href="${practice.termsUrl}" rel="noopener"><strong>Standard Terms of
                           Engagement</strong></a>. Please read them before accepting.
                           <span class="print-only break-url">${practice.termsUrl}</span></li>`
                : ''}
            </ul>
          </section>

          ${'' /* The one thing the stylesheet cannot hold.
                 The document asks for a 20mm margin and Chrome's print dialogue
                 overrides it on any Margins setting but Default — which is how a
                 letter went out at 8.5mm on 9 September 2026 with the rule
                 correctly in place and live. Said here, beside the button,
                 because Help is not where somebody is standing when they press
                 it. */}
          <p class="hint no-print">In the print box, leave <strong>Margins</strong> on
             <strong>Default</strong>. Any other setting overrides the 20mm this document asks
             for.</p>
          ${'' /* Which printing of this document the reader is holding.

                 **Asked for on 9 September 2026:** *"it is better if — when
                 Print button is clicked — a clean PDF is generated with full
                 date and time stamp."* A quotation is revised before it goes
                 out, and two printings of the same reference are otherwise
                 indistinguishable once they are on paper: the reference says
                 which document, this says which printing of it.

                 Rendered by the server at the moment the page is asked for,
                 which is what makes it honest — there is no script on these
                 pages and the register does not read the reader's clock. It is
                 on the screen as well as on the paper, because a document that
                 shows one thing on screen and another on paper is the fault
                 this register has spent the day removing. */}
          <p class="quote-doc-stamp">Printed ${printedAt(nowIso())}</p>
          ${footer}
        </article>`;
}

/** The catalogue form, read the same way whether adding or editing. */
function readCatalogueForm(f: FormReader) {
  const name = f.text('name', { required: true, label: 'Name', max: 120 });
  return {
    name,
    description: f.optional('description', { max: 300 }),
    kind: f.enum('kind', FEE_KINDS, { fallback: 'professional' })!,
    unitLabel: f.optional('unit_label', { max: 30 }) || 'item',
    unitAmount: f.money('unit_amount') ?? 0,
    treatment: f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!,
  };
}

/**
 * A typed amount as whole cents, or null if it is not a number.
 *
 * `FormReader.money` records an error against the form; here each line is read
 * independently, and one unreadable line must not stop the others being saved.
 */
function parseMoneyToCents(input: string): number | null {
  const clean = input.trim().replace(/[$,\s]/g, '').replace(',', '.');
  if (!/^-?\d{0,9}(\.\d{1,2})?$/.test(clean) || clean === '' || clean === '.') return null;
  const value = Math.round(Number(clean) * 100);
  return Number.isFinite(value) ? value : null;
}
