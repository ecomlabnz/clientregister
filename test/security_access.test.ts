/**
 * Route-level security: what a handler does once a request reaches it.
 *
 * The database guarantees (triggers, foreign keys) are attacked directly in
 * security_invariants.test.ts. This suite is the layer above: the handler must
 * declare the right permission, and it must not leave the audit log — which is
 * append-only and is the record of what happened — asserting things that did
 * not happen. Exercised through the real Hono route and the real middleware
 * over an in-memory database, so it tests the code a request actually runs.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { inquiriesModule } from '../src/modules/inquiries';

const at = '2026-08-29T00:00:00Z';

function inquiry(db: any, id: string, extra: Record<string, string> = {}) {
  const cols = ['id', 'ref', 'source', 'received_at', 'created_at', 'updated_at', ...Object.keys(extra)];
  const vals = [id, id, 'email', at, at, at, ...Object.values(extra)];
  db.prepare(`INSERT INTO inquiries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
}

describe('inquiry delete — permission', () => {
  it('refuses a role without register:delete (403)', async () => {
    const h = mountModule(inquiriesModule, { user: fakeUser({ role: 'readonly' }) });
    inquiry(h.db, 'INQ');
    const res = await h.post('/inquiries/INQ/delete');
    expect(res.status).toBe(403);
    // And the row is untouched.
    expect(h.count(`SELECT COUNT(*) AS n FROM inquiries`)).toBe(1);
  });
});

describe('inquiry delete — the audit log records only what happened', () => {
  it('does not write inquiry.deleted when the database refuses the delete', async () => {
    const h = mountModule(inquiriesModule);
    // An inquiry carrying a quote, with no case: the delete button is shown for
    // it (it has no case_id) but migration 0036 refuses the delete.
    inquiry(h.db, 'INQ');
    h.db.prepare(
      `INSERT INTO quotes (id, ref, inquiry_id, description, amount_cents, gst_cents, status, created_at, updated_at)
       VALUES ('q1','Q-1','INQ','fee',1000,0,'draft',?,?)`,
    ).run(at, at);

    const res = await h.post('/inquiries/INQ/delete');

    // The handler redirects back to the inquiry with the database's own reason.
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/inquiries/INQ');
    expect(res.headers.get('location')).toContain('err=');
    // The inquiry is still there …
    expect(h.count(`SELECT COUNT(*) AS n FROM inquiries`)).toBe(1);
    // … and nothing claims it was deleted.
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action='inquiry.deleted' AND entity_id=?`, 'INQ')).toBe(0);
  });

  it('writes inquiry.deleted exactly once when the delete succeeds', async () => {
    const h = mountModule(inquiriesModule);
    inquiry(h.db, 'INQ');
    // A captured message points at it, to confirm the same path still marks it.
    h.db.prepare(
      `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, inquiry_id, created_at)
       VALUES ('m1','email','dk1',?, 'processed','INQ',?)`,
    ).run(at, at);

    const res = await h.post('/inquiries/INQ/delete');

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/inquiries?');
    expect(h.count(`SELECT COUNT(*) AS n FROM inquiries`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action='inquiry.deleted' AND entity_id=?`, 'INQ')).toBe(1);
    // The message it was made from goes back to being ignorable, not deleted.
    expect(h.get(`SELECT status, inquiry_id FROM ingest_messages WHERE id='m1'`))
      .toEqual({ status: 'ignored', inquiry_id: null });
  });
});
