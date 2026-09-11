/**
 * Seeing the wording as a document, from the settings page.
 *
 * **Asked for on 12 September 2026:** *"in the settings quotes and Letter of
 * engagement - there should be a button to preview these two documents or how
 * they appear?"* Both documents are edited as boxes of text, and a box of text
 * is not a document — until this, the only way to see the effect of a change
 * was to go and find a real quotation.
 *
 * What is held here is the part that would be a real fault: that the preview
 * refuses anybody who cannot already reach the wording, that it writes nothing
 * at all, that it says out loud it is a preview drawn on a real client's
 * quotation, and that a register with no quotations says so in words rather
 * than falling over.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
// The registry is imported before the admin module on purpose. `admin` reads
// `registeredModules` to render the settings page, and registry imports admin —
// so importing admin first builds that array while admin's own export is still
// undefined, and the settings page falls over. Importing the registry first
// leaves it complete.
import '../src/registry';
import { quotesModule } from '../src/modules/quotes';
import { adminModule } from '../src/modules/admin';

const AT = '2026-09-12T09:00:00Z';
const OWNER = fakeUser({ role: 'owner' });

function mount(user = OWNER) {
  const h = mountModule(quotesModule, { user });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x','owner','active',?,?)`).run(OWNER.id, OWNER.email, OWNER.name, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,email,phone,status,created_at,updated_at)
             VALUES ('cl_old','CL-0001','individual','Older Invented Client','Older','CLIENT',
                     'older@example.test','+64 21 000 0001','active','${AT}','${AT}'),
                    ('cl_new','CL-0002','individual','Newer Invented Client','Newer','CLIENT',
                     'newer@example.test','+64 21 000 0002','active','${AT}','${AT}')`);
  return h;
}

/**
 * Two quotations, the second sent a week after the first.
 *
 * Both carry `issued_on`, because the register sets it on **every** quotation
 * as it is created — which is exactly why the preview must not read it. What
 * separates a quotation that went out from one that did not is `sent_at`.
 */
function twoQuotes(h: ReturnType<typeof mount>) {
  h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,gst_cents,
                                 disbursements_cents,status,with_letter,issued_on,sent_at,
                                 created_at,updated_at)
             VALUES ('q_old','Q-0001','cl_old','An earlier piece of work',500000,75000,0,'sent',1,
                     '2026-09-01','2026-09-01T10:00:00Z','2026-09-01T09:00:00Z','2026-09-01T09:00:00Z'),
                    ('q_new','Q-0002','cl_new','The most recent piece of work',700000,105000,0,'sent',1,
                     '2026-09-08','2026-09-08T10:00:00Z','2026-09-08T09:00:00Z','2026-09-08T09:00:00Z')`);
}

/**
 * A draft, as `POST /quotes` actually writes one: `status = 'draft'`, no
 * `sent_at`, and **`issued_on` already set to the day it was created**.
 *
 * This shape is the whole reason the first version of this page was wrong. It
 * read `issued_on`, found one, and told the practice it was looking at "the
 * last quotation you issued" — of a draft nobody had ever sent. Found in
 * review, 12 September 2026.
 */
function draftQuote(
  h: ReturnType<typeof mount>,
  over: { id?: string; ref?: string; client?: string | null; isTest?: 0 | 1;
          withLetter?: 0 | 1 | null; created?: string } = {},
) {
  const id = over.id ?? 'q_draft';
  const client = over.client === undefined ? "'cl_new'" : over.client === null ? 'NULL' : `'${over.client}'`;
  const created = over.created ?? '2026-09-10T09:00:00Z';
  const withLetter = over.withLetter === undefined ? 1 : over.withLetter;
  h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,gst_cents,
                                 disbursements_cents,status,with_letter,is_test,issued_on,
                                 created_at,updated_at)
             VALUES ('${id}','${over.ref ?? 'Q-0009'}',${client},'A draft',100000,15000,0,'draft',
                     ${withLetter === null ? 'NULL' : withLetter},${over.isTest ?? 0},
                     '${created.slice(0, 10)}','${created}','${created}')`);
}

const wording = (h: ReturnType<typeof mount>) =>
  h.db.exec(`INSERT INTO settings (key,value,updated_at) VALUES
    ('engagement.opening','I am pleased to act for you in this matter.','${AT}'),
    ('engagement.signature_name','A Practitioner','${AT}'),
    ('quotes.capacity_note','Subject to our capacity when you accept.','${AT}')`);

describe('who may see a preview', () => {
  /**
   * The preview shows a real client's quotation, so the gate is the one that
   * reaches the wording — not the weaker one that reaches a quote.
   */
  it('is whoever may edit the wording, and nobody else', async () => {
    const adviser = mount(fakeUser({ role: 'adviser' }));
    twoQuotes(adviser);
    expect((await adviser.request('/quotes/preview')).status).toBe(403);
    expect((await adviser.request('/quotes/preview/letter')).status).toBe(403);

    const owner = mount();
    twoQuotes(owner);
    expect((await owner.request('/quotes/preview')).status).toBe(200);
    expect((await owner.request('/quotes/preview/letter')).status).toBe(200);
  });
});

describe('what the preview is drawn on', () => {
  it('is the most recently sent quotation, not the oldest', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('Q-0002');
    expect(body).not.toContain('Q-0001');
  });

  it('prefers a quotation that was sent over a newer one that was not', async () => {
    // The draft is newer by a fortnight and carries `issued_on`, because every
    // quotation does. A quotation that actually went out is still the better
    // thing to show, and reading `issued_on` would have picked the draft.
    const h = mount();
    twoQuotes(h);
    draftQuote(h, { created: '2026-09-22T09:00:00Z' });
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('Q-0002');
    expect(body).toContain('the last quotation you sent');
    expect(body).not.toContain('Q-0009');
  });

  it('falls back to the newest quotation when none has been sent, and calls it a draft', async () => {
    // A register can hold drafts and nothing else. Showing the draft beats
    // telling somebody there is nothing here when there plainly is — but it
    // must not be described as something the practice sent.
    const h = mount();
    draftQuote(h);
    const res = await h.request('/quotes/preview');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Q-0009');
    expect(body).toContain('has not been sent');
    expect(body).not.toContain('you sent, on');
  });

  it('prefers a real quotation over one marked as test data', async () => {
    const h = mount();
    draftQuote(h, { id: 'q_test', ref: 'Q-0100', isTest: 1, created: '2026-09-30T09:00:00Z' });
    draftQuote(h, { id: 'q_real', ref: 'Q-0101', created: '2026-09-20T09:00:00Z' });
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('Q-0101');
    expect(body).not.toContain('Q-0100');
  });

  it('shows the wording as it is now, which is the whole point', async () => {
    const h = mount();
    twoQuotes(h);
    wording(h);
    const quote = await (await h.request('/quotes/preview')).text();
    expect(quote).toContain('Subject to our capacity when you accept.');
    const letter = await (await h.request('/quotes/preview/letter')).text();
    expect(letter).toContain('I am pleased to act for you in this matter.');
    expect(letter).toContain('A Practitioner');
  });
});

describe('the preview says what it is', () => {
  it('names itself and the quotation it is drawn on, above the document', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('This is a preview.');
    expect(body).toContain('Q-0002');
    expect(body).toContain('Newer Invented Client');
    // Above the document, not buried under it — or somebody reads the document
    // first and takes it for the thing itself.
    expect(body.indexOf('This is a preview.')).toBeLessThan(body.indexOf('<article'));
  });

  it('says the same on the letter', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview/letter')).text();
    expect(body).toContain('This is a preview.');
    expect(body.indexOf('This is a preview.')).toBeLessThan(body.indexOf('<article'));
  });

  /**
   * The banner is the only thing separating this page from the document it
   * draws, so it must survive a printer — `.no-print` on it would produce a
   * printout of a client's quotation with nothing saying where it came from.
   */
  it('keeps the banner on paper', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview')).text();
    const banner = /<div class="([^"]*)">\s*<strong>This is a preview\.<\/strong>/.exec(body);
    expect(banner, 'no banner found').not.toBeNull();
    expect(banner![1]).not.toContain('no-print');
    expect(banner![1]).toContain('preview-note');
  });
});

describe('the banner says only what is true of the quotation it got', () => {
  /**
   * Every sentence in the banner is conditional on the row. These three cases
   * are the ones the first version asserted regardless, found in review on
   * 12 September 2026: a draft called sent, a nameless quotation said to carry
   * a client's name, and test data called a real client's.
   */
  it('does not claim a client’s name is on a quotation that has no client', async () => {
    const h = mount();
    draftQuote(h, { id: 'q_none', ref: 'Q-0011', client: null });
    const res = await h.request('/quotes/preview');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Q-0011');
    expect(body).not.toContain('their name is on it');
  });

  it('says test data is test data, rather than a real client', async () => {
    const h = mount();
    draftQuote(h, { id: 'q_test', ref: 'Q-0100', isTest: 1 });
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('marked as test data');
    expect(body).not.toContain('It is a real client');
  });

  it('says so when the quotation it drew the letter on carries no letter', async () => {
    const h = mount();
    draftQuote(h, { id: 'q_nl', ref: 'Q-0013', withLetter: 0 });
    const res = await h.request('/quotes/preview/letter');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('without a letter of engagement');

    // The fee quotation's own banner has nothing to say about letters.
    const quote = await (await h.request('/quotes/preview')).text();
    expect(quote).not.toContain('without a letter of engagement');
  });
});

describe('the preview writes nothing', () => {
  it('records no audit row and leaves the quotation exactly as it was', async () => {
    const h = mount();
    twoQuotes(h);
    const before = h.get<{ row: string }>(
      `SELECT group_concat(id || '|' || status || '|' || COALESCE(issued_on,'') || '|' || updated_at) AS row
         FROM quotes ORDER BY id`);
    const audits = h.count('SELECT COUNT(*) AS n FROM audit_log');

    expect((await h.request('/quotes/preview')).status).toBe(200);
    expect((await h.request('/quotes/preview/letter')).status).toBe(200);

    expect(h.count('SELECT COUNT(*) AS n FROM audit_log'),
      'a preview must not record itself as a document being printed').toBe(audits);
    expect(h.get<{ row: string }>(
      `SELECT group_concat(id || '|' || status || '|' || COALESCE(issued_on,'') || '|' || updated_at) AS row
         FROM quotes ORDER BY id`)).toEqual(before);
    // No client link is minted either: that address is created when a
    // quotation is about to leave the office, and this one is not.
    expect(h.count('SELECT COUNT(*) AS n FROM quotes WHERE share_token IS NOT NULL')).toBe(0);
  });
});

describe('a register with no quotations at all', () => {
  /**
   * A brand-new practice — the trial — has none. It must read as a sentence,
   * not as a missing page.
   */
  it('says so in plain words, and says what to do instead', async () => {
    const h = mount();
    for (const path of ['/quotes/preview', '/quotes/preview/letter']) {
      const res = await h.request(path);
      expect(res.status, path).toBe(200);
      const body = await res.text();
      expect(body).toContain('There are none in the register yet.');
      expect(body).toContain('Create a quotation and the preview will show it here.');
    }
  });
});

describe('the preview needs no JavaScript', () => {
  it('offers links and nothing that has to be wired up', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('href="/admin/settings?tab=quotes"');
    expect(body).not.toContain('data-print');
    expect(body).not.toContain('<button');
  });
});

describe('the way in, from the settings page', () => {
  it('offers a preview beside the quote wording and beside the letter wording', async () => {
    const h = mountModule(adminModule, { user: OWNER });
    const quotes = await (await h.request('/admin/settings?tab=quotes')).text();
    expect(quotes).toContain('href="/quotes/preview"');
    expect(quotes).toContain('Preview the quotation');

    const engagement = await (await h.request('/admin/settings?tab=engagement')).text();
    expect(engagement).toContain('href="/quotes/preview/letter"');
    expect(engagement).toContain('Preview the letter');
  });
});
