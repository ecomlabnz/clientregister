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

/** Two quotations, the second issued a week after the first. */
function twoQuotes(h: ReturnType<typeof mount>) {
  h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,gst_cents,
                                 disbursements_cents,status,with_letter,issued_on,created_at,updated_at)
             VALUES ('q_old','Q-0001','cl_old','An earlier piece of work',500000,75000,0,'sent',1,
                     '2026-09-01','2026-09-01T09:00:00Z','2026-09-01T09:00:00Z'),
                    ('q_new','Q-0002','cl_new','The most recent piece of work',700000,105000,0,'sent',1,
                     '2026-09-08','2026-09-08T09:00:00Z','2026-09-08T09:00:00Z')`);
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
  it('is the most recently issued quotation, not the oldest', async () => {
    const h = mount();
    twoQuotes(h);
    const body = await (await h.request('/quotes/preview')).text();
    expect(body).toContain('Q-0002');
    expect(body).not.toContain('Q-0001');
  });

  it('falls back to the newest quotation when none has been issued', async () => {
    // A register can hold drafts and nothing else. Showing the draft beats
    // telling somebody there is nothing here when there plainly is.
    const h = mount();
    h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,gst_cents,
                                   disbursements_cents,status,with_letter,created_at,updated_at)
               VALUES ('q_draft','Q-0009','cl_new','A draft',100000,15000,0,'draft',1,
                       '2026-09-10T09:00:00Z','2026-09-10T09:00:00Z')`);
    const res = await h.request('/quotes/preview');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Q-0009');
    expect(body).toContain('has not been issued yet');
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
