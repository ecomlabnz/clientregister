/**
 * The letter of engagement, as a client reads it.
 *
 * The practice settled its shape on 8 September 2026, and the decision is what
 * makes the rest small: **the letter states no parties, no scope and no fees.**
 * Those are the quotation's, and the letter refers to it. Their own letter
 * restated all three, and a covering letter that restates a fee schedule is a
 * document that can disagree with its own attachment.
 *
 * Two things are held here that would each be a real fault in front of a
 * client: that the letter never quotes a figure, and that a letter with no
 * wording says so rather than going out as a signature on an empty page.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';

const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser({ role: 'owner' });

function mount() {
  const h = mountModule(quotesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x','owner','active',?,?)`).run(USER.id, USER.email, USER.name, AT, AT);
  h.db.exec(`INSERT INTO settings (key,value,updated_at)
             VALUES ('vocab.case_types','rv_partner | RV. Partner
wv_aewv | WV. AEWV','${AT}')`);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,email,address,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Anh Tan NGUYEN','Anh Tan','NGUYEN',
                     'client@example.test','12 Example Street, Auckland','active','${AT}','${AT}')`);
  h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-001','cl1','RV. Partner — Anh Tan NGUYEN','A partnership application',
                     'rv_partner','lodged','${USER.id}','${AT}','${AT}')`);
  return h;
}

const withWording = (h: ReturnType<typeof mount>) => {
  h.db.exec(`INSERT INTO settings (key,value,updated_at) VALUES
    ('engagement.opening','I am pleased to act for you in your immigration matter.

Your day-to-day contact is set out below.','${AT}'),
    ('engagement.acknowledgements','have read and accept these terms
acknowledge that no outcome can be guaranteed','${AT}'),
    ('engagement.closing','Thank you for your instructions.','${AT}'),
    ('engagement.signature_name','Taymuraz P Zaseev','${AT}'),
    ('engagement.signature_title','Barrister','${AT}')`);
  h.db.exec(`INSERT INTO engagement_clauses (id,position,heading,body,case_types,active,created_at,updated_at)
    VALUES ('c1',0,'Legal fees and disbursements',
            'Fees are charged on a time and attendance basis unless a fixed fee is agreed in writing.

- The lawyer''s rate is stated in the quotation.
- Disbursements are payable in advance.','',1,'${AT}','${AT}'),
           ('c2',1,'Partnership applications','INZ will assess whether your partnership is genuine and stable.','rv_partner',1,'${AT}','${AT}'),
           ('c3',2,'Employer accreditation','This clause is about accreditation.','wv_aewv',1,'${AT}','${AT}')`);
};

const quote = (h: ReturnType<typeof mount>, withLetter: number | null = 1) =>
  h.db.exec(`INSERT INTO quotes (id,ref,client_id,case_id,description,amount_cents,gst_cents,
                                 disbursements_cents,status,with_letter,issued_on,created_at,updated_at)
             VALUES ('q1','Q-0001','cl1','k1','Partner Resident Visa',700000,105000,536000,'draft',
                     ${withLetter === null ? 'NULL' : withLetter},'2026-09-08','${AT}','${AT}')`);

describe('the letter says nothing the quotation says', () => {
  it('quotes no figure at all', async () => {
    // The whole point of the shape the practice chose. A letter carrying its
    // own copy of the fees is a letter that can disagree with the schedule
    // attached to it — and their real one did carry a full fee table.
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).not.toMatch(/7,000|105,000|5,360|\$/);
  });

  it('points at the quotation by reference instead', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('Q-0001');
    expect(body).toMatch(/accompanies this\s+letter and forms part of it/);
  });

  it('names the nominated representative, because that is the letter’s to say', async () => {
    // Who may instruct is a term of the engagement, not a line of the fee
    // schedule, so this one belongs here.
    const h = mount();
    withWording(h);
    quote(h);
    h.db.exec(`INSERT INTO quote_parties (id,quote_id,position,role,kind,full_name,is_representative,created_at,updated_at)
               VALUES ('p1','q1',0,'applicant','person','Anh Tan NGUYEN',1,'${AT}','${AT}')`);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('nominated to');
    expect(body).toContain('Anh Tan NGUYEN');
  });
});

describe('what the letter carries', () => {
  it('is addressed to the client, at the address on their record', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('Anh Tan NGUYEN');
    expect(body).toContain('12 Example Street, Auckland');
    expect(body).toContain('client@example.test');
  });

  it('carries the practice’s own words, and its signature', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('I am pleased to act for you');
    expect(body).toContain('Thank you for your instructions.');
    expect(body).toContain('Taymuraz P Zaseev');
    expect(body).toContain('Barrister');
  });

  it('carries the clauses for this kind of matter, and not the others', async () => {
    // The reason the clause library exists: a page on how INZ assesses a
    // relationship has no business on an employer accreditation.
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('Legal fees and disbursements');
    expect(body).toContain('Partnership applications');
    expect(body, 'a clause for another kind of matter was printed')
      .not.toContain('Employer accreditation');
  });

  it('sets a paragraph as a paragraph and a dashed line as a bullet', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    // The apostrophe arrives escaped, as everything user-supplied does.
    expect(body).toMatch(/<li>The lawyer(&#39;|&#x27;|')s rate is stated in the quotation\.<\/li>/);
    expect(body).toContain('<p>Fees are charged on a time and attendance basis');
  });

  it('numbers what the client confirms by accepting', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('<ol class="letter-acknowledgements">');
    expect(body).toContain('acknowledge that no outcome can be guaranteed');
  });
});

describe('a letter with no wording behind it', () => {
  it('says so, rather than going out as a signature on an empty page', async () => {
    const h = mount();
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('has no wording yet');
    expect(body).toContain('Settings');
  });
});

describe('whether a quotation goes out with a letter', () => {
  it('cannot be left unanswered when the quotation is made', async () => {
    // The practice's instruction: a mandatory choice at composition, so a
    // letter is never omitted by oversight and never sent by one.
    const h = mount();
    const res = await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/quotes/new');
    expect(h.count('SELECT COUNT(*) AS n FROM quotes')).toBe(0);
  });

  it('is stored as the answer given', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '1' });
    expect(h.get<{ with_letter: number }>('SELECT with_letter FROM quotes')!.with_letter).toBe(1);
    await h.post('/quotes', { client_id: 'cl1', case_type: 'wv_aewv', with_letter: '0' });
    expect(h.count('SELECT COUNT(*) AS n FROM quotes WHERE with_letter = 0')).toBe(1);
  });

  it('can be answered later for a quotation that predates the question', async () => {
    const h = mount();
    quote(h, null);
    await h.post('/quotes/q1/letter', { with_letter: '1' });
    expect(h.get<{ with_letter: number }>('SELECT with_letter FROM quotes')!.with_letter).toBe(1);
  });

  it('offers the letter only when the answer was yes', async () => {
    const h = mount();
    quote(h, 0);
    const off = await (await h.request('/quotes/q1')).text();
    expect(off).not.toContain('/quotes/q1/letter" target');
    expect(off).toContain('on its own');

    h.db.exec('UPDATE quotes SET with_letter = 1');
    const on = await (await h.request('/quotes/q1')).text();
    expect(on).toContain('/quotes/q1/letter');
  });
});

/**
 * The width a document is set in.
 *
 * Found on 8 September 2026 by opening the letter in a browser: it was rendering
 * in a 400-pixel column on a 900-pixel screen, and so was the quotation, and so
 * had every document page since the print view was built.
 *
 * The cause was one line. The bare layout — no navigation, used by the sign-in
 * pages *and* by the documents a client is sent — capped itself at 400px, which
 * is right for a sign-in card and wrong for a letter of engagement. The cap
 * belonged on the card, not on the wrapper that holds both.
 *
 * Measured in Chromium after the fix: the letter 736px at 900 and at 1400,
 * 350px at 390, nothing clipped and no sideways scroll at any of them.
 */
describe('the width a document is set in', () => {
  const css = readFileSync('public/app.css', 'utf8');

  it('is not the width of a sign-in card', () => {
    const bare = css.match(/\.bare-main \{[^}]*\}/)?.[0] ?? '';
    expect(bare, '.bare-main is missing').toBeTruthy();
    expect(bare, 'every document page is capped at the sign-in card’s width again')
      .not.toMatch(/max-width:\s*400px/);
  });

  it('is still narrow for the card that wanted to be narrow', () => {
    const card = css.match(/\.auth-card \{[^}]*\}/)?.[0] ?? '';
    expect(card).toMatch(/max-width:\s*400px/);
  });

  it('lets a row of document actions wrap', () => {
    // Three buttons — print, the quotation, back — came to 468px in a 390px
    // window and scrolled the whole letter sideways.
    const foot = css.match(/\.quote-doc-foot \{[^}]*\}/)?.[0] ?? '';
    expect(foot).toMatch(/flex-wrap:\s*wrap/);
  });
});
