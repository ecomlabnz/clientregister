/**
 * Billing from the price list.
 *
 * The practice bills the same things over and over — 74 entries now, one per
 * kind of application it takes on — and re-typing a lodgement fee, its amount
 * and the fact that it carries no GST is how a ledger ends up disagreeing with
 * itself: two spellings of one charge that can never be counted as one.
 *
 * This guarantee was written for the Fees panel and came across with the money
 * when Fees was removed. What it pins is that **choosing from the list works
 * with scripting switched off**, because the handler applies the same row the
 * script on the page would have. A price list only reachable by script is a
 * price list this register could not offer, since it runs with no script at
 * all.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { invoicesModule } from '../src/modules/invoices';

const AT = '2026-09-01T00:00:00Z';
const USER = fakeUser();

function seed(h: any, price = 75000, treatment = 'none', kind = 'disbursement') {
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                VALUES ('cl1','CL-1','individual','A PERSON','active',?,?)`).run(AT, AT);
  h.db.prepare(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,
                                   currency,created_at,updated_at)
                VALUES ('k1','CASE-1','cl1','A matter','A matter','wv_aewv','lodged',?, 'NZD',?,?)`)
    .run(USER.id, AT, AT);
  h.db.prepare(`INSERT INTO service_items (id, name, description, kind, unit_label,
                                           unit_amount_cents, gst_treatment, active, sort_order,
                                           created_at, updated_at)
                VALUES ('svc1','INZ lodgement fee','', ?, 'item', ?, ?, 1, 1, ?, ?)`)
    .run(kind, price, treatment, AT, AT);
}
/** A draft invoice on that matter, ready to take lines. */
function draft(h: any) {
  h.db.prepare(`INSERT INTO invoices (id, ref, client_id, case_id, description, payment_terms_days,
                                      status, currency, created_at, updated_at, created_by)
                VALUES ('i1','INV-1','cl1','k1','A bill',7,'draft','NZD',?,?,?)`)
    .run(AT, AT, USER.id);
  return 'i1';
}
const lines = (h: any) => h.db.prepare('SELECT * FROM invoice_items').all() as any[];

describe('choosing from the price list', () => {
  it('bills the matter without a word being typed', async () => {
    // Scripting off: nothing was filled in on the screen, so the handler has to
    // apply the row itself. This is the case that would silently do nothing.
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    await h.post('/invoices/i1/items', { service_item: 'svc1' });
    const [fee] = lines(h);
    expect(fee.description).toBe('INZ lodgement fee');
    expect(fee.unit_amount_cents).toBe(75000);
    expect(fee.gst_treatment).toBe('none');
    expect(fee.kind).toBe('disbursement');
  });

  it('lets what was typed win over what the list says', async () => {
    // The amount on a particular matter is often not the amount on the list,
    // and a form that will not let you change it is a form you work around.
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    await h.post('/invoices/i1/items', {
      service_item: 'svc1', description: 'INZ lodgement fee — reduced', unit_amount: '500.00',
      kind: 'disbursement', gst_treatment: 'none',
    });
    const [fee] = lines(h);
    expect(fee.description).toBe('INZ lodgement fee — reduced');
    expect(fee.unit_amount_cents).toBe(50000);
  });

  it('treats a price of nothing as no price, not as a free fee', async () => {
    // Most of this practice's list is at zero because no price is set yet.
    // Taking that as "the fee is nothing" would put a $0.00 line on a matter
    // and call it done.
    const h = mountModule(invoicesModule, { user: USER });
    seed(h, 0); draft(h);
    const res = await h.post('/invoices/i1/items', { service_item: 'svc1' });
    expect(res.headers.get('location')).toContain('err=');
    expect(lines(h)).toEqual([]);
  });

  it('still refuses a line with no description at all', async () => {
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    const res = await h.post('/invoices/i1/items', { unit_amount: '100.00' });
    expect(res.headers.get('location')).toContain('err=');
    expect(lines(h)).toEqual([]);
  });

  it('offers the list on the invoice, with what each one costs', async () => {
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    const body = await (await h.request('/invoices/i1')).text();
    expect(body).toContain('service_item');
    expect(body).toContain('INZ lodgement fee');
  });

  it('takes the unit the list carries when none is typed', async () => {
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    await h.post('/invoices/i1/items', { service_item: 'svc1' });
    expect(lines(h)[0].unit_label).toBe('item');
  });

  it('refuses to add a line to an invoice already issued', async () => {
    // The freeze is the whole point of an invoice; the price list is no way
    // around it.
    const h = mountModule(invoicesModule, { user: USER });
    seed(h); draft(h);
    h.db.prepare(`UPDATE invoices SET status = 'issued', issued_on = ? WHERE id = 'i1'`).run(AT);
    const res = await h.post('/invoices/i1/items', { service_item: 'svc1' });
    expect(res.headers.get('location')).toContain('err=');
    expect(lines(h)).toEqual([]);
  });
});
