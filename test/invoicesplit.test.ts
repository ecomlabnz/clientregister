/**
 * Dividing a bill.
 *
 * Was `test/feeshares.test.ts`, against a split that belonged to a matter. The
 * practice moved it: *"fee splits can be implemented in invoicing I believe"*,
 * and asked for it to be out of the way until wanted — *"the bill split should
 * be a button that opens the options… good if they are available but not always
 * visible - can be activated if and where needed."*
 *
 * The invoice is the better home for a second reason. A split against a matter
 * is a standing intention; a split against an invoice is a fact about money
 * that actually changed hands, and it freezes with the invoice that carries it.
 *
 * Three things are tested here, and the third is the one that needs the
 * database rather than a route: an issued invoice cannot be re-split, however
 * the row is reached.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { invoicesModule } from '../src/modules/invoices';
import { splitBaseFor } from '../src/core/invoices';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-04T00:00:00Z';
const USER = fakeUser({ id: 'u_sp', email: 'sp@example.test' });

function seeded(status = 'draft') {
  const h = mountModule(invoicesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x','admin','active',?,?)`).run(USER.id, USER.email, USER.name, AT, AT);
  h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                VALUES ('cl1','CL-1','individual','A PERSON','active',?,?)`).run(AT, AT);
  h.db.prepare(`INSERT INTO invoices (id,ref,client_id,description,payment_terms_days,status,
                                      currency,net_cents,gst_cents,gross_cents,paid_cents,
                                      created_at,updated_at,created_by)
                VALUES ('i1','INV-1','cl1','A bill',7,'draft','NZD',0,0,0,0,?,?,?)`)
    .run(AT, AT, USER.id);
  // $1,000 professional plus a $500 disbursement, so the base is visible.
  const line = (id: string, kind: string, net: number, gst: number) =>
    h.db.prepare(`INSERT INTO invoice_items (id,invoice_id,position,description,kind,unit_label,
                                             quantity_milli,unit_amount_cents,gst_treatment,gst_rate_bp,
                                             net_cents,gst_cents,gross_cents,created_at)
                  VALUES (?,'i1',0,'A line',?, 'item',1000,?,'exclusive',1500,?,?,?,?)`)
      .run(id, kind, net, net, gst, net + gst, AT);
  line('l1', 'professional', 100000, 15000);
  line('l2', 'disbursement', 50000, 0);
  // Issued only after the lines are on: an issued invoice cannot gain one, and
  // the database means it.
  if (status !== 'draft') {
    h.db.prepare(`UPDATE invoices SET status = ?, issued_on = ? WHERE id = 'i1'`).run(status, AT);
  }
  return h;
}

const shares = (h: ReturnType<typeof seeded>) =>
  h.db.prepare('SELECT * FROM invoice_shares ORDER BY position').all() as any[];

describe('what the split divides', () => {
  const lines = [
    { kind: 'professional', net_cents: 100000, gross_cents: 115000 },
    { kind: 'disbursement', net_cents: 50000, gross_cents: 50000 },
  ];

  it('divides professional fees only, GST-exclusive, by default', () => {
    // A disbursement is money passed through on the client's behalf — an INZ
    // fee, a medical, a translation. Apportioning it would hand somebody a
    // share of another organisation's fee.
    expect(splitBaseFor(lines, 'net_professional')).toBe(100000);
  });

  it('can be told to divide everything', () => {
    expect(splitBaseFor(lines, 'net_all')).toBe(150000);
  });

  it('can be told to divide professional fees including GST', () => {
    expect(splitBaseFor(lines, 'gross_professional')).toBe(115000);
  });

  it('is nothing when there are no professional fees to divide', () => {
    expect(splitBaseFor([{ kind: 'disbursement', net_cents: 50000, gross_cents: 50000 }],
      'net_professional')).toBe(0);
  });
});

describe('setting a split on a draft', () => {
  it('adds a party with a share', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    const [row] = shares(h);
    expect(row.label).toBe('Admin team');
    expect(row.percent_bp).toBe(3000);
    // The key is derived, not typed: two boxes for one answer is how one party
    // becomes two on different invoices.
    expect(row.party_key).toBe('admin_team');
  });

  it('reads a percentage however it is written', async () => {
    for (const [typed, bp] of [['30', 3000], ['30%', 3000], ['30.5%', 3050], ['100', 10000]] as const) {
      const h = seeded();
      await h.post('/invoices/i1/shares', { label: 'Someone', percent: typed });
      expect(shares(h)[0]?.percent_bp, typed).toBe(bp);
    }
  });

  it('refuses a share that is not a percentage, in words', async () => {
    // Asserting only "no share was created" passes on the database's own CHECK
    // throwing, which is a 500 rather than a refusal. The message is what
    // proves the route looked before it wrote.
    for (const bad of ['half', '-10', '120%', '0', '100.1']) {
      const h = seeded();
      const res = await h.post('/invoices/i1/shares', { label: 'Someone', percent: bad });
      expect(decodeURIComponent(res.headers.get('location') ?? ''), bad)
        .toContain('a percentage between 0 and 100');
      expect(shares(h), bad).toEqual([]);
    }
  });

  it('refuses a share left blank', async () => {
    const h = seeded();
    const res = await h.post('/invoices/i1/shares', { label: 'Someone', percent: '' });
    expect(res.status).toBe(303);
    expect(shares(h)).toEqual([]);
  });

  it('refuses the same party twice', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    const res = await h.post('/invoices/i1/shares', { label: 'admin  team', percent: '40%' });
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('already has a share');
    expect(shares(h).length).toBe(1);
  });

  it('removes a party again', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    await h.post('/invoices/i1/shares/admin_team/remove', {});
    expect(shares(h)).toEqual([]);
  });

  it('records who was added and taken off', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    await h.post('/invoices/i1/shares/admin_team/remove', {});
    // Ordered by rowid, not by `at`: both rows land in the same millisecond,
    // so ordering by time is a coin toss that passes most of the time.
    const actions = (h.db.prepare(
      `SELECT action FROM audit_log WHERE action LIKE 'invoice.share%' ORDER BY rowid`).all() as any[])
      .map((r) => r.action);
    expect(actions).toEqual(['invoice.share_added', 'invoice.share_removed']);
  });
});

describe('an issued invoice cannot be re-split', () => {
  it('is refused by the route', async () => {
    const h = seeded('issued');
    const res = await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('cannot be re-split');
    expect(shares(h)).toEqual([]);
  });

  it('is refused by the database, however the row is reached', () => {
    // The route is the courteous refusal; this is the real one. Attacked
    // directly, because a guarantee that only a handler keeps lasts until
    // somebody adds a second handler.
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','${AT}','${AT}')`);
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-1','individual','A','active','${AT}','${AT}')`);
    db.exec(`INSERT INTO invoices (id,ref,client_id,description,payment_terms_days,status,currency,
                                   net_cents,gst_cents,gross_cents,paid_cents,created_at,updated_at,created_by)
             VALUES ('i1','INV-1','cl1','A bill',7,'draft','NZD',0,0,0,0,'${AT}','${AT}','u1')`);

    const addShare = (id: string, bp: number) =>
      db.exec(`INSERT INTO invoice_shares (id,invoice_id,party_key,label,percent_bp,position,created_at,updated_at)
               VALUES ('${id}','i1','p${id}','P',${bp},0,'${AT}','${AT}')`);

    addShare('s1', 10000);
    db.exec(`UPDATE invoices SET status = 'issued' WHERE id = 'i1'`);

    expect(() => addShare('s2', 5000)).toThrow(/has been issued/);
    expect(() => db.exec(`UPDATE invoice_shares SET percent_bp = 5000 WHERE id = 's1'`))
      .toThrow(/has been issued/);
    expect(() => db.exec(`DELETE FROM invoice_shares WHERE id = 's1'`)).toThrow(/has been issued/);
  });

  it('refuses to issue an invoice whose split does not add up', () => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','${AT}','${AT}')`);
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-1','individual','A','active','${AT}','${AT}')`);
    db.exec(`INSERT INTO invoices (id,ref,client_id,description,payment_terms_days,status,currency,
                                   net_cents,gst_cents,gross_cents,paid_cents,created_at,updated_at,created_by)
             VALUES ('i1','INV-1','cl1','A bill',7,'draft','NZD',0,0,0,0,'${AT}','${AT}','u1')`);
    db.exec(`INSERT INTO invoice_shares (id,invoice_id,party_key,label,percent_bp,position,created_at,updated_at)
             VALUES ('s1','i1','a','A',7000,0,'${AT}','${AT}')`);

    // 70% and nothing else: the other 30% belongs to nobody.
    expect(() => db.exec(`UPDATE invoices SET status = 'issued' WHERE id = 'i1'`))
      .toThrow(/does not add up/);

    // Completed, it issues.
    db.exec(`INSERT INTO invoice_shares (id,invoice_id,party_key,label,percent_bp,position,created_at,updated_at)
             VALUES ('s2','i1','b','B',3000,1,'${AT}','${AT}')`);
    expect(() => db.exec(`UPDATE invoices SET status = 'issued' WHERE id = 'i1'`)).not.toThrow();
  });

  it('lets an invoice with no split at all issue freely', () => {
    // Most bills are not split, and that must stay the easy path.
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','${AT}','${AT}')`);
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-1','individual','A','active','${AT}','${AT}')`);
    db.exec(`INSERT INTO invoices (id,ref,client_id,description,payment_terms_days,status,currency,
                                   net_cents,gst_cents,gross_cents,paid_cents,created_at,updated_at,created_by)
             VALUES ('i1','INV-1','cl1','A bill',7,'draft','NZD',0,0,0,0,'${AT}','${AT}','u1')`);
    expect(() => db.exec(`UPDATE invoices SET status = 'issued' WHERE id = 'i1'`)).not.toThrow();
  });
});

describe('the split is out of the way until wanted', () => {
  it('is a disclosure, shut when there is no split', async () => {
    const h = seeded();
    const body = await (await h.request('/invoices/i1')).text();
    expect(body).toContain('Divide this bill between parties');
    // The tag that owns that summary must not be open. Read the tag itself
    // rather than a whitespace-sensitive pattern across it.
    const at = body.indexOf('Divide this bill between parties');
    const tag = body.slice(body.lastIndexOf('<details', at), at);
    expect(tag).not.toContain('open');
  });

  it('opens itself once there is one, so it is not hidden', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    const body = await (await h.request('/invoices/i1')).text();
    expect(body).toMatch(/<details open>/);
    expect(body).toContain('Split between 1 party');
  });

  it('warns while a split is short of 100%', async () => {
    const h = seeded();
    await h.post('/invoices/i1/shares', { label: 'Admin team', percent: '30%' });
    const body = await (await h.request('/invoices/i1')).text();
    expect(body.replace(/\s+/g, ' ')).toContain('has to come to 100%');
  });
});
