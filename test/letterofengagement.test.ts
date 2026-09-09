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
import { parseAdminTeam } from '../src/core/engagement';

const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser({ role: 'owner' });

function mount() {
  const h = mountModule(quotesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x','owner','active',?,?)`).run(USER.id, USER.email, USER.name, AT, AT);
  h.db.exec(`INSERT INTO settings (key,value,updated_at)
             VALUES ('vocab.case_types','rv_partner | RV. Partner
wv_aewv | WV. AEWV','${AT}')`);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,email,phone,address,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Duc Manh BUI','Duc Manh','NGUYEN',
                     'client@example.test','+64 21 000 0000','12 Example Street, Auckland',
                     'active','${AT}','${AT}')`);
  h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-001','cl1','RV. Partner — Duc Manh BUI','A partnership application',
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
               VALUES ('p1','q1',0,'applicant','person','Duc Manh BUI',1,'${AT}','${AT}')`);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('nominated to');
    expect(body).toContain('Duc Manh BUI');
  });
});

describe('what the letter carries', () => {
  /**
   * **Changed on 9 September 2026, by the practice:** *"The address is not
   * required - it should only have email and phone number."* It is a letter
   * that goes by email, to clients often between addresses — one live record's
   * address read "Summer Place (joint tenancy address; full address not
   * stated)", which is a note to the file, printed on a contract.
   *
   * The address stays on the client's own record and in the register; it is
   * only this document that stops carrying it.
   */
  it('reaches the client by email and mobile, and not by post', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('Duc Manh BUI');
    expect(body).toContain('client@example.test');
    expect(body).toContain('Mobile: +64 21 000 0000');
    // The fixture has one, so this is a rule and not an empty column.
    expect(h.get<{ address: string }>(
      `SELECT address FROM clients WHERE id = 'cl1'`)?.address).toBe('12 Example Street, Auckland');
    expect(body).not.toContain('12 Example Street, Auckland');
  });

  /**
   * **Asked for the same day:** *"the letter of engagement must start with
   * 'Dear CLIENT'S FULL NAME,'"*. It opened straight into the first paragraph
   * under a bare name, which reads as a form rather than a letter.
   */
  it('greets the client by name before it says anything', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).toContain('Dear Duc Manh BUI,');
    // Before the first paragraph of the practice's own wording, not after it.
    expect(body.indexOf('Dear Duc Manh BUI,'))
      .toBeLessThan(body.indexOf('pleased to act'));
  });

  it('greets nobody rather than printing “Dear ,” when no name is recorded', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    h.db.exec(`UPDATE clients SET full_name = '' WHERE id = 'cl1'`);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body).not.toContain('Dear ,');
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

/**
 * The administrative team the client actually deals with.
 *
 * **Asked for on 9 September 2026.** The letter says day-to-day contact is with
 * an administrative team whose role is limited to support — no legal advice, no
 * professional judgement, no representation. That paragraph names people, and
 * the people change while the paragraph does not: so the paragraph is a clause
 * in the practice's own words, and the people are settings.
 *
 * **The names in these tests are invented.** The practice's real administrative
 * staff are in the register and nowhere else, which is the whole point of the
 * arrangement and also the standing rule.
 */
describe('the administrative team', () => {
  const team = (h: ReturnType<typeof mount>, value: string) =>
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('engagement.admin_team', '${value}', '${AT}')`);

  const letter = async (h: ReturnType<typeof mount>) =>
    (await h.request('/quotes/q1/letter')).text();

  it('is absent entirely until somebody is listed', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await letter(h);
    expect(body).not.toContain('Day-to-Day Administrative Team Contact');
    expect(body).not.toContain('designated administrative');
  });

  it('names them, with the mobiles and emails gathered onto one line each', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    team(h, 'Ms A B Example | Ann | +64 21 000 0001 | ann@example.test\n'
          + 'Mr C D Sample | Colin | +64 21 000 0002 | colin@example.test');

    const body = await letter(h);
    expect(body).toContain('Day-to-Day Administrative Team Contact');
    expect(body).toContain('The designated administrative (non-legal) contacts');
    expect(body).toContain('Ms A B Example');
    expect(body).toContain('Mr C D Sample');
    // One line each, in the order entered, the short name in brackets.
    expect(body).toContain('+64 21 000 0001 (Ann); +64 21 000 0002 (Colin)');
    expect(body).toContain('ann@example.test; colin@example.test');
    // And the standing last item.
    expect(body).toContain('or any other person nominated by them');
  });

  it('prints a person who has only a name, without a dangling label', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    team(h, 'Ms A B Example');

    const body = await letter(h);
    expect(body).toContain('Ms A B Example');
    // No "Mobile:" or "Email:" heading with nothing after it.
    expect(body).not.toMatch(/Mobile:\s*<\/p>/);
    expect(body).not.toMatch(/Email:\s*<\/p>/);
  });

  it('leaves a person out of the mobile line rather than leaving a gap in it', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    team(h, 'Ms A B Example | Ann | | ann@example.test\n'
          + 'Mr C D Sample | Colin | +64 21 000 0002 | colin@example.test');

    const body = await letter(h);
    expect(body).toContain('+64 21 000 0002 (Colin)');
    expect(body).not.toContain('; +64 21 000 0002');
    expect(body).toContain('ann@example.test; colin@example.test');
  });

  it('does not put them on the quotation', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    team(h, 'Ms A B Example | Ann | +64 21 000 0001 | ann@example.test');

    const body = await (await h.request('/quotes/q1/print')).text();
    expect(body).not.toContain('Ms A B Example');
    expect(body).not.toContain('Day-to-Day Administrative Team Contact');
  });

  it('escapes what is typed, because a contract is not a place for markup', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    team(h, 'Ms <script>alert(1)</script> Example | X | +64 21 000 0001 | x@example.test');

    const body = await letter(h);
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });
});

describe('reading the administrative team setting', () => {
  it('takes the name alone, and fills the rest with nothing', () => {
    expect(parseAdminTeam('Ms A B Example')).toEqual([
      { name: 'Ms A B Example', short: '', mobile: '', email: '' },
    ]);
  });

  it('ignores blank lines and stray whitespace', () => {
    expect(parseAdminTeam('\n  Ms A B Example  |  Ann  \n\n   \n')).toEqual([
      { name: 'Ms A B Example', short: 'Ann', mobile: '', email: '' },
    ]);
  });

  it('drops a line with no name rather than printing an empty item', () => {
    // "| | +64 21 000 0001 |" is somebody halfway through being typed. A
    // contract should not print a blank bullet with a telephone number.
    expect(parseAdminTeam('| | +64 21 000 0001 |')).toEqual([]);
  });

  it('ignores anything past the fourth field', () => {
    // A stray pipe in a title should not run rubbish into the email address.
    expect(parseAdminTeam('A | B | C | D | E')).toEqual([
      { name: 'A', short: 'B', mobile: 'C', email: 'D' },
    ]);
  });
});

/**
 * Two documents on one page, and a line between them.
 *
 * **Asked for on 9 September 2026**, with a line drawn across a screenshot:
 * everything above it is the covering letter, everything below is the
 * practice's short-form terms. The letter also points at a *second* set of
 * terms — the Standard Terms of Engagement, at a web address — so a client who
 * cannot see that the page in their hand is itself a set of terms has no way to
 * tell the two apart.
 */
describe('where the covering letter ends and the terms begin', () => {
  const setting = (h: ReturnType<typeof mount>, key: string, value: string) =>
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('${key}', '${value}', '${AT}')`);

  const letter = async (h: ReturnType<typeof mount>) =>
    (await h.request('/quotes/q1/letter')).text();

  it('heads the terms, and does so before the quotation block', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await letter(h);
    expect(body).toContain('Short Form Terms of Engagement');
    expect(body).toContain('Immigration Legal Services (Direct Access)');
    expect(body.indexOf('Short Form Terms of Engagement'))
      .toBeLessThan(body.indexOf('The Parties, the Scope of Work'));
    // And after the covering letter it closes off.
    expect(body.indexOf('pleased to act'))
      .toBeLessThan(body.indexOf('Short Form Terms of Engagement'));
  });

  it('prints no divider at all when the practice clears the heading', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    setting(h, 'engagement.terms_title', '');
    setting(h, 'engagement.terms_subtitle', 'Immigration Legal Services');
    const body = await letter(h);
    // The subtitle is not a heading of its own: it goes with the title or not
    // at all, or the page grows a stray line of shouting.
    expect(body).not.toContain('letter-terms-start');
    expect(body).not.toContain('Immigration Legal Services');
  });

  it('names all four things the quotation settles', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await letter(h);
    expect(body).toContain('The Parties, the Scope of Work, the Fees (Legal and Disbursements)');
    expect(body).toContain('the Payment Terms');
    // The heading it replaced, which was too narrow for a document that also
    // settles who the parties are and when the money falls due.
    expect(body).not.toContain('The work, the parties and the fees');
  });
});

describe('the scope of the retainer', () => {
  const letter = async (h: ReturnType<typeof mount>) =>
    (await h.request('/quotes/q1/letter')).text();

  it('is not written by the register, so nothing prints until the practice writes it', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    const body = await letter(h);
    // The heading has a default; the wording deliberately does not, and the
    // heading must not print on its own above nothing.
    expect(body).not.toContain('Scope of the Retainer');
  });

  it('sits under the quotation block, not inside it', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('engagement.scope_terms',
                       'A limited scope retainer. Work outside it is not provided.', '${AT}')`);

    const body = await letter(h);
    expect(body).toContain('Scope of the Retainer');
    expect(body).toContain('A limited scope retainer.');
    expect(body.indexOf('The Parties, the Scope of Work'))
      .toBeLessThan(body.indexOf('A limited scope retainer.'));
    // Before the practice's own clauses, which follow it.
    expect(body.indexOf('A limited scope retainer.'))
      .toBeLessThan(body.indexOf('Standard terms of engagement'));
  });

  it('keeps its paragraphs, and escapes what is typed', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('engagement.scope_terms',
                       'First paragraph.

<b>Second</b> paragraph.', '${AT}')`);

    const body = await letter(h);
    expect(body).toContain('First paragraph.');
    expect(body).toContain('&lt;b&gt;Second&lt;/b&gt;');
    expect(body).not.toContain('<b>Second</b>');
  });

  it('is on the letter and not on the quotation', async () => {
    const h = mount();
    withWording(h);
    quote(h);
    h.db.exec(`INSERT OR REPLACE INTO settings (key, value, updated_at)
               VALUES ('engagement.scope_terms', 'A limited scope retainer.', '${AT}')`);

    const body = await (await h.request('/quotes/q1/print')).text();
    expect(body).not.toContain('A limited scope retainer.');
    expect(body).not.toContain('Short Form Terms of Engagement');
  });
});
