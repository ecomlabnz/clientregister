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
import { defaultQuoteEmail, type QuoteRow } from '../src/modules/quotes';
import { PRACTICE_SETTINGS } from '../src/core/practice';

const quote = {
  id: 'q1', ref: 'Q-0001', client_id: 'cl1', case_id: null, inquiry_id: null,
  description: 'Partner Resident Visa', amount_cents: 700000, gst_cents: 105000,
  disbursements_cents: 536000, currency: 'NZD', status: 'draft',
  valid_until: null, sent_at: null, responded_at: null, notes: null,
  issued_on: '2026-09-08', validity_days: 30, stage_note: null,
  created_at: '2026-09-08T00:00:00Z', updated_at: '2026-09-08T00:00:00Z', created_by: 'u1',
  client_name: 'NGUYEN, ANH TAN',
} as unknown as QuoteRow & { client_name: string | null };

const practice = {
  legalName: 'Taymuraz P Zaseev Barrister',
  termsLabel: 'Barrister’s Terms of Engagement',
  termsUrl: 'https://www.immigration.kiwi/terms',
  contactEmail: 'consult@thelawfirm.nz',
  contactPhone: '+64 27 967 5984',
};

describe('the covering email a quote drafts', () => {
  it('sends the client to the address the practice configured', () => {
    const body = defaultQuoteEmail(quote, practice);
    expect(body).toContain('https://www.immigration.kiwi/terms');
    expect(body).toContain('Barrister’s Terms of Engagement');
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
    const body = defaultQuoteEmail(quote, practice);
    expect(body).not.toMatch(/download (the|these|those) terms/i);
    expect(body).toMatch(/current edition/i);
  });

  it('asks the client to read them before accepting', () => {
    expect(defaultQuoteEmail(quote, practice)).toMatch(/read them before accepting/i);
  });

  it('says nothing about terms when no address is configured', () => {
    // A practice that has not set one must not get a sentence pointing at
    // nowhere. This is also the second practice's first day.
    const body = defaultQuoteEmail(quote, { ...practice, termsUrl: '' });
    expect(body).not.toMatch(/terms of engagement/i);
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
    const mentions = source.match(/termsLabel/g) ?? [];
    expect(mentions.length, 'a place that used to name the terms has stopped')
      .toBeGreaterThanOrEqual(3);
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
