/**
 * Billing a matter from the price list.
 *
 * The practice bills roughly the same dozen things, and re-typing a lodgement
 * fee, its amount and the fact that it carries no GST is how a fee ledger ends
 * up disagreeing with itself: two spellings of one charge that can never be
 * counted as one.
 *
 * The list already existed — it is what quotes and invoices bill from. What is
 * pinned here is that a matter's fee line uses *that* list rather than a second
 * one, and that choosing from it works with scripting switched off, because the
 * handler applies the same row the script on the page would have.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { feesModule } from '../src/modules/fees';
import { casesModule } from '../src/modules/cases';

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
const fees = (h: any) => h.db.prepare('SELECT * FROM fee_items').all() as any[];

describe('choosing from the price list', () => {
  it('bills the matter without a word being typed', async () => {
    // Scripting off: nothing was filled in on the screen, so the handler has to
    // apply the row itself. This is the case that would silently do nothing.
    const h = mountModule(feesModule, { user: USER });
    seed(h);
    await h.post('/cases/k1/fees', { service_item: 'svc1', status: 'quoted' });
    const [fee] = fees(h);
    expect(fee.description).toBe('INZ lodgement fee');
    expect(fee.amount_cents).toBe(75000);
    expect(fee.gst_treatment).toBe('none');
    expect(fee.kind).toBe('disbursement');
  });

  it('lets what was typed win over what the list says', async () => {
    // The amount on a particular matter is often not the amount on the list,
    // and a form that will not let you change it is a form you work around.
    const h = mountModule(feesModule, { user: USER });
    seed(h);
    await h.post('/cases/k1/fees', {
      service_item: 'svc1', description: 'INZ lodgement fee — reduced', amount: '500.00',
      kind: 'disbursement', gst_treatment: 'none', status: 'quoted',
    });
    const [fee] = fees(h);
    expect(fee.description).toBe('INZ lodgement fee — reduced');
    expect(fee.amount_cents).toBe(50000);
  });

  it('treats a price of nothing as no price, not as a free fee', async () => {
    // Most of this practice's list is at zero because no price is set yet.
    // Taking that as "the fee is nothing" would put a $0.00 line on a matter
    // and call it done.
    const h = mountModule(feesModule, { user: USER });
    seed(h, 0);
    const res = await h.post('/cases/k1/fees', { service_item: 'svc1', status: 'quoted' });
    expect(res.headers.get('location')).toContain('err=');
    expect(fees(h)).toEqual([]);
  });

  it('still refuses a line with no description at all', async () => {
    const h = mountModule(feesModule, { user: USER });
    seed(h);
    const res = await h.post('/cases/k1/fees', { amount: '100.00', status: 'quoted' });
    expect(res.headers.get('location')).toContain('err=');
    expect(fees(h)).toEqual([]);
  });

  it('offers the list on the form, with what each one costs', async () => {
    // Rendered by the matter's page, which is where the fees section lives.
    const h = mountModule(casesModule, { user: USER });
    seed(h);
    const body = await (await h.request('/cases/k1')).text();
    expect(body).toContain('name="service_item"');
    expect(body).toContain('INZ lodgement fee');
    // The same script that fills a quote line fills this one, and the form says
    // which box holds the amount because the two forms name it differently.
    expect(body).toContain('js-quote-line');
    expect(body).toContain('data-amount-field="amount"');
  });
});
