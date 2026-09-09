/**
 * A quotation is named, not described — and there is one list of the work.
 *
 * Two questions from the practice on 8 September 2026, an hour apart, with the
 * same answer underneath them.
 *
 * **"this field called Scope seems superfluous. why do i need to enter details
 * in it when that will be in the quotation?"** Half right. The *paragraph* it
 * printed on the quotation was superfluous — the items are the scope, and a
 * sentence beside them can only repeat them or disagree. But the value is the
 * quotation's **name**: the quotes list, the quote's own heading, the
 * dashboard, search, the expiry alert, the email subject, the invoice raised
 * from it and the bulk export all read it. So it stays and stops being typed.
 *
 * **"the field From the catalogue — where does it feed from? ... quotation is
 * for precisely visa types or case types we are working on so why not?"** No
 * good reason. It fed from `service_items`, into which the case types had been
 * copied once — and the copy had already drifted: two live case types had no
 * catalogue row, one of them the very work being quoted when the question was
 * asked.
 *
 * What is held here: the name is composed the same way a matter's is, a matter
 * wins over the boxes when one is chosen, and the case types are read live
 * rather than copied.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';
import { quoteName, quoteNameFrom } from '../src/core/casename';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser();

const TYPES = [
  { key: 'rv_partner', label: 'RV. Partner' },
  { key: 'vv_parent_grandparent', label: 'VV. Parent Grandparent' },
];

function mount() {
  const h = mountModule(quotesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Larisa MIKHAILOVA','active','${AT}','${AT}'),
                    ('cl2','CL-0002','individual','Quang Truong DO','active','${AT}','${AT}')`);
  h.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('vocab.case_types', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(TYPES.map((t) => `${t.key} | ${t.label}`).join('\n'), AT);
  return h;
}

const matter = (h: ReturnType<typeof mount>, id: string, ref: string, clientId: string,
                type: string, title: string, status = 'engaged') =>
  h.db.prepare(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,
                                   created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, ref, clientId, title, type, status, USER.id, AT, AT);

describe('what a quotation is called', () => {
  it('composes the name from the type and the client, type first', () => {
    // Type first is load-bearing, for the same reason it is on a matter: the
    // practice sorts by name to group by kind of work.
    expect(quoteName('RV. Partner', null, 'Larisa MIKHAILOVA')).toBe('RV. Partner — Larisa MIKHAILOVA');
  });

  it('joins the extra words to the type, not to the person', () => {
    // "VV. Parent Grandparent — Larisa MIKHAILOVA", not
    // "VV. Parent — Larisa MIKHAILOVA Grandparent". The extra words say what the
    // work is, so they must stay on the sorting side of the dash.
    expect(quoteName('VV. Parent', 'Grandparent', 'Larisa MIKHAILOVA'))
      .toBe('VV. Parent Grandparent — Larisa MIKHAILOVA');
  });

  it('reads the type through the vocabulary', () => {
    expect(quoteNameFrom(TYPES, 'rv_partner', null, 'Larisa MIKHAILOVA'))
      .toBe('RV. Partner — Larisa MIKHAILOVA');
  });

  it('still says something when there is no client yet', () => {
    // Three of the five live quotations have no client. A name is NOT NULL.
    expect(quoteNameFrom(TYPES, 'rv_partner', null, null)).toBe('RV. Partner');
  });
});

describe('creating a quotation', () => {
  it('names it from the type and the client', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    expect(h.get<{ description: string }>('SELECT description FROM quotes')!.description)
      .toBe('RV. Partner — Larisa MIKHAILOVA');
  });

  it('adds the extra words where they are given', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'vv_parent_grandparent',
                              descriptor: 'second application', with_letter: '0' });
    expect(h.get<{ description: string }>('SELECT description FROM quotes')!.description)
      .toBe('VV. Parent Grandparent second application — Larisa MIKHAILOVA');
  });

  it('takes the matter’s own name when a matter is chosen', async () => {
    // One fact, one owner. The matter already knows its type and its client;
    // asking again is how the two come to disagree.
    const h = mount();
    matter(h, 'k1', 'CASE-26-064', 'cl2', 'rv_partner', 'RV. Partner — Quang Truong DO');
    await h.post('/quotes', { case_id: 'k1', case_type: 'vv_parent_grandparent',
                              descriptor: 'ignored', with_letter: '0' });
    const q = h.get<{ description: string; client_id: string; case_id: string }>(
      'SELECT description, client_id, case_id FROM quotes')!;
    expect(q.description).toBe('RV. Partner — Quang Truong DO');
    expect(q.case_id).toBe('k1');
  });

  it('bills the matter’s client, not whoever was left in the client box', async () => {
    // A quotation naming one person and billing another is the fault this
    // prevents, and it is silent when it happens.
    const h = mount();
    matter(h, 'k1', 'CASE-26-064', 'cl2', 'rv_partner', 'RV. Partner — Quang Truong DO');
    await h.post('/quotes', { case_id: 'k1', client_id: 'cl1', with_letter: '0' });
    expect(h.get<{ client_id: string }>('SELECT client_id FROM quotes')!.client_id).toBe('cl2');
  });

  it('refuses a quotation with neither a matter nor a type', async () => {
    // It has to be called something, and nothing here is typed any more.
    const h = mount();
    const res = await h.post('/quotes', { client_id: 'cl1', with_letter: '0' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/quotes/new');
    expect(h.count('SELECT COUNT(*) AS n FROM quotes')).toBe(0);
  });

  it('offers the visa types and no free-text scope box on the form', async () => {
    const h = mount();
    const body = await (await h.request('/quotes/new')).text();
    expect(body).toContain('name="case_type"');
    expect(body).toContain('VV. Parent Grandparent');
    expect(body).toContain('name="case_id"');
    expect(body, 'the old free-text Scope box is gone')
      .not.toContain('name="description"');
  });

  it('does not print a Scope paragraph on the quotation', async () => {
    // The items are the scope. A sentence beside them can only repeat them or
    // disagree with them.
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    expect(body).not.toContain('<h3>Scope</h3>');
    // And no reference line describing the work either — see the reference
    // block tests at the foot of this file. The items are the scope.
    expect(body).not.toContain('<dt>Re</dt>');
  });
});

describe('one list of the work the practice does', () => {
  const schema = () => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    return db;
  };

  it('has no case-type copies left in the catalogue', () => {
    // 67 of the 74 live rows were a name the vocabulary already had, and none
    // of them carried a price.
    const db = schema();
    const copies = (db.prepare(
      `SELECT COUNT(*) n FROM service_items WHERE id LIKE 'svc\\_t\\_%' ESCAPE '\\'` ) as any)
      .get().n;
    expect(copies).toBe(0);
  });

  it('keeps the rows that are not a kind of matter', () => {
    // Merging both ways would offer "Police certificate" as a kind of matter.
    // Everything quotable is not a case type; every case type is quotable.
    const db = schema();
    const names = (db.prepare('SELECT name FROM service_items').all() as any[]).map((r) => r.name);
    expect(names.length).toBeGreaterThan(0);
  });

  it('gives a quote line somewhere to record the kind of work', () => {
    const db = schema();
    const cols = (db.prepare(`SELECT name FROM pragma_table_info('quote_items')`).all() as any[])
      .map((r) => r.name);
    expect(cols).toContain('case_type');
    expect(cols, 'a catalogue row is still a different thing').toContain('service_item_id');
  });
});

describe('migration 0074 carries the lines across before deleting the rows', () => {
  const upTo74 = () => {
    const db = new DatabaseSync(':memory:');
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((f) => f < '0074')) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}');
             INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO quotes (id,ref,client_id,description,amount_cents,gst_cents,
                                 disbursements_cents,currency,status,created_at,updated_at)
             VALUES ('q1','Q-1','c1','A quote',0,0,0,'NZD','draft','${AT}','${AT}');
             DELETE FROM service_items;
             INSERT INTO service_items (id,name,kind,unit_label,unit_amount_cents,sort_order,
                                        created_at,updated_at)
             VALUES ('svc_t_rv_partner','RV. Partner','professional','item',0,100,'${AT}','${AT}'),
                    ('svc_seed_hourly','Professional time','professional','hour',35000,10,'${AT}','${AT}');
             INSERT INTO quote_items (id,quote_id,position,service_item_id,description,kind,unit_label,
                                      quantity_milli,unit_amount_cents,net_cents,gst_cents,gross_cents,
                                      created_at,updated_at)
             VALUES ('qit1','q1',0,'svc_t_rv_partner','Partner work','professional','item',
                     1000,100000,100000,15000,115000,'${AT}','${AT}'),
                    ('qit2','q1',1,'svc_seed_hourly','Time','professional','hour',
                     1000,35000,35000,5250,40250,'${AT}','${AT}')`);
    db.exec(readFileSync(
      `migrations/${files.find((f) => f.startsWith('0074'))!}`, 'utf8'));
    return db;
  };

  it('keeps the kind of work when the copied row goes', () => {
    // `service_item_id` is ON DELETE SET NULL, so deleting first would have
    // lost it silently — the line would still price correctly and the letter
    // would quietly drop its clauses.
    const db = upTo74();
    const line = ((db.prepare(`SELECT service_item_id, case_type FROM quote_items WHERE id='qit1'`) as any).get());
    expect(line.case_type).toBe('rv_partner');
    expect(line.service_item_id).toBe(null);
  });

  it('leaves a line on a real catalogue row alone', () => {
    const db = upTo74();
    const line = ((db.prepare(`SELECT service_item_id, case_type FROM quote_items WHERE id='qit2'`) as any).get());
    expect(line.service_item_id).toBe('svc_seed_hourly');
    expect(line.case_type).toBe(null);
  });

  it('leaves the priced rows in the catalogue', () => {
    const db = upTo74();
    const names = (db.prepare('SELECT name FROM service_items ORDER BY name').all() as any[])
      .map((r) => r.name);
    expect(names).toEqual(['Professional time']);
  });

  it('records what it removed', () => {
    const db = upTo74();
    const row = ((db.prepare(`SELECT meta_json FROM audit_log WHERE id='aud_cat74'`) as any).get());
    expect(JSON.parse(row.meta_json))
      .toMatchObject({ copied_rows_removed: 1, rows_kept: 1, quote_lines_carried_across: 1 });
  });
});

/**
 * What the quotation says it is about.
 *
 * **Asked on 9 September 2026:** *"here no need for the name in section Re,
 * just the type of visa will suffice — e.g. RV. Partner"*. The client is
 * already named at the head of the document, and a reference line repeating
 * them says nothing the reader did not have.
 */
describe('the reference block on a printed quotation', () => {
  /**
   * **The "Re" line is gone.** Asked for on 9 September 2026: *"remove the Re
   * RV. Partner bit completely — the body of the quote is telling enough."*
   *
   * It had already been narrowed that morning, from "RV. Partner — <the
   * client's name>" to the kind of work alone, because the client is named at
   * the head of the document. The practice then looked at the result and made the
   * obvious next observation: the items below name the work, line by line, with
   * a figure against each. A heading reading "RV. Partner" above a list
   * beginning "RV. Partner" is the document repeating itself.
   *
   * This is pinned because it was built, narrowed and then removed inside a
   * day, and the tests for the two intermediate states would otherwise sit here
   * describing a line that is not printed.
   */
  it('does not carry a Re line at all', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    expect(body).not.toContain('<dt>Re</dt>');
  });

  it('still says which quotation, what it is, and how long it stands', async () => {
    // What the block is for. Losing the Re line must not quietly lose the rest.
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    // Printed in capitals, as the practice writes it — by the stylesheet
    // rather than in the markup, so the words a screen reader announces and
    // the words somebody copies off the page are still "Fee quote" and not
    // nine separate letters.
    expect(body).toContain('class="quote-doc-kind">Fee quote</p>');
    expect(readFileSync('public/app.css', 'utf8'))
      .toMatch(/\.quote-doc-kind \{[^}]*text-transform: uppercase/);
    expect(body).toContain('<dt>Quote</dt>');
    expect(body).toContain('<dt>Issued</dt>');
    expect(body).toContain('<dt>Valid until</dt>');
  });

  it('names the kind of work in the body, where it belongs', async () => {
    // The reason the Re line could go: the work is on the page already.
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    h.db.exec(`INSERT INTO quote_items (id, quote_id, position, description, kind, unit_label,
                 quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                 net_cents, gst_cents, gross_cents, created_at, updated_at)
               VALUES ('qi9', '${id}', 0, 'RV. Partner', 'professional', '',
                       1000, 0, 'exclusive', 1500, 0, 0, 0, '${AT}', '${AT}')`);
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    expect(body).toContain('RV. Partner');
  });
});

/**
 * The payment schedule, in the figures the client actually pays.
 *
 * **Asked on 9 September 2026:** the stages *"should already be showing the GST
 * inclusive amounts"*. Each row read "$2,000.00 + GST" while the total beneath
 * them was inclusive — so the rows and their own total were in different
 * currencies, and a client had to do arithmetic on a payment schedule before it
 * meant anything.
 */
describe('the payment stages on a printed quotation', () => {
  const staged = async (h: ReturnType<typeof mount>) => {
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    // The quotation has to be worth what the schedule promises: since migration
    // 0077 the database refuses stages that come to more than the quotation
    // does. In the register this is never a question, because the header
    // figures are rewritten from the lines after every edit; here the stages go
    // in by hand, so the header goes in by hand with them.
    h.db.exec(`UPDATE quotes SET amount_cents = 200000, gst_cents = 30000,
                 disbursements_cents = 153000 WHERE id = '${id}'`);
    // $2,000 plus 15% GST, and an INZ fee that is already inclusive.
    h.db.exec(`INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
                 gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
               VALUES ('s1', '${id}', 0, 'Stage 1', 'On instruction', 200000,
                       'exclusive', 1500, 200000, 30000, 230000, '${AT}', '${AT}'),
                      ('s2', '${id}', 1, 'Stage 2', 'INZ fee', 153000,
                       'inclusive', 1500, 133043, 19957, 153000, '${AT}', '${AT}')`);
    return (await h.request(`/quotes/${id}/print`)).text();
  };

  it('shows what is payable, not a figure plus a promise of tax', async () => {
    const h = mount();
    const body = await staged(h);
    expect(body).toContain('$2,300.00');
    expect(body).not.toContain('$2,000.00 + GST');
    expect(body).not.toContain('+ GST');
  });

  it('leaves an inclusive stage exactly as it stands', async () => {
    const h = mount();
    const body = await staged(h);
    expect(body).toContain('$1,530.00');
  });

  it('adds up to the total printed beneath it', async () => {
    // The rows and the total are now the same kind of number, which is the
    // whole complaint: 2,300 + 1,530 = 3,830.
    const h = mount();
    const body = await staged(h);
    expect(body).toContain('$3,830.00');
  });
});

describe('the parties block', () => {
  it('uses the defined terms, capitalised as the letter uses them', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    expect(body).toContain('<dt>The Lawyer</dt>');
    expect(body).toContain('<dt>The Client</dt>');
    expect(body).not.toContain('<dt>The lawyer</dt>');
  });

  it('puts the nomination beside the name, in brackets, rather than under it', async () => {
    const h = mount();
    await h.post('/quotes', { client_id: 'cl1', case_type: 'rv_partner', with_letter: '0' });
    const id = h.get<{ id: string }>('SELECT id FROM quotes')!.id;
    const body = await (await h.request(`/quotes/${id}/print`)).text();
    expect(body).toMatch(/<\/strong>\s*<span class="small muted">\(Nominated representative/);
    // Not on a line of its own beneath the name, where it read as a second
    // fact about them rather than a note about which name this is.
    expect(body).not.toContain('<div class="small">Nominated representative');
  });
});
