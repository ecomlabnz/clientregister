/**
 * An invoice you can raise on its own.
 *
 * Until now the only way to bill anything was to write a quote and convert it.
 * That is a fair description of how the work usually goes and a poor
 * description of the times it does not — an hour of advice given and charged
 * for needs a bill, not an offer followed by a bill. The practice: *"both being
 * able to be entered independently"*.
 *
 * The tests that matter here are the refusals. An invoice is a demand with a
 * number in a sequence, and the two ways to get one wrong are to address it to
 * nobody and to file it against somebody else's matter — the second being the
 * kind of mistake nobody spots until they go looking for the money.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { invoicesModule } from '../src/modules/invoices';
import { newInvoice } from '../src/core/invoices';

const AT = '2026-09-04T00:00:00Z';
const USER = fakeUser({ id: 'u_inv', email: 'inv@example.test' });

function seeded() {
  const h = mountModule(invoicesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  for (const [id, ref, name] of [['c1', 'CL-9001', 'A Person'], ['c2', 'CL-9002', 'Another Person']]) {
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES (?, ?, 'individual', ?, 'active', ?, ?)`).run(id, ref, name, AT, AT);
  }
  h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   created_at, updated_at)
                VALUES ('k1','CASE-26-001','c1','A matter','wv_aewv','lodged',?,?,?)`)
    .run(USER.id, AT, AT);
  h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   created_at, updated_at)
                VALUES ('k2','CASE-26-002','c2','Another matter','wv_aewv','lodged',?,?,?)`)
    .run(USER.id, AT, AT);
  return h;
}

const raise = (h: ReturnType<typeof seeded>, form: Record<string, string>) =>
  h.post('/invoices', { payment_terms_days: '7', ...form });

const invoice = (h: ReturnType<typeof seeded>) =>
  h.get<{ id: string; ref: string; client_id: string; case_id: string | null; status: string;
          quote_id: string | null; description: string; payment_terms_days: number }>(
    'SELECT * FROM invoices LIMIT 1');

describe('raising an invoice without a quote', () => {
  it('creates a draft addressed to the client', async () => {
    const h = seeded();
    const res = await raise(h, { client_id: 'c1', description: 'Advice on a section 61 request' });
    expect(res.status).toBe(303);
    const inv = invoice(h);
    expect(inv?.client_id).toBe('c1');
    expect(inv?.status).toBe('draft');
    expect(inv?.description).toBe('Advice on a section 61 request');
    // It came from nowhere, and says so rather than pointing at a quote.
    expect(inv?.quote_id).toBeNull();
    expect(inv?.ref).toMatch(/^INV/);
  });

  it('starts empty, so the lines are still to be added', async () => {
    const h = seeded();
    await raise(h, { client_id: 'c1', description: 'Advice' });
    expect(h.count('SELECT COUNT(*) AS n FROM invoice_items')).toBe(0);
  });

  it('can be filed against one of that client\'s matters', async () => {
    const h = seeded();
    await raise(h, { client_id: 'c1', case_id: 'k1', description: 'Advice' });
    expect(invoice(h)?.case_id).toBe('k1');
  });

  it('need not be against a matter at all', async () => {
    const h = seeded();
    await raise(h, { client_id: 'c1', case_id: '', description: 'Advice' });
    expect(invoice(h)?.case_id).toBeNull();
  });

  it('takes the payment terms it was given', async () => {
    const h = seeded();
    await raise(h, { client_id: 'c1', description: 'Advice', payment_terms_days: '20' });
    expect(invoice(h)?.payment_terms_days).toBe(20);
  });
});

describe('what it refuses', () => {
  it('refuses an invoice addressed to nobody', async () => {
    // A quote may sit against an inquiry that is not a client yet. An invoice
    // may not: it is a demand, and a demand is made of somebody.
    const h = seeded();
    await raise(h, { client_id: '', description: 'Advice' });
    expect(h.count('SELECT COUNT(*) AS n FROM invoices')).toBe(0);
  });

  it('refuses a client who does not exist, in words', async () => {
    // Asserting only "no invoice" would pass on a foreign key blowing up,
    // which is a 500 rather than a refusal. The message is what proves the
    // guard ran.
    const h = seeded();
    const res = await raise(h, { client_id: 'nobody', description: 'Advice' });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? ''))
      .toContain('addressed to someone');
    expect(h.count('SELECT COUNT(*) AS n FROM invoices')).toBe(0);
  });

  it('refuses a matter belonging to a different client', async () => {
    // The mistake nobody spots until they go looking for the money.
    const h = seeded();
    const res = await raise(h, { client_id: 'c1', case_id: 'k2', description: 'Advice' });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? ''))
      .toContain('different client');
    expect(h.count('SELECT COUNT(*) AS n FROM invoices')).toBe(0);
  });

  it('refuses a description of nothing but spaces, at the function', async () => {
    // The route's own form check refuses this first, so going through the route
    // cannot tell whether this guard exists — a mutation removing it survived
    // until this test was written. The function is called from more than one
    // place, so the guard is tested where it lives.
    const h = seeded();
    const made = await newInvoice(h.env as never, { clientId: 'c1', description: '   ' }, USER.id);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.message).toContain('what this invoice is for');
    expect(h.count('SELECT COUNT(*) AS n FROM invoices')).toBe(0);
  });

  it('refuses an invoice that does not say what it is for', async () => {
    const h = seeded();
    const res = await raise(h, { client_id: 'c1', description: '   ' });
    expect(res.status).toBe(303);
    const where = decodeURIComponent(res.headers.get('location') ?? '');
    expect(where).toContain('/invoices/new');
    expect(where.toLowerCase()).toMatch(/required|what this invoice is for/);
    expect(h.count('SELECT COUNT(*) AS n FROM invoices')).toBe(0);
  });

  it('needs permission to bill', async () => {
    const h = mountModule(invoicesModule, { user: fakeUser({ ...USER, role: 'readonly' } as never) });
    const res = await h.post('/invoices', { client_id: 'c1', description: 'Advice' });
    expect(res.status).toBe(403);
  });
});

describe('the way in', () => {
  it('offers a New invoice button on the list', async () => {
    const h = seeded();
    const body = await (await h.request('/invoices')).text();
    expect(body).toContain('href="/invoices/new"');
    expect(body).toContain('New invoice');
  });

  it('hides it from somebody who cannot bill', async () => {
    const h = mountModule(invoicesModule, { user: fakeUser({ ...USER, role: 'readonly' } as never) });
    const body = await (await h.request('/invoices')).text();
    expect(body).not.toContain('href="/invoices/new"');
  });

  it('offers only that client\'s matters once a client is chosen', async () => {
    const h = seeded();
    const body = await (await h.request('/invoices/new?client_id=c1')).text();
    expect(body).toContain('CASE-26-001');
    expect(body).not.toContain('CASE-26-002');
  });
});
