/**
 * Every section on a matter folds, and only one starts folded.
 *
 * A matter page is long — status, parties, tasks, files, notes, tags, key
 * details, the lot — and which parts matter depends on what you opened it for.
 * So each heading is a handle. They open on load, because a section you cannot
 * see is a section you forget to read; the exception is Fees, which stays shut
 * for the reason it always has: it is the one thing on the page a client
 * leaning over the desk should not read by accident.
 *
 * Built on `<details>`, like every other disclosure here — the content policy
 * forbids an inline script, and a fold that stops working when script is
 * blocked is a section nobody can reach.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';

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
    `INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status,
                        assigned_to, created_at, updated_at)
     VALUES ('K1', 'CASE-26-001', 'CL1', 'A matter', 'A matter', 'wv_aewv', 'lodged', ?, ?, ?)`,
  ).run(USER.id, AT, AT);
}

/** Each `<section class="card">` on the page, as {title, folds, open}. */
function sections(body: string) {
  return [...body.matchAll(/<section class="card">([\s\S]*?)<\/section>/g)].map((m) => {
    const inner = m[1]!;
    const open = /<details class="card-fold"\s+open>/.test(inner);
    const folds = /<details class="card-fold"/.test(inner);
    const title = /<h2>([\s\S]*?)<\/h2>/.exec(inner)?.[1]?.trim() ?? null;
    return { title, folds, open };
  }).filter((s) => s.title !== null);
}

const mount = () => mountModule(casesModule, { user: USER });
const page = async (h: any) => (await h.request('/cases/K1')).text();

describe('the sections on a matter', () => {
  it('all fold', async () => {
    const h = mount();
    seed(h);
    const found = sections(await page(h));
    expect(found.length).toBeGreaterThanOrEqual(8);
    const rigid = found.filter((s) => !s.folds).map((s) => s.title);
    expect(rigid, 'these headings are not handles').toEqual([]);
  });

  it('open on load, except Fees', async () => {
    const h = mount();
    seed(h);
    const shut = sections(await page(h)).filter((s) => !s.open).map((s) => s.title);
    expect(shut).toEqual(['Fees']);
  });

  it('names the money section Fees', async () => {
    // It said "Fees and split", which named the section after two of the
    // things inside it rather than after the one thing it is.
    const body = await page(mountSeeded());
    expect(body).toContain('<h2>Fees</h2>');
    expect(body).not.toContain('Fees and split');
  });

  it('needs no script to open or close', async () => {
    // The content policy forbids an inline script; a fold that depends on one
    // is a section nobody can reach when scripting is off.
    const body = await page(mountSeeded());
    // The first *folding* card, not the first card: a matter page also carries
    // cards that are not sections of the file, such as the one inside the
    // "Raise a warning" reveal.
    const card = /<section class="card">\s*<details class="card-fold"[\s\S]*?<\/section>/.exec(body)?.[0] ?? '';
    expect(card).toContain('<details class="card-fold"');
    expect(card).not.toMatch(/onclick|<script/);
  });
});

function mountSeeded() {
  const h = mount();
  seed(h);
  return h;
}
