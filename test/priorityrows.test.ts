/**
 * What a priority looks like on the list, and why it comes from one place.
 *
 * **Asked for on 12 September 2026:** *"high status should have yellowish
 * background as a general rule, urgent ones - reddish as they do."*
 *
 * The badge on a matter already said amber for high and red for urgent. The row
 * behind it tinted for urgent only — so a high-priority matter was called out
 * in one place and not the other, by two pieces of code that had each decided
 * the same thing separately and disagreed.
 *
 * These tests pin the rule rather than the colour: that the row and the badge
 * agree, and that a tint exists for high at all. The hex values live in
 * `app.css` as theme tokens and are checked there, not here — a test that
 * asserted `#fdf1dc` would break the first time somebody warmed the palette.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';
import { rowClass } from '../src/ui/components';
import { PRIORITY_TONES, PRIORITIES, type Priority } from '../src/domain';
import { SEVERITY_TONES, severityFor } from '../src/modules/alerts';

const AT = '2026-09-12T00:00:00Z';
const USER = fakeUser();
const css = readFileSync('public/app.css', 'utf8');

function seeded() {
  const h = mountModule(casesModule, { user: USER });
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
             VALUES ('CL1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  const matter = (id: string, ref: string, priority: string) =>
    h.db.prepare(
      `INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status,
                          priority, assigned_to, created_at, updated_at)
       VALUES (?, ?, 'CL1', ?, ?, 'wv_aewv', 'lodged', ?, ?, ?, ?)`,
    ).run(id, ref, `Matter ${ref}`, `Matter ${ref}`, priority, USER.id, AT, AT);
  matter('K1', 'CASE-26-001', 'urgent');
  matter('K2', 'CASE-26-002', 'high');
  matter('K3', 'CASE-26-003', 'normal');
  return h;
}

/** The class on the `<tr>` that carries a given matter reference. */
function rowClassFor(body: string, ref: string): string | null {
  for (const m of body.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)) {
    if (m[2]!.includes(ref)) return m[1]!;
  }
  return null;
}

describe('a matter is tinted for its priority', () => {
  it('gives a high-priority matter its own tint, not the urgent one and not none', async () => {
    const body = await (await seeded().request('/cases?scope=all')).text();
    expect(rowClassFor(body, 'CASE-26-002')).toBe('row-high');
  });

  it('leaves urgent as it was', async () => {
    const body = await (await seeded().request('/cases?scope=all')).text();
    expect(rowClassFor(body, 'CASE-26-001')).toBe('row-urgent');
  });

  it('tints nothing for an ordinary matter', async () => {
    const body = await (await seeded().request('/cases?scope=all')).text();
    expect(rowClassFor(body, 'CASE-26-003')).toBe('');
  });
});

describe('the row and its badge agree', () => {
  /**
   * The bug this whole change came from: the badge said one thing about a high
   * matter and the row said another. They now read the same map, so this asks
   * whether both marks appear together.
   */
  it('a high matter carries the amber badge and the amber row', async () => {
    const body = await (await seeded().request('/cases?scope=all')).text();
    const row = [...body.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)]
      .find((m) => m[2]!.includes('CASE-26-002'));
    expect(row?.[1]).toBe('row-high');
    expect(row?.[2]).toContain('badge-amber');
  });

  it('an urgent matter carries the red badge and the red row', async () => {
    const body = await (await seeded().request('/cases?scope=all')).text();
    const row = [...body.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)]
      .find((m) => m[2]!.includes('CASE-26-001'));
    expect(row?.[1]).toBe('row-urgent');
    expect(row?.[2]).toContain('badge-red');
  });
});

describe('the tint follows the reader’s theme', () => {
  /**
   * A colour whose only definition sits inside a dark-mode block renders one
   * theme's text on the other theme's ground. `.row-high` must therefore use a
   * token, and that token must be defined in every theme state — the bare
   * `:root`, the `prefers-color-scheme` block, and the explicit `data-theme`.
   */
  it('uses a token rather than a literal colour', () => {
    const rule = css.match(/\.row-high \{([^}]*)\}/);
    expect(rule, '.row-high is not defined').toBeTruthy();
    expect(rule![1]).toContain('var(--amber-bg)');
    expect(rule![1]).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('has that token defined for light and for dark', () => {
    expect(css).toMatch(/--l-amber-bg:\s*#[0-9a-f]{3,8}/i);
    expect(css).toMatch(/--d-amber-bg:\s*#[0-9a-f]{3,8}/i);
    // Mapped in all three states: bare :root, the media query, and the stamp.
    expect([...css.matchAll(/--amber-bg:\s*var\(--[ld]-amber-bg\)/g)].length)
      .toBeGreaterThanOrEqual(3);
  });
});

describe('every list paints the same tone the same way', () => {
  /**
   * **Asked for on 12 September 2026:** *"i like the tints for cases, but also
   * want them on the dashboard and for alerts too."*
   *
   * Three lists were each deciding for themselves what a row should look like,
   * and all three had arrived at the red half only — while the badge sitting on
   * the very same row already knew about amber. So the mapping has one owner
   * now, and these check it rather than the pixels: the lists still decide how
   * pressing a thing is, and `rowClass` decides what that looks like.
   */
  it('turns a tone into the same class wherever it is asked', () => {
    expect(rowClass('red')).toBe('row-urgent');
    expect(rowClass('amber')).toBe('row-high');
    expect(rowClass('neutral')).toBe('');
    expect(rowClass(null)).toBe('');
    expect(rowClass(undefined)).toBe('');
  });

  it('has a tone for every priority the register has', () => {
    // A priority with no entry would read as neutral and be silently quiet,
    // which is how the amber tier went missing in the first place.
    for (const p of PRIORITIES) {
      expect(PRIORITY_TONES[p as Priority], p).toBeTruthy();
    }
    expect(PRIORITY_TONES.urgent).toBe('red');
    expect(PRIORITY_TONES.high).toBe('amber');
  });

  it('gives an alert the tone its own badge already showed', () => {
    expect(SEVERITY_TONES.overdue).toBe('red');
    expect(SEVERITY_TONES.urgent).toBe('amber');
    expect(SEVERITY_TONES.soon).toBe('neutral');
  });

  it('reddens a date that has passed and ambers one that is close', () => {
    const today = '2026-09-12';
    expect(rowClass(SEVERITY_TONES[severityFor('2026-09-11', today)])).toBe('row-urgent');
    expect(rowClass(SEVERITY_TONES[severityFor(today, today)])).toBe('row-high');
    expect(rowClass(SEVERITY_TONES[severityFor('2026-09-25', today)])).toBe('row-high');
    // Beyond the fortnight the register treats as pressing, a row is quiet.
    expect(rowClass(SEVERITY_TONES[severityFor('2026-11-01', today)])).toBe('');
  });
});
