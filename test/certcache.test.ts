/**
 * The database keeps the cached certificate columns.
 *
 * **Found on 11 September 2026** chasing a complaint that turned out to be the
 * opposite of the fault. The practice, looking at a superseded police
 * certificate rendered in alarm red beside a current one: *"this is what i do
 * not need - an old certificate bugging me! ... no doubt it created an alert"*.
 *
 * It had not. That client's cache was right. But the check run to prove it
 * found **45 clients whose `police_certificate_expiry` was NULL while they held
 * a police certificate** — one of them expired fifteen months earlier and had
 * never appeared on the alerts page. Certificates loaded in bulk never went
 * through the route that maintained the cache, and a NULL in a cache is
 * indistinguishable from a client who holds nothing.
 *
 * So the tests attack the database directly. The whole point of moving the rule
 * there is that it holds when the route is not involved — which is exactly the
 * case that broke.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-11T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c2','CL-9002','individual','B Person','active',?,?)`).run(AT, AT);
  let n = 0;
  const add = (o: { client?: string; kind: string; country?: string | null;
                    issued?: string | null; expires?: string | null; subtype?: string | null }) => {
    const id = `crt${++n}`;
    db.prepare(`INSERT INTO client_certificates
                  (id, client_id, kind, subtype, country, issued_on, issued_on_provenance,
                   expires_on, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, o.client ?? 'c1', o.kind, o.subtype ?? null, o.country ?? null,
           o.issued ?? null, o.issued ? 'verified' : null, o.expires ?? null, AT);
    return id;
  };
  const cached = (id = 'c1') => (db.prepare(
    `SELECT police_certificate_country AS country, police_certificate_date AS date,
            police_certificate_expiry AS expiry, medical_certificate_expiry AS medical,
            medical_certificate_type AS medical_type, chest_xray_expiry AS xray
       FROM clients WHERE id = ?`) as any).get(id) as Record<string, string | null>;
  return { db, add, cached };
}

describe('a certificate written by any route reaches the cache', () => {
  it('fills the cache on a bare insert, with no application involved', () => {
    // The case that broke: a bulk load writes the row and nothing else.
    const { add, cached } = register();
    add({ kind: 'police', country: 'VN', issued: '2024-12-23', expires: '2025-06-23' });
    expect(cached().expiry).toBe('2025-06-23');
    expect(cached().country).toBe('VN');
    expect(cached().date).toBe('2024-12-23');
  });

  it('prefers the newer certificate for the same country', () => {
    // The complaint that started this: a superseded certificate must not be
    // what the register watches when a current one exists.
    const { add, cached } = register();
    add({ kind: 'police', country: 'VN', issued: '2023-05-26' });   // expires 2023-11-26
    add({ kind: 'police', country: 'VN', issued: '2026-01-19' });   // expires 2026-07-19
    expect(cached().expiry).toBe('2026-07-19');
  });

  it('watches the soonest of several countries, since that is what bites first', () => {
    const { add, cached } = register();
    add({ kind: 'police', country: 'VN', issued: '2026-01-19' });   // expires 2026-07-19
    add({ kind: 'police', country: 'AU', issued: '2025-10-01' });   // expires 2026-04-01
    expect(cached().expiry).toBe('2026-04-01');
    expect(cached().country).toBe('AU');
  });

  it('keeps the medical and the x-ray apart from each other', () => {
    // An x-ray carries its own expiry; a medical's is derived from the issue
    // date, three months on.
    const { add, cached } = register();
    add({ kind: 'medical', subtype: 'limited', issued: '2026-02-01' });
    add({ kind: 'chest_xray', expires: '2029-02-01' });
    expect(cached().medical).toBe('2026-05-01');
    expect(cached().medical_type).toBe('limited');
    expect(cached().xray).toBe('2029-02-01');
  });

  it('empties the cache when the last certificate is deleted', () => {
    const { db, add, cached } = register();
    const id = add({ kind: 'police', country: 'VN', issued: '2026-01-19' });
    db.prepare('DELETE FROM client_certificates WHERE id = ?').run(id);
    expect(cached().expiry).toBeNull();
    expect(cached().country).toBeNull();
  });

  it('falls back to the earlier one when the current is deleted', () => {
    const { db, add, cached } = register();
    add({ kind: 'police', country: 'VN', issued: '2023-05-26' });   // expires 2023-11-26
    const newer = add({ kind: 'police', country: 'VN', issued: '2026-01-19' });
    db.prepare('DELETE FROM client_certificates WHERE id = ?').run(newer);
    expect(cached().expiry).toBe('2023-11-26');
  });

  it('corrects both clients when a certificate is moved between them', () => {
    const { db, add, cached } = register();
    const id = add({ kind: 'police', country: 'VN', issued: '2026-01-19' });
    db.prepare('UPDATE client_certificates SET client_id = ? WHERE id = ?').run('c2', id);
    expect(cached('c1').expiry).toBeNull();
    expect(cached('c2').expiry).toBe('2026-07-19');
  });

  it('follows a corrected issue date', () => {
    const { db, add, cached } = register();
    const id = add({ kind: 'police', country: 'VN', issued: '2026-01-19' });
    db.prepare('UPDATE client_certificates SET issued_on = ? WHERE id = ?').run('2026-03-01', id);
    expect(cached().expiry).toBe('2026-09-01');
    expect(cached().date).toBe('2026-03-01');
  });

  it('uses a certificate with no dates at all only when nothing else is held', () => {
    // A certificate somebody recorded as held, with nothing read off it yet.
    const { add, cached } = register();
    add({ kind: 'police', country: 'VN' });
    expect(cached().country).toBe('VN');
    expect(cached().expiry).toBeNull();
    add({ kind: 'police', country: 'AU', issued: '2026-01-19' });
    expect(cached().expiry).toBe('2026-07-19');
    expect(cached().country).toBe('AU');
  });
});

describe('the repair this migration performs', () => {
  it('corrects a cache that was already wrong', () => {
    // Exactly the 45: rows present, cache never written.
    const db = new DatabaseSync(':memory:');
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    const upTo = files.filter((f) => !f.startsWith('0082'));
    for (const f of upTo) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
    db.prepare(`INSERT INTO client_certificates (id, client_id, kind, country, issued_on,
                    issued_on_provenance, expires_on, created_at)
                VALUES ('crt1','c1','police','VN','2024-12-23','verified','2025-06-23',?)`).run(AT);
    const before = (db.prepare('SELECT police_certificate_expiry AS e FROM clients WHERE id = ?') as any)
      .get('c1') as { e: string | null };
    expect(before.e, 'the fault this migration repairs').toBeNull();

    db.exec(readFileSync(`migrations/${files.find((f) => f.startsWith('0082'))!}`, 'utf8'));
    const after = (db.prepare('SELECT police_certificate_expiry AS e FROM clients WHERE id = ?') as any)
      .get('c1') as { e: string | null };
    expect(after.e).toBe('2025-06-23');
  });
});
