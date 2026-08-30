/**
 * Where an issue date came from (migration 0040).
 *
 * The issue date of a police certificate or a medical is the fact a legal
 * deadline is computed from (0029). These tests pin the three promises made
 * when the date gained a provenance:
 *
 *  1. The database refuses an issue date that does not say where it came from
 *     — attacked with raw SQL, the way a stray handler would hit it.
 *  2. A deadline derived from an unverified date says so where it is shown:
 *     the alerts row and the client page.
 *  3. Confirming the date against the certificate is a one-press upgrade, and
 *     the caveat goes with it.
 *
 * All data invented; real client data never enters this repository.
 */

import { describe, expect, it } from 'vitest';
import { mountModule } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { documentAlerts } from '../src/modules/alerts';

const at = '2026-08-29T00:00:00Z';

function client(db: any, id: string) {
  // The signed-in harness user, as a real row: a certificate records who
  // added it, and the foreign key checks.
  db.prepare(`INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'admin', ?, ?)`)
    .run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES (?, ?, 'individual', 'Invented PERSON', 'active', ?, ?)`)
    .run(id, id.toUpperCase(), at, at);
}

/** An issue date that puts a police certificate's derived expiry inside the alert horizon. */
function issuedRecently(): string {
  return new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
}

describe('the database refuses a dateless claim about a date', () => {
  it('will not take an issue date that does not say where it came from', () => {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    expect(() => h.db.prepare(
      `INSERT INTO client_certificates (id, client_id, kind, issued_on, created_at)
       VALUES ('crt_bare', 'cl_1', 'police', '2026-05-01', '${at}')`,
    ).run()).toThrow(/where it came from/);
  });

  it('nor an update that adds a date while staying silent', () => {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    h.db.prepare(`INSERT INTO client_certificates (id, client_id, kind, expires_on, created_at)
                  VALUES ('crt_x', 'cl_1', 'chest_xray', '2027-05-01', '${at}')`).run();
    expect(() => h.db.prepare(
      `UPDATE client_certificates SET issued_on = '2026-05-01' WHERE id = 'crt_x'`,
    ).run()).toThrow(/where it came from/);
  });

  it('and only knows the three honest answers', () => {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    expect(() => h.db.prepare(
      `INSERT INTO client_certificates (id, client_id, kind, issued_on, issued_on_provenance, created_at)
       VALUES ('crt_g', 'cl_1', 'police', '2026-05-01', 'guessed', '${at}')`,
    ).run()).toThrow(/CHECK|constraint/i);
  });
});

describe('a deadline computed from an unverified date says so', () => {
  async function withCertificate(provenance: string) {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    const res = await h.post('/clients/cl_1/certificates', {
      kind: 'police', country: 'NZ', issued_on: issuedRecently(),
      issued_on_provenance: provenance,
    });
    expect(res.status).toBe(303);
    return h;
  }

  it('in the alerts row, when the date came from a filename', async () => {
    const h = await withCertificate('from_filename');
    const alerts = await documentAlerts(h.env as any);
    const row = alerts.find((a) => a.title.startsWith('Police certificate'));
    expect(row).toBeDefined();
    expect(row!.detail).toContain('never confirmed against the certificate');
  });

  it('but not when it was read off the certificate itself', async () => {
    const h = await withCertificate('verified');
    const alerts = await documentAlerts(h.env as any);
    const row = alerts.find((a) => a.title.startsWith('Police certificate'));
    expect(row).toBeDefined();
    expect(row!.detail).not.toContain('never confirmed');
  });

  it('and on the client page, until somebody checks the paper', async () => {
    const h = await withCertificate('from_filename');
    let body = await (await h.request('/clients/cl_1')).text();
    expect(body).toContain('issue date unverified');
    expect(body).toContain('filename');

    // The one-press upgrade: somebody held the certificate and checked.
    const certId = h.get<{ id: string }>(`SELECT id FROM client_certificates`)!.id;
    const res = await h.post(`/clients/cl_1/certificates/${certId}/confirm-issue-date`);
    expect(res.status).toBe(303);
    expect(h.get<{ p: string }>(
      `SELECT issued_on_provenance AS p FROM client_certificates WHERE id = ?`, certId)!.p)
      .toBe('verified');

    body = await (await h.request('/clients/cl_1')).text();
    expect(body).not.toContain('issue date unverified');
  });

  it('a verified date was never flagged to begin with', async () => {
    const h = await withCertificate('verified');
    const body = await (await h.request('/clients/cl_1')).text();
    expect(body).not.toContain('issue date unverified');
  });
});

describe('a visa expiry that waits on an event shows as not yet fixed', () => {
  it('on the client page, with the rule beside it', async () => {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    h.db.prepare(`UPDATE clients SET current_visa_expiry_rule =
                  '24 months after first arrival in New Zealand' WHERE id = 'cl_1'`).run();
    const body = await (await h.request('/clients/cl_1')).text();
    expect(body).toContain('not yet fixed');
    expect(body).toContain('24 months after first arrival');
  });

  it('and stops the moment the date is', async () => {
    const h = mountModule(clientsModule);
    client(h.db, 'cl_1');
    h.db.prepare(`UPDATE clients SET current_visa_expiry_rule = '24 months after first arrival',
                  current_visa_expiry = '2028-01-01' WHERE id = 'cl_1'`).run();
    const body = await (await h.request('/clients/cl_1')).text();
    expect(body).not.toContain('not yet fixed');
  });
});
