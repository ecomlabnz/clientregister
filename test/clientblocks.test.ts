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

describe('every block starts closed', () => {
  it.each(['cases', 'quotes', 'passports', 'certificates', 'files', 'filenotes'])(
    '%s', async (id) => {
      expect(isOpen(await page(mount()), id)).toBe(false);
    });

  it('opens the one the address names', async () => {
    // A link from the client's own form lands on an open block. A `#fragment`
    // never reaches the server, so it cannot decide what is open.
    const body = await page(mount(), '?open=passports');
    expect(isOpen(body, 'passports')).toBe(true);
    expect(isOpen(body, 'certificates')).toBe(false);
  });

  it('ignores a name it does not know', async () => {
    const body = await page(mount(), '?open=nonsense');
    expect(isOpen(body, 'cases')).toBe(false);
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
