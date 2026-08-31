/**
 * Saving a fee split.
 *
 * Reported on 31 August 2026 from a real matter: ticking "remove" beside a
 * party on the Financials tab and pressing "Save split" answered "Not found".
 *
 * Nothing was wrong with the form or the handler. The route that saves the
 * split is `/cases/:caseId/fees/shares`, and the route that saves one fee line
 * is `/cases/:caseId/fees/:feeId`. The router takes the first that matches, so
 * whichever is registered first wins — and the fee-line route was, reading
 * "shares" as a fee's id, finding no such fee and saying so.
 *
 * That is a class of fault, not a one-off: a literal path segment registered
 * after a parameter that could swallow it is invisible until somebody presses
 * the button. So this pins the behaviour rather than the ordering.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { feesModule, ensureShares } from '../src/modules/fees';

const AT = '2026-08-31T00:00:00Z';
const USER = fakeUser();

function seed(h: any) {
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.prepare(
    `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
     VALUES ('CL1', 'CL-0001', 'individual', 'A CLIENT', 'active', ?, ?)`,
  ).run(AT, AT);
  h.db.prepare(
    `INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                        created_at, updated_at)
     VALUES ('K1', 'CASE-26-001', 'CL1', 'A matter', 'wv_aewv', 'lodged', ?, ?, ?)`,
  ).run(USER.id, AT, AT);
}

const mount = () => mountModule(feesModule, { user: USER });
const shares = (h: any): any[] =>
  h.db.prepare('SELECT * FROM fee_shares WHERE case_id = ? ORDER BY party_key').all('K1');

describe('saving the split on a matter', () => {
  it('reaches the handler at all', async () => {
    const h = mount();
    seed(h);
    const res = await h.post('/cases/K1/fees/shares', {});
    expect(res.status, 'the split form found no route').not.toBe(404);
  });

  it('removes a party when the box is ticked', async () => {
    const h = mount();
    seed(h);
    await ensureShares(h.env as any, 'K1');
    const before = shares(h);
    expect(before.length).toBeGreaterThan(1);

    const target = before[before.length - 1]!;
    await h.post('/cases/K1/fees/shares', {
      [`remove_${target.id}`]: 'on',
      ...Object.fromEntries(before
        .filter((s: any) => s.id !== target.id)
        .map((s: any) => [`percent_${s.id}`, String(s.percent_bp / 100)])),
    });

    const after = shares(h);
    expect(after.map((s: any) => s.id)).not.toContain(target.id);
    expect(after.length).toBe(before.length - 1);
  });

  it('changes a percentage without touching anybody else', async () => {
    const h = mount();
    seed(h);
    await ensureShares(h.env as any, 'K1');
    const before = shares(h);
    const form: Record<string, string> = {};
    before.forEach((s: any, i: number) => {
      form[`percent_${s.id}`] = i === 0 ? '60' : String(s.percent_bp / 100);
    });
    await h.post('/cases/K1/fees/shares', form);

    const after = shares(h);
    expect(after.find((s: any) => s.id === before[0]!.id)!.percent_bp).toBe(6000);
    expect(after.length).toBe(before.length);
  });
});

describe('no literal path is swallowed by a parameter before it', () => {
  it('holds across every module, not just this one', () => {
    // The general form of the fault, and the reason this is not a one-line
    // reordering with a comment. A `:param` matches any single segment, so a
    // literal route registered after one that could swallow it is unreachable
    // — and nothing says so until somebody presses the button and is told the
    // page does not exist. Checked over the whole register, because the next
    // one will not be in the fees module.
    const files = sourceFiles('src');
    const shadowed: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const routes = [...src.matchAll(/r\.(post|get|put|delete)\('([^']+)'/g)]
        .map((m) => ({ method: m[1]!, path: m[2]!, segments: m[2]!.split('/') }));
      routes.forEach((earlier, i) => {
        if (!earlier.segments.some((s) => s.startsWith(':'))) return;
        for (const later of routes.slice(i + 1)) {
          if (later.method !== earlier.method) continue;
          if (later.segments.length !== earlier.segments.length) continue;
          const matches = earlier.segments.every((seg, k) =>
            seg.startsWith(':') || seg === later.segments[k]);
          const literalWhereParam = earlier.segments.some((seg, k) =>
            seg.startsWith(':') && !later.segments[k]!.startsWith(':'));
          if (matches && literalWhereParam) {
            shadowed.push(`${file}: ${later.method.toUpperCase()} ${later.path}`
              + ` is unreachable behind ${earlier.path}`);
          }
        }
      });
    }
    expect(shadowed).toEqual([]);
  });
});

/** Every TypeScript file under src/, which is where the routes are declared. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(`${dir}/${e.name}`)
      : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []);
}
