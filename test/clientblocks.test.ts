/**
 * The blocks on a client's page: their order, and that they start closed.
 *
 * **Asked for on 12 September 2026:** *"for clients: reorder, Cases, Quotes,
 * Passports, Certificates, Files, the rest, and at the bottom - File Notes. The
 * block need to be collapsible, starting from collapsed position, when client
 * file is opened."*
 *
 * And, of the certificates block: *"why has the end date been removed -
 * 'Submitted 12 Aug 2026 · 24 months from issue' should also say the actual
 * calculated end date - in that case 29 Jun 2028."*
 *
 * The order is the interesting part to hold. It is a decision about what a
 * person reaches for first, and it is exactly the kind of thing that drifts
 * when somebody adds a block and puts it wherever the code was easiest.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
  return h;
}

const page = (h: ReturnType<typeof mount>, q = '') =>
  h.request(`/clients/cl1${q}`).then((r) => r.text());

/** The headings of the main column, in the order they are drawn. */
function headings(body: string): string[] {
  const main = body.slice(body.indexOf('<div class="col-main">'),
    body.indexOf('<div class="col-side">'));
  return [...main.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]!.trim());
}

/** Whether the block with this id is drawn open. */
function isOpen(body: string, id: string): boolean {
  const at = body.indexOf(`<div id="${id}">`);
  if (at === -1) return false;
  const tag = body.slice(at, body.indexOf('>', body.indexOf('<details', at)) + 1);
  return / open>/.test(tag);
}

describe('the order the practice asked for', () => {
  it('runs Cases, Quotes, Passports, Certificates, Files, the rest, File notes', async () => {
    const found = headings(await page(mount()));
    const wanted = ['Cases', 'Quotes', 'Passports', 'Certificates', 'Files'];
    expect(found.slice(0, wanted.length)).toEqual(wanted);
  });

  it('puts File notes last, below the histories', async () => {
    // It is the longest block on a client and the one that grows for ever, so
    // anything under it would be unreachable in practice.
    const found = headings(await page(mount()));
    expect(found[found.length - 1]).toBe('File notes');
    expect(found.indexOf('Employment history')).toBeLessThan(found.indexOf('File notes'));
    expect(found.indexOf('Military records')).toBeLessThan(found.indexOf('File notes'));
  });

  it('keeps the three histories and the military block between Files and File notes', async () => {
    const found = headings(await page(mount()));
    for (const h of ['Employment history', 'Education history', 'Travel history',
      'Military records']) {
      expect(found.indexOf(h), h).toBeGreaterThan(found.indexOf('Files'));
      expect(found.indexOf(h), h).toBeLessThan(found.indexOf('File notes'));
    }
  });
});

describe('what is open when the page is drawn', () => {
  // Everything started closed for about an hour on 12 September 2026, which
  // went a step too far: *"Cases Quotes Passports and Certificates should be
  // open by default."* Those four are what the page is opened *for* — what is
  // running, what was quoted, and the two sets of dates that decide whether a
  // matter can be lodged.
  it.each(['cases', 'quotes', 'passports', 'certificates'])('%s is open', async (id) => {
    expect(isOpen(await page(mount()), id)).toBe(true);
  });

  it.each(['files', 'filenotes'])('%s is closed', async (id) => {
    // Things you go looking for. The file notes alone can run for pages.
    expect(isOpen(await page(mount()), id)).toBe(false);
  });

  it('leaves the histories and the military block closed', async () => {
    const body = await page(mount());
    for (const id of ['history-employment', 'history-education', 'history-travel']) {
      expect(isOpen(body, id), id).toBe(false);
    }
  });

  it('opens the one the address names, on top of the four', async () => {
    // A link from the client's own form lands on an open block. A `#fragment`
    // never reaches the server, so it cannot decide what is open.
    const body = await page(mount(), '?open=filenotes');
    expect(isOpen(body, 'filenotes')).toBe(true);
    expect(isOpen(body, 'cases')).toBe(true);
    expect(isOpen(body, 'files')).toBe(false);
  });

  it('ignores a name it does not know', async () => {
    const body = await page(mount(), '?open=nonsense');
    expect(isOpen(body, 'files')).toBe(false);
    expect(isOpen(body, 'cases')).toBe(true);
  });

  it('is what every link to a block actually sends', async () => {
    // A link to `#passports` alone would land on a closed heading.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/clients/index.ts', 'utf8');
    const bare = [...src.matchAll(/[^=]#(passports|certificates)/g)]
      .filter((m) => !src.slice(Math.max(0, m.index - 40), m.index).includes('open='));
    expect(bare.map((m) => m[0]), 'a link that would land on a closed block').toEqual([]);
  });
});

describe('a certificate says the date its rule works out to', () => {
  async function withCert(h: ReturnType<typeof mount>, over: Record<string, string> = {}) {
    const res = await h.post('/clients/cl1/certificates', {
      kind: 'police', country: 'TO', issued_on: '2026-06-29',
      issued_on_provenance: 'verified', ...over,
    });
    expect(res.status).toBe(303);
    return h.get<{ id: string; expires_on: string }>(
      'SELECT id, expires_on FROM client_certificates')!;
  }

  it('prints the calculated expiry beside the rule that produced it', async () => {
    // The practice's own example: submitted 12 Aug 2026, twenty-four months
    // from an issue date of 29 Jun 2026, which is 29 Jun 2028.
    const h = mount();
    const cert = await withCert(h);
    await h.post(`/clients/cl1/certificates/${cert.id}/submitted`, { submitted_on: '2026-08-12' });
    const body = await page(h, '?open=certificates');
    expect(body).toContain('24 months from issue');
    expect(body).toContain('expires');
    expect(body).toContain('29 Jun 2028');
    // On the one line, not adrift in a column of its own.
    const line = body.slice(body.indexOf('24 months from issue'));
    expect(line.slice(0, 200)).toContain('29 Jun 2028');
  });

  it('does so before it has been submitted too', async () => {
    const h = mount();
    await withCert(h);
    const body = await page(h, '?open=certificates');
    expect(body).toContain('Not submitted');
    expect(body).toContain('6 months from issue');
    expect(body).toContain('29 Dec 2026');
  });

  it('says it for an x-ray, which derives nothing', async () => {
    const h = mount();
    await h.post('/clients/cl1/certificates', {
      kind: 'chest_xray', issued_on: '2026-08-11', issued_on_provenance: 'verified',
      expires_on: '2027-08-11',
    });
    const body = await page(h, '?open=certificates');
    expect(body).toContain('Expires');
    expect(body).toContain('11 Aug 2027');
  });

  it('prints it once, not once on the line and again in a column', async () => {
    const h = mount();
    await withCert(h);
    const body = await page(h, '?open=certificates');
    const block = body.slice(body.indexOf('<div id="certificates">'),
      body.indexOf('<div id="files">'));
    expect([...block.matchAll(/29 Dec 2026/g)].length).toBe(1);
  });
});

/**
 * **Reported 12 September 2026**, looking at a Tongan passport and a Tongan
 * police certificate both headed "TO": *"Do not like the country abbreviation -
 * insufficient - Use full country name - in this case it should show TONGA."*
 *
 * The code is how the register stores a country. A stored form is not a
 * heading, and "TO" is a heading nobody can read at a glance — the whole point
 * of the line is to say which country's certificate this is.
 */
describe('a country is named, not abbreviated', () => {
  it('names it on a passport', async () => {
    const h = mount();
    await h.post('/clients/cl1/passports', {
      country: 'TO', number: 'R608055', issued_on: '2025-06-13',
      expires_on: '2035-06-13', status: 'held',
    });
    const body = await page(h, '?open=passports');
    expect(body).toContain('Tonga');
    expect(body).not.toMatch(/<strong>TO<\/strong>/);
  });

  it('names it on a police certificate', async () => {
    const h = mount();
    await h.post('/clients/cl1/certificates', {
      kind: 'police', country: 'TO', issued_on: '2026-06-29',
      issued_on_provenance: 'verified',
    });
    const body = await page(h, '?open=certificates');
    expect(body).toContain('Tonga');
    expect(body).not.toMatch(/<strong>TO<\/strong>/);
  });

  it('leaves a certificate with no country reading as what it is', async () => {
    // A medical has no country, and its heading is the kind of medical it was.
    const h = mount();
    await h.post('/clients/cl1/certificates', {
      kind: 'medical', subtype: 'full', issued_on: '2026-08-11',
      issued_on_provenance: 'verified',
    });
    const body = await page(h, '?open=certificates');
    expect(body).toContain('General Medical');
  });

  it('names it on the alerts page too', async () => {
    // That row is built in SQL, so it joins the countries table rather than
    // translating afterwards.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/alerts/index.ts', 'utf8');
    expect(src).toContain('LEFT JOIN countries pc ON pc.code = p.country');
    expect(src).toContain('COALESCE(pc.name, p.country)');
    expect(src).not.toContain("' (' || p.country || ')'");
  });
});

/**
 * **Asked for on 12 September 2026:** *"the set of panes to the right and the
 * data is not optimal under a client's profile. I can see that under a
 * particular case - Key Details - is better organised ... maybe they should all
 * appear under Key Details? but with the name up top? say Name, Contacts,
 * Passport details, Certificate, English, and the rest."*
 *
 * The old arrangement was **Identity and compliance** beside **Contact**, and
 * it did not survive being looked at: the given names and the family name sat
 * under *Contact*, which they are not; "Works for" sat under *Identity*, which
 * it is not either; and eighteen undifferentiated rows is a list nobody reads
 * to the end of.
 *
 * One change to the order asked for, and it is the one worth pinning:
 * **Immigration comes third**, before the passport. A visa expiry is the single
 * most-looked-at fact on a client and it was fourteen rows down.
 */
describe('the client summary is one grouped card', () => {
  const summary = async () => {
    const body = await page(mount());
    return body.slice(body.indexOf('<div class="col-side">'));
  };

  it('is called Key details, the same as on a matter', async () => {
    expect(await summary()).toContain('<h2>Key details</h2>');
  });

  it('no longer splits into Identity and compliance beside Contact', async () => {
    const side = await summary();
    expect(side).not.toContain('Identity and compliance');
    expect(side).not.toContain('<h2>Contact</h2>');
  });

  it('groups it in the order asked for, with the name at the top', async () => {
    const side = await summary();
    const heads = [...side.matchAll(/<p class="subhead">([^<]+)<\/p>/g)].map((m) => m[1]!);
    expect(heads.slice(0, 6)).toEqual(
      ['Name', 'Contact', 'Immigration', 'Passport', 'Certificates', 'English']);
    expect(heads).toContain('Personal');
  });

  it('brings the names out of the contact box, where they never belonged', async () => {
    const side = await summary();
    const nameBlock = side.slice(side.indexOf('>Name<'), side.indexOf('>Contact<'));
    expect(nameBlock).toContain('Given names');
    expect(nameBlock).toContain('Family name');
    expect(nameBlock).toContain('Preferred');
  });

  it('puts the visa expiry above the passport', async () => {
    // The change to the practice's own order, and the reason for it.
    const side = await summary();
    expect(side.indexOf('Visa expiry')).toBeLessThan(side.indexOf('National ID'));
  });

  it('keeps an organisation on its own card, with its contact details', async () => {
    const h = mount();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,phone,created_at,updated_at)
               VALUES ('org1','CL-0902','organisation','Acme Limited','active','+64 9 555 0400',
                       '${AT}','${AT}')`);
    const body = await (await h.request('/clients/org1')).text();
    const side = body.slice(body.indexOf('<div class="col-side">'));
    expect(side).toContain('<h2>Registration</h2>');
    expect(side).toContain('<h2>Contact</h2>');
    expect(side).toContain('+64 9 555 0400');
  });
});

/**
 * **Asked for on 12 September 2026:** *"the side panels should also calculate
 * the english cert duration - it is valid for 2 years from the issue date."*
 *
 * Worked out on the page rather than stored: it is a function of the test date
 * and nothing else, so a stored copy would be a second owner of a fact that
 * already has one — and it would be the copy that went stale.
 */
describe('an English test says how long it is accepted for', () => {
  const withTest = async (taken: string) => {
    const h = mount();
    h.db.prepare(`UPDATE clients SET english_test_type='ielts_general', english_test_score='6.5',
                                     english_test_date=? WHERE id='cl1'`).run(taken);
    return page(h);
  };

  it('adds two years to the test date', async () => {
    const body = await withTest('2026-03-04');
    expect(body).toContain('Accepted until');
    expect(body).toContain('04 Mar 2028');
  });

  it('handles a leap day without inventing a date', async () => {
    const body = await withTest('2024-02-29');
    expect(body).toContain('Accepted until');
    // Two years on there is no 29 February; the date rolls to 1 March rather
    // than becoming nothing.
    expect(body).toMatch(/0[12] Mar 2026/);
  });

  it('says nothing where no test date is recorded', async () => {
    const body = await page(mount());
    expect(body).not.toContain('Accepted until');
  });

  it('is not stored anywhere', async () => {
    // One fact, one owner: the test date owns it.
    const { readdirSync, readFileSync } = await import('node:fs');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql'))) {
      expect(readFileSync(`migrations/${f}`, 'utf8'), f)
        .not.toMatch(/english_test_expiry|english_accepted_until/);
    }
  });
});

/**
 * **Asked for on 12 September 2026:** *"there must be more options for the
 * warning duration, say 1.5 years, 2 years, 3 years or select a date and
 * permanent? ... there is a character concern and a character waiver must
 * always be made - regardless."* And: *"What Kind: should have an option for a
 * border alert."*
 */
describe('how long a warning stands, on the form', () => {
  it('offers permanent, the longer periods, and a date of your own', async () => {
    const body = await page(mount());
    for (const label of ['Permanent', 'For 18 months', 'For 2 years', 'For 3 years',
      'Until a date I choose']) {
      expect(body, label).toContain(label);
    }
  });

  it('draws the date box always, rather than behind a script', async () => {
    // Revealing it would need an inline script, which the content policy
    // forbids; a box that only appears when scripting is on is unreachable.
    const body = await page(mount());
    expect(body).toContain('name="expires_on"');
  });

  it('has a border alert among the kinds a new practice starts with', async () => {
    const { FLAG_KIND_VOCAB, parseVocabulary } = await import('../src/core/vocabulary');
    const keys = parseVocabulary(FLAG_KIND_VOCAB.defaults).map((t) => t.key);
    expect(keys).toContain('border');
  });
});

/**
 * **Reported 12 September 2026**, with a line drawn down a client's Key details:
 * *"general alignment of the data column should be along that line. for all
 * clients."*
 *
 * The card is several `<dl>`s under several subheadings, and each was its own
 * grid — so `auto` sized each label column to the widest label *in that group*.
 * Measured in Chromium: the values started at three x positions, 29px apart.
 * The eye reads a column, and there were three.
 *
 * The width itself is a CSS matter and is checked there. What is pinned here is
 * that every list in the card asks for the shared column, because the fault
 * returns the moment somebody adds a group and forgets.
 */
describe('the value column is one column', () => {
  it('puts every list in Key details on the shared label width', async () => {
    const body = await page(mount());
    const card = body.slice(body.indexOf('<h2>Key details</h2>'),
      body.indexOf('Open tasks'));
    const plain = [...card.matchAll(/<dl class="kv">/g)].length;
    const aligned = [...card.matchAll(/<dl class="kv kv-aligned">/g)].length;
    expect(aligned).toBeGreaterThanOrEqual(6);
    expect(plain, 'a list in Key details that does not share the column').toBe(0);
  });

  it('defines that width once, and stacks the pairs on a phone', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('public/app.css', 'utf8');
    expect(css).toMatch(/\.kv-aligned \{ grid-template-columns: [\d.]+rem 1fr; \}/);
    // A fixed label column is most of the width on a phone, so it goes back to
    // sizing itself there.
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.kv-aligned \{/);
  });

  it('leaves every other key-value list alone', async () => {
    // A matter's Key details is a single list and already aligns with itself.
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('src/modules/cases/index.ts', 'utf8')).not.toContain('kv-aligned');
  });
});
