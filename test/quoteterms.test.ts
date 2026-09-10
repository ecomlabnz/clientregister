/**
 * Where a quote sends the client to read the terms.
 *
 * The practice's Letter of Engagement asks the client to confirm they have read
 * the *Standard Terms of Engagement set out online*, and names the address. The
 * register's quote says the same thing in its own words and gives its own
 * address, from `practice.terms_url`.
 *
 * On 8 September 2026 those were two different addresses: the letter said
 * `www.immigration.kiwi/terms`, the register a PDF file at
 * `www.immigration.kiwi/_files/ugd/796b4b_…pdf`. Both were the practice's own,
 * so nothing was broken — but a client who is asked to accept terms, and finds
 * the quote and the letter pointing at two different documents, has been given
 * a reason to ask which one they agreed to. That is a question about an
 * engagement, not about a website.
 *
 * The address itself is a setting, so what is pinned here is what the register
 * *does* with it: it names it, it sends the client to the one the practice
 * configured, and it does not describe it as a file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultQuoteEmail, type QuoteItemRow, type QuoteRow } from '../src/modules/quotes';
import { renderRichText } from '../src/core/richtext';
import { PRACTICE_SETTINGS } from '../src/core/practice';

const quote = {
  id: 'q1', ref: 'Q-0001', client_id: 'cl1', case_id: null, inquiry_id: null,
  description: 'Partner Resident Visa', amount_cents: 700000, gst_cents: 105000,
  disbursements_cents: 536000, currency: 'NZD', status: 'draft',
  valid_until: null, sent_at: null, responded_at: null, notes: null,
  issued_on: '2026-09-08', validity_days: 30, stage_note: null,
  created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z', created_by: 'u1',
  client_name: 'BUI, DUC MANH',
} as unknown as QuoteRow & { client_name: string | null };

const practice = {
  legalName: 'Taymuraz P Zaseev Barrister',
  termsLabel: 'Barrister’s Terms of Engagement',
  termsUrl: 'https://www.immigration.kiwi/terms',
  contactEmail: 'consult@thelawfirm.nz',
  contactPhone: '+64 27 967 5984',
  // Not set, so these tests exercise the fallback sign-off. The signature the
  // practice actually writes is tested in quoteemailtemplate.test.ts.
  emailSignature: '',
};

describe('the covering email a quote drafts', () => {
  it('sends the client to the address the practice configured', () => {
    const body = defaultQuoteEmail(quote, practice);
    expect(body).toContain('https://www.immigration.kiwi/terms');
  });

  it('names the documents and sends the client to them', () => {
    // **The practice's own letter, given on 9 September 2026**, with the
    // figures and the address filled in. The email before it typed the whole
    // quotation into its body; a covering letter does not contain the
    // documents, it says what is waiting, where, and what to do.
    const withLetter = { ...quote, with_letter: 1 };
    const body = defaultQuoteEmail(withLetter, practice, [], '', 'https://app.example.test/q/abc');
    expect(body).toContain('https://app.example.test/q/abc');
    expect(body).toContain('Letter of Engagement');
    expect(body).toContain('Standard Terms of Engagement');
    // And it no longer retypes the itemisation.
    expect(body).not.toContain('Subtotal');
    expect(body).not.toContain('Professional fees');
  });

  it('does not promise a letter of engagement that is not going', () => {
    // The one sentence of the practice's that is not true of every quotation.
    // A quotation sent without a letter must not name one — promising a
    // document that is not there is worse than a shorter sentence.
    const body = defaultQuoteEmail({ ...quote, with_letter: 0 }, practice, [], '',
      'https://app.example.test/q/abc');
    expect(body).not.toContain('Letter of Engagement');
    expect(body).toContain('fee quotation**');
    expect(body).toMatch(/before accepting it/);
  });

  it('says the total is inclusive only of what it is inclusive of', () => {
    // "inclusive of GST and the disbursements specified in the quotation" is
    // the practice's wording and is a statement about a figure on a contract.
    // It comes apart for a practice that is not GST registered, and for a
    // quotation with no disbursements on it.
    const line = (l: Partial<QuoteItemRow>) => ({
      kind: 'professional', unit_amount_cents: 100000, net_cents: 100000,
      gst_cents: 15000, gross_cents: 115000, quantity_milli: 1000, ...l,
    } as QuoteItemRow);

    const feesOnly = defaultQuoteEmail(quote, practice, [line({})], '', 'https://x.test/q/a');
    expect(feesOnly).toContain('inclusive of GST**');
    expect(feesOnly).not.toContain('disbursements specified');

    const withDisb = defaultQuoteEmail(quote, practice,
      [line({}), line({ kind: 'disbursement' })], '', 'https://x.test/q/a');
    expect(withDisb).toContain('inclusive of GST and the disbursements specified in the quotation');

    const noGst = defaultQuoteEmail(quote, practice,
      [line({ gst_cents: 0, gross_cents: 100000 })], '', 'https://x.test/q/a');
    expect(noGst).not.toContain('inclusive of GST');
  });

  it("carries the practice's own warning about the outcome", () => {
    // The paragraph the practice added by hand, and the reason the letter is
    // theirs rather than the register's: a fee quotation that reads as a
    // promise of a visa is a professional problem, not a wording preference.
    const body = defaultQuoteEmail(quote, practice, [], '', 'https://x.test/q/a');
    expect(body).toMatch(/does not constitute a guarantee/i);
    expect(body).toContain('Immigration New Zealand');
  });

  it("uses the practice's capacity note where they have written one", () => {
    // Their letter carries a capacity sentence of its own. The register already
    // has a setting for that sentence, so the setting wins where it is set and
    // their words are the default — rather than the client being told twice.
    const theirs = 'We may decline the engagement if our workload does not permit it.';
    const set = defaultQuoteEmail(quote, practice, [], theirs, 'https://x.test/q/a');
    expect(set).toContain(theirs);
    expect(set).not.toMatch(/availability and capacity/);

    const unset = defaultQuoteEmail(quote, practice, [], '', 'https://x.test/q/a');
    expect(unset).toMatch(/availability and capacity/);
  });

  it('says so plainly when the quotation has no link yet', () => {
    // Rather than sending a covering note that covers nothing. This should not
    // be reachable from the compose screen, which mints a link before drafting.
    const body = defaultQuoteEmail(quote, practice);
    expect(body).toMatch(/has no link yet/i);
  });

  it('does not tell the client to download a page', () => {
    // The terms are a page on the practice's site. A client told to download
    // something that opens in a browser wonders whether they got the right
    // thing — and on a document they are being asked to accept, that is the
    // one doubt worth spending a word to avoid.
    //
    // Corrected 8 September 2026. The practice pointed out what is actually at
    // that address: a page whose only content is a button that downloads the
    // current edition as a PDF. So neither word alone is honest — "download"
    // sends somebody looking for a file at a page address, and "read" leaves
    // them on a page wondering where the terms are. What is pinned now is that
    // the email does not call the *link* a file, and does say where the current
    // edition comes from.
    const body = defaultQuoteEmail(quote, practice, [], '', 'https://app.example.test/q/abc');
    expect(body).not.toMatch(/download (the|these|those) terms/i);
    // And it still says where the standard terms come from: the quotation and
    // the letter are on the page the link opens, this one is not.
    expect(body).toMatch(/Standard Terms of Engagement/);
    expect(body).toContain(practice.termsUrl);
  });

  it('asks the client to read, to sign, and to ask first if unsure', () => {
    const body = defaultQuoteEmail({ ...quote, with_letter: 1 }, practice, [], '',
      'https://app.example.test/q/abc');
    expect(body).toMatch(/carefully before accepting them/i);
    expect(body).toMatch(/sign electronically at the end of the quotation/i);
    // The invitation to ask before signing, which is the thing a client most
    // needs permission to do before agreeing to a contract.
    expect(body).toMatch(/please contact us before accepting it/i);
  });

  it('points at no terms when no address is configured', () => {
    // A practice that has not set one must not get a sentence pointing at
    // nowhere. This is also the second practice's first day. What is checked is
    // the *pointer*, not the phrase: the closing paragraph invites a question
    // about "the terms of engagement" whether or not there is an address, and
    // it should.
    const body = defaultQuoteEmail(quote, { ...practice, termsUrl: '' });
    expect(body).not.toMatch(/Standard Terms of Engagement/);
    expect(body).not.toMatch(/available here/i);
  });
});

describe('everywhere else the terms are named', () => {
  const source = readFileSync('src/modules/quotes/index.ts', 'utf8');

  it('never calls them a download', () => {
    // Three places named them: the drafted email, the quote page the practice
    // reads, and the printed quote the client is sent. All three said
    // "download". Checked as source because two of the three are templates
    // reached only by rendering a page with a database behind it.
    const prose = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(prose).not.toMatch(/download/i);
  });

  it('names the terms in all three places, so none of them goes quiet', () => {
    // The drafted email, the quote page the practice reads, and the printed
    // quotation the client is sent. Counted as source because two of the three
    // are templates reached only by rendering a page with a database behind it.
    //
    // It counted `termsLabel` until 9 September 2026, when the practice
    // replaced the sentence with one naming three documents rather than one —
    // at which point the label stopped being what those places say, and a
    // count of it would have gone on passing while saying nothing.
    const prose = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect((prose.match(/Standard\s+Terms\s+of\s+Engagement/g) ?? []).length,
      'a place that used to name the terms has stopped').toBeGreaterThanOrEqual(3);
    // And the address itself is still reached from all three.
    expect((prose.match(/termsUrl/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('says the quotation is subject to them, rather than given on them', () => {
    // The practice's wording. "Given on" describes how the price was arrived
    // at; "subject to" describes what the client is agreeing to, which is the
    // thing the sentence is there to say.
    const prose = source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(prose).not.toMatch(/quote is given on/i);
  });
});

describe('the address the register ships with', () => {
  it('is the one the letter of engagement uses', () => {
    // Until this was changed the shipped default was a PDF at a different
    // address, which is what the live register had been set to and what every
    // quote had carried.
    const setting = PRACTICE_SETTINGS.settings.find((s) => s.key === 'practice.terms_url');
    expect(setting, 'the setting has gone').toBeDefined();
    expect(setting!.default).toBe('https://www.immigration.kiwi/terms');
  });
});

/**
 * **Reported on 11 September 2026**, with the formatted email on screen:
 * *"the HTML format - this is how it is breaking down - incorrectly"*.
 *
 * The letter was wrapped at about seventy-six characters, the way a plain-text
 * letter is typed. In the formatted email every one of those newlines became a
 * line break, so the client read "for the / proposed work." — and emphasis,
 * which by design cannot span a line break, printed its own asterisks wherever
 * a bold phrase happened to wrap.
 */
describe('a paragraph of the letter is one line, however long', () => {
  // With a letter of engagement, which is the longer of the two shapes and the
  // one the practice was looking at.
  const body = defaultQuoteEmail({ ...quote, with_letter: 1 } as never, practice, [
    { kind: 'professional', unit_amount_cents: 100000, net_cents: 100000,
      gst_cents: 15000, gross_cents: 115000 } as never,
  ], '', 'https://app.immigration.kiwi/q/abc');

  it('leaves no emphasis marker spanning a line break', () => {
    // This is the rule that broke. A `**` that opens on one line and closes on
    // the next matches nothing and is printed as typed.
    for (const line of body.split('\n')) {
      expect((line.match(/\*\*/g) ?? []).length % 2, `unclosed emphasis on: ${line}`).toBe(0);
    }
  });

  it('renders with no asterisks left in the formatted email', () => {
    expect(String(renderRichText(body))).not.toContain('**');
  });

  it('breaks the line only where a break is meant', () => {
    // Three, and all of them in the sign-off: a name, an address, a number.
    // Everything above it is paragraphs separated by blank lines.
    expect((String(renderRichText(body)).match(/<br>/g) ?? []).length).toBe(3);
  });

  it('carries the practice’s reworded paragraph', () => {
    expect(body).toContain(
      'Please read the documents carefully before accepting them. Together, these documents'
      + ' set out the proposed scope of our work, the applicable fees, payment arrangements,'
      + ' and the terms on which we would act for you.');
    expect(body).toContain(
      'This engagement is also subject to our **Standard Terms of Engagement**, which are'
      + ' available here:');
  });

  it('names one document rather than several when no letter goes with it', () => {
    const alone = defaultQuoteEmail(quote, practice, [], '',
      'https://app.immigration.kiwi/q/abc');
    expect(alone).toContain('Please read the quotation carefully before accepting it.');
    expect(alone).not.toContain('these documents');
  });
});
