/**
 * The task list has more than one page.
 *
 * Until this was fixed the list ran one query with `LIMIT 200` and no offset,
 * and rendered no pager at all. Under 200 tasks nothing looked wrong; past it,
 * work simply stopped being shown, with nothing on the page to say so — the
 * worst shape a bug can take in a list somebody relies on to know what is
 * outstanding.
 *
 * So the property tested here is not "there is a Next button" but the one that
 * actually matters: **walking the pages shows every task exactly once.** A
 * paged list that loses a row between page one and page two is the same bug
 * wearing a pager.
 *
 * Driven through the real route and the real middleware over an in-memory
 * database, because the query, the ordering and the slicing have to agree and
 * only the handler puts all three together.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { tasksModule } from '../src/modules/tasks';

const AT = '2026-09-01T00:00:00Z';
const USER = fakeUser();

/**
 * Tasks that are deliberately hard to order: every one shares a priority, a
 * created_at and a null due date, so the only thing separating them is the
 * `t.id` tie-breaker in the query.
 *
 * Stated plainly, because the shape of this seed invites the wrong conclusion:
 * **these tests do not prove the tie-breaker is needed.** Removing it leaves
 * them all passing, because SQLite's plan for this query is deterministic and
 * happens to return rows in rowid order anyway. The tie-breaker is there
 * against the day that plan changes — an index added, a version moved — and no
 * test here can force that day to arrive. What these tests do prove is that
 * the offset, the limit and the slice agree: an off-by-one in any of them, or
 * a return to the old fixed ceiling, fails them.
 */
function seedTasks(db: any, n: number) {
  // Migration 0033's shape: a task has an owner, and the owner is a real user.
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  for (let i = 1; i <= n; i++) {
    const id = `T${String(i).padStart(3, '0')}`;
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, assigned_to, created_at, updated_at)
       VALUES (?, ?, 'open', 'normal', ?, ?, ?)`,
    ).run(id, `Task ${id}`, USER.id, AT, AT);
  }
}

const mount = () => mountModule(tasksModule, { user: USER });

async function bodyOf(h: ReturnType<typeof mount>, path: string): Promise<string> {
  const res = await h.request(path);
  expect(res.status).toBe(200);
  return await res.text();
}

/** Which seeded tasks a rendered page is showing. */
function titlesOn(html: string): string[] {
  return [...html.matchAll(/Task (T\d{3})</g)].map((m) => m[1]!);
}

describe('walking the task list', () => {
  it('shows every task exactly once across its pages', async () => {
    const h = mount();
    seedTasks(h.db, 60);

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      seen.push(...titlesOn(await bodyOf(h, `/tasks?scope=all&who=&page=${page}&size=25`)));
    }

    // Nothing lost.
    expect(new Set(seen).size).toBe(60);
    // Nothing shown twice — the failure a missing tie-breaker produces.
    expect(seen.length).toBe(60);
  });

  it('fills each page to the size asked for, and no further', async () => {
    const h = mount();
    seedTasks(h.db, 60);

    expect(titlesOn(await bodyOf(h, '/tasks?scope=all&who=&page=1&size=25')).length).toBe(25);
    expect(titlesOn(await bodyOf(h, '/tasks?scope=all&who=&page=1&size=50')).length).toBe(50);
    // The last page holds the remainder rather than being padded or truncated.
    expect(titlesOn(await bodyOf(h, '/tasks?scope=all&who=&page=3&size=25')).length).toBe(10);
  });

  it('offers Next while there is more, and stops offering it at the end', async () => {
    const h = mount();
    seedTasks(h.db, 60);

    expect(await bodyOf(h, '/tasks?scope=all&who=&page=1&size=25')).toContain('>Next</a>');
    const last = await bodyOf(h, '/tasks?scope=all&who=&page=3&size=25');
    expect(last).not.toContain('>Next</a>');
    expect(last).toContain('>Previous</a>');
  });

  it('goes past what the old fixed limit would have shown', async () => {
    // The regression this exists for: 200 was the hard ceiling, and task 201
    // was unreachable by any route through the interface.
    const h = mount();
    seedTasks(h.db, 210);

    const page = await bodyOf(h, '/tasks?scope=all&who=&page=5&size=50');
    expect(titlesOn(page).length).toBe(10);
    expect(page).toContain('Task T210');
  });

  it('refuses a size nobody offered rather than rendering the table', async () => {
    const h = mount();
    seedTasks(h.db, 60);
    // Falls back to the default rather than honouring an arbitrary number.
    expect(titlesOn(await bodyOf(h, '/tasks?scope=all&who=&size=1000000')).length).toBe(25);
  });

  it('keeps the size and the view when the other is changed', async () => {
    const h = mount();
    seedTasks(h.db, 60);
    const body = await bodyOf(h, '/tasks?scope=all&who=&size=100');

    // The tab links carry the size, so switching view does not silently reset
    // the page length somebody just chose.
    expect(body).toMatch(/href="\/tasks\?scope=open[^"]*size=100/);
    // And the size links carry the view.
    expect(body).toMatch(/href="\/tasks\?scope=all[^"]*size=250/);
  });
});

describe('drawing the "attached to" column', () => {
  /**
   * The column cost one database query per row until 0.73.1. At the page sizes
   * the register now offers that is 500 subrequests to draw one column, against
   * a Cloudflare ceiling of 1,000 per request — it worked until it very
   * suddenly would not.
   *
   * So the test counts queries rather than looking at the output: the number
   * must not grow with the number of rows. That is the property; the rendered
   * links are incidental and already covered above.
   */
  const attached = (h: any, n: number) => {
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('CL1','CL-0001','individual','A CLIENT','active',?,?)`).run(AT, AT);
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                     created_at, updated_at)
                  VALUES ('K1','CASE-26-001','CL1','A matter','wv_aewv','lead',?,?,?)`)
      .run(USER.id, AT, AT);
    for (let i = 1; i <= n; i++) {
      h.db.prepare(
        `INSERT INTO tasks (id, title, status, priority, assigned_to, entity_type, entity_id,
                            created_at, updated_at)
         VALUES (?, ?, 'open', 'normal', ?, 'case', 'K1', ?, ?)`,
      ).run(`T${String(i).padStart(3, '0')}`, `Task T${String(i).padStart(3, '0')}`, USER.id, AT, AT);
    }
  };

  /** Count the statements the page runs, by watching `prepare`. */
  async function queriesFor(taskCount: number, size: number): Promise<number> {
    const h = mount();
    h.db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'x', ?, ?, ?)`,
    ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    attached(h, taskCount);

    let n = 0;
    const real = h.db.prepare.bind(h.db);
    (h.db as any).prepare = (sql: string) => { n++; return real(sql); };
    await h.request(`/tasks?scope=all&who=&size=${size}`);
    (h.db as any).prepare = real;
    return n;
  }

  it('does not run more queries because there are more rows', async () => {
    const few = await queriesFor(3, 100);
    const many = await queriesFor(60, 100);
    // Both pages draw the same column from the same four-queries-per-kind
    // lookup, so the count is flat. A per-row SELECT would show ~57 more.
    expect(many - few).toBeLessThanOrEqual(2);
  });

  it('stays well inside the subrequest ceiling at the largest page', async () => {
    // Cloudflare allows 1,000 subrequests per request. A per-row query at
    // size=500 would sit on that line; this must not be near it.
    expect(await queriesFor(120, 500)).toBeLessThan(30);
  });
});
