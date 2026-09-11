/**
 * The recipient picker on the quotation email, and why it reads the register.
 *
 * A separate table of remembered addresses was started and then abandoned,
 * because the practice asked the question that ended it: *"is this not a case
 * that 99% of emails from the system are to be sent to those who are already in
 * the register? if so - why create separate email register? should we not be
 * able to find the email that is already in the system and the name of the
 * person holding it?"*
 *
 * So these tests pin two things together. The picker offers the people the
 * register already holds — clients and organisations both, the ones on this
 * quotation first — and an address the register does *not* hold is named on the
 * screen rather than quietly written into a store of its own.
 *
 * Every name and address below is invented for this file.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';
import { ROLE_PERMISSIONS } from '../src/core/rbac';

const AT = '2026-09-10T02:00:00Z';
const USER = fakeUser();

/** Every option the picker offers, in the order the page offers them. */
function optionValues(body: string): string[] {
  return [...body.matchAll(/<option value="([^"]+)" label="/g)].map((m) => m[1]!);
}

/**
 * One quotation, on a matter, with an agency named on it.
 *
 * The shape that matters: the client, an *organisation* client reached through
 * an administrative contact on the quotation, a partner who is a party on the
 * matter but not on the quotation, an unrelated client, and an archived file.
 */
function harness() {
  const h = mountModule(quotesModule, { user: USER });
  const x = (sql: string, ...p: unknown[]) => (h.db.prepare(sql) as any).run(...p);

  x(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`, USER.id, USER.email, USER.name, AT, AT);

  const client = (id: string, ref: string, kind: string, name: string,
                  email: string | null, status = 'active') =>
    x(`INSERT INTO clients (id, ref, kind, full_name, email, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`, id, ref, kind, name, email, status, AT, AT);

  client('cl_client', 'CL-9001', 'individual', 'TARA HOLLOWAY', 'tara.holloway@example.test');
  client('cl_agency', 'CL-9002', 'organisation', 'BRIDGEWATER MIGRATION LTD', 'partners@example.test');
  client('cl_partner', 'CL-9003', 'individual', 'ANNA BLYTHE', 'anna.blythe@example.test');
  client('cl_other', 'CL-9004', 'individual', 'ZED WHITTAKER', 'zed.whittaker@example.test');
  client('cl_closed', 'CL-9005', 'individual', 'A CLOSED FILE', 'closed.file@example.test', 'archived');
  client('cl_noemail', 'CL-9006', 'individual', 'NOBODY WITH AN ADDRESS', null);

  x(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to, created_at, updated_at)
     VALUES ('k1','M-9001','cl_client','A matter','partner_resident','open',?,?,?)`, USER.id, AT, AT);
  // The matter's own parties. The principal applicant row is written by the
  // migration that created the table, so only the partner is added here.
  x(`INSERT INTO case_parties (id, case_id, client_id, role, created_at)
     VALUES ('cp1','k1','cl_partner','partner',?)`, AT);

  x(`INSERT INTO quotes (id, ref, client_id, case_id, description, amount_cents, gst_cents,
       disbursements_cents, currency, status, created_by, created_at, updated_at)
     VALUES ('q1','Q-9001','cl_client','k1','A matter',700000,105000,0,'NZD','draft',?,?,?)`,
    USER.id, AT, AT);

  const party = (id: string, position: number, role: string, kind: string, name: string,
                 email: string | null, clientId: string | null) =>
    x(`INSERT INTO quote_parties (id, quote_id, position, role, kind, full_name, email,
         client_id, created_at, updated_at) VALUES (?,'q1',?,?,?,?,?,?,?,?)`,
      id, position, role, kind, name, email, clientId, AT, AT);

  // The agency, as this quotation recorded it — a snapshot of a client record
  // that has since been tidied up, holding the same address under an older name.
  party('qp1', 1, 'admin_contact', 'organisation', 'Bridgewater (as typed)',
    'partners@example.test', 'cl_agency');
  // Somebody named on the quotation who is not in the register at all.
  party('qp2', 2, 'associated', 'person', 'MARCUS DELACROIX', 'marcus.delacroix@example.test', null);

  return h;
}

const compose = async (h: ReturnType<typeof harness>) =>
  (await h.request('/quotes/q1/email')).text();

describe('the compose screen offers who the register already holds', () => {
  it('offers a client’s address with their name', async () => {
    const body = await compose(harness());
    expect(body).toContain(
      '<option value="tara.holloway@example.test" label="TARA HOLLOWAY — tara.holloway@example.test">');
  });

  it('offers an organisation client too — an agency is how a client is reached', async () => {
    const body = await compose(harness());
    expect(body).toContain(
      '<option value="partners@example.test" label="BRIDGEWATER MIGRATION LTD — partners@example.test">');
  });

  it('attaches the list to the boxes that were already there, and does not replace them', async () => {
    const body = await compose(harness());
    // Still a text input, so an address nobody has written to can be typed.
    expect(body).toMatch(/<input id="f_to" name="to" type="text"[^>]*list="known-recipients"/s);
    expect(body).toMatch(/<input id="f_cc" name="cc" type="text"[^>]*list="known-recipients"/s);
    expect(body).toContain('<datalist id="known-recipients">');
    // Not a dropdown, which would refuse a new client's first address.
    expect(body).not.toMatch(/<select[^>]*name="to"/);
  });

  it('needs no JavaScript: the picker is markup, not a script', async () => {
    const body = await compose(harness());
    // Nothing on this page turns the list on, and the register has no inline
    // script anyway — the strict content policy refuses one.
    expect(body).not.toContain('<script>');
  });

  it('leaves a client with no address out, and an archived file too', async () => {
    const values = optionValues(await compose(harness()));
    expect(values).not.toContain('closed.file@example.test');
    expect(values.join(' ')).not.toContain('NOBODY WITH AN ADDRESS');
  });
});

describe('the order is what makes it useful', () => {
  it('puts this quotation’s own client first', async () => {
    const values = optionValues(await compose(harness()));
    expect(values[0]).toBe('tara.holloway@example.test');
  });

  it('puts this quotation’s parties, then the matter’s, ahead of everybody else', async () => {
    const values = optionValues(await compose(harness()));
    const at = (a: string) => values.indexOf(a);
    // On the quotation.
    expect(at('partners@example.test')).toBeLessThan(at('anna.blythe@example.test'));
    expect(at('marcus.delacroix@example.test')).toBeLessThan(at('anna.blythe@example.test'));
    // On the matter, ahead of a client with nothing to do with either.
    expect(at('anna.blythe@example.test')).toBeLessThan(at('zed.whittaker@example.test'));
    expect(at('zed.whittaker@example.test')).toBeGreaterThan(-1);
  });

  it('names a quotation party who is not in the register yet', async () => {
    const body = await compose(harness());
    expect(body).toContain('label="MARCUS DELACROIX — marcus.delacroix@example.test"');
  });
});

describe('one address, one entry', () => {
  it('offers an address held by two records once, under the client record’s name', async () => {
    const body = await compose(harness());
    const values = optionValues(body);
    expect(values.filter((v) => v === 'partners@example.test')).toHaveLength(1);
    // The living record wins the name; the quotation's snapshot of it does not.
    expect(body).toContain('label="BRIDGEWATER MIGRATION LTD — partners@example.test"');
    expect(body).not.toContain('Bridgewater (as typed)');
  });

  it('offers every other address once as well', async () => {
    const values = optionValues(await compose(harness()));
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('an address the register does not hold', () => {
  const preview = (h: ReturnType<typeof harness>, to: string, cc = '') =>
    h.post('/quotes/q1/email/preview', {
      to, cc, subject: 'Fee quote Q-9001', body: 'Dear client,\n\nAs discussed.', format: 'html',
    }).then((r) => r.text());

  it('is named on the screen before anything is sent', async () => {
    const body = await preview(harness(), 'someone.new@example.test');
    expect(body).toContain('on nobody’s record in the register');
    expect(body).toContain('someone.new@example.test');
  });

  it('offers to put it on a client record rather than remembering it', async () => {
    const body = await preview(harness(), 'someone.new@example.test');
    expect(body).toContain('/clients/new?email=someone.new%40example.test');
    expect(body).toContain('/clients?q=someone.new%40example.test');
    // The two links are the offer, and they are what this test is about. The
    // sentence that used to follow them — that the register keeps no address of
    // its own, because an address belongs on the record of whoever holds it —
    // went with the rest of the app's explanatory prose on 11 September 2026.
    // What must survive is that the quotation still goes out regardless.
    expect(body.replace(/\s+/g, ' ')).toMatch(/will still be sent/i);
  });

  it('says nothing when every recipient is on a record', async () => {
    const body = await preview(harness(), 'tara.holloway@example.test', 'partners@example.test');
    expect(body).not.toContain('on nobody’s record in the register');
  });

  it('counts a copy-to address as a recipient', async () => {
    const body = await preview(harness(), 'tara.holloway@example.test', 'a.stranger@example.test');
    expect(body).toContain('a.stranger@example.test');
    expect(body).toContain('on nobody’s record in the register');
  });

  it('does not call an address unknown merely because it is on a quotation party', async () => {
    // Marcus is on the quotation but has no client record, so the register
    // genuinely cannot say whose address it is — and says so.
    const body = await preview(harness(), 'marcus.delacroix@example.test');
    expect(body).toContain('on nobody’s record in the register');
  });
});

describe('typing an address the register has never seen', () => {
  /** Every table and how many rows it holds, so a new store cannot hide. */
  function rowCounts(h: ReturnType<typeof harness>): Record<string, number> {
    const names = ((h.db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ) as any).all() as Array<{ name: string }>).map((r) => r.name);
    return Object.fromEntries(names.map((n) => [n, h.count(`SELECT COUNT(*) AS n FROM "${n}"`)]));
  }

  it('still sends, and records the letter', async () => {
    const h = harness();
    const res = await h.post('/quotes/q1/email', {
      to: 'a.stranger@example.test', cc: '', subject: 'Fee quote Q-9001',
      body: 'Dear client,\n\nAs discussed.', format: 'html', mark_sent: 'on',
    });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM outbound_emails WHERE to_addr = ?`,
      'a.stranger@example.test')).toBe(1);
  });

  it('is not written into a store of its own — the only rows added are the letter and its notes',
    async () => {
      const h = harness();
      const before = rowCounts(h);
      await h.post('/quotes/q1/email', {
        to: 'a.stranger@example.test', cc: 'tara.holloway@example.test',
        subject: 'Fee quote Q-9001', body: 'Dear client,\n\nAs discussed.', format: 'html',
      });
      const after = rowCounts(h);
      const grew = Object.keys(after).filter((t) => after[t]! > before[t]!);
      // The letter that went, the file notes that record it, and the audit
      // trail. Nowhere is the address itself kept as a thing to reuse.
      expect(grew.sort()).toEqual(['audit_log', 'entries', 'outbound_emails']);
    });

  it('has no address book to write to in the first place', () => {
    const h = harness();
    const tables = ((h.db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ) as any).all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables.filter((t) => /address|contact|recipient/i.test(t))).toEqual([]);
  });

  it('still refuses the whole list when one address is malformed', async () => {
    // The parsing the practice already has, untouched: a message believed to
    // have gone to two people and gone to one is worse than one that did not go.
    const h = harness();
    const res = await h.post('/quotes/q1/email', {
      to: 'tara.holloway@example.test, not-an-address', cc: '',
      subject: 'Fee quote Q-9001', body: 'Dear client,\n\nAs discussed.', format: 'html',
    });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM outbound_emails`)).toBe(0);
  });
});

describe('who can see the list', () => {
  /**
   * The picker puts client names and addresses on a screen, so it must be no
   * wider than the screen it is on. The compose screen is behind `mail:send`,
   * and every role that holds `mail:send` also holds `register:read` — so
   * anybody who can open this page can already open the client list and read
   * the same names and addresses there. Asserted as a rule about the roles
   * rather than checked once by hand, because a new role is where this would
   * quietly stop being true.
   */
  it('shows nothing that a person with mail:send cannot already read', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes('mail:send')) {
        expect(permissions, role).toContain('register:read');
      }
    }
  });

  it('is not reachable at all without mail:send', async () => {
    // An assistant may work the register but not send from it.
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'assistant' }) });
    const res = await h.request('/quotes/q1/email');
    expect(res.status).not.toBe(200);
  });
});
