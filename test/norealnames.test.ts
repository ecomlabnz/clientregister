/**
 * No real client's name in the repository.
 *
 * The standing rule, from `CLAUDE.md`: *"Real client data never enters the
 * repository — not in tests, fixtures, seeds or commit messages. It belongs in
 * the production database only."*
 *
 * It was broken on 7–8 September 2026 and found by an audit, not by anything
 * here. Six live clients and three live companies had been used as examples —
 * in test fixtures, in migration comments, in the Help page, in the changelog
 * and in commit messages. Each looked like a plausible invented name, and each
 * was invented by a real person who is a client of this practice.
 *
 * **Why the names are listed here in full.** Naming them is what makes the test
 * work, and it is safe in a way the original use was not: this file says only
 * that these strings must never appear, which is true of any string. It carries
 * no reference, no matter, no date of birth and no connection to a record. What
 * leaked was a name written *as an example of a client of this practice*, in a
 * sentence describing their file. That is the thing this prevents.
 *
 * **What this cannot do.** It cannot reach the production register, so it
 * cannot tell you whether a name added tomorrow belongs to a real client. Only
 * a person can, by checking before they invent an example. What it can do is
 * stop these nine coming back, which is the fault repeating rather than a new
 * one.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/** Live records that were used as examples and have been replaced. */
const RETIRED = [
  'Dinh Dai Phu PHAN',
  'Anh Tan NGUYEN',
  'Elena TOROPOVA',
  'James MCFARLANE',
  'Thi Thu Thuy TRUONG',
  'Van Chien HOANG',
  'LAND MEAT NEW ZEALAND',
  'SOUTH PACIFIC MEATS',
  'AFFCO',
];

/** Everything the register is built from. Not `.git`, which cannot be changed. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.wrangler', 'dist', 'coverage'].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`.replace(/^\.\//, '');
    if (entry.isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx|js|mjs|md|sql|json|css|html)$/.test(path)) found.push(path);
  }
  return found;
}

describe('no live client is used as an example', () => {
  const files = sourceFiles('.');

  it('reads the whole repository, so a pass means something', () => {
    // The vacuity guard. A walker that silently found nothing would make every
    // assertion below true and say so cheerfully.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.startsWith('test/'))).toBe(true);
    expect(files.some((f) => f.startsWith('migrations/'))).toBe(true);
    expect(files.some((f) => f.startsWith('docs/'))).toBe(true);
    expect(files).toContain('CHANGELOG.md');
  });

  for (const name of RETIRED) {
    it(`does not name ${name.split(' ').slice(-1)[0]} again`, () => {
      const guilty = files.filter((f) => {
        // This file lists them on purpose; it is the only place that may.
        if (f.endsWith('norealnames.test.ts')) return false;
        return readFileSync(f, 'utf8').toUpperCase().includes(name.toUpperCase());
      });
      expect(guilty, `${name} is a live client; invent a name instead`).toEqual([]);
    });
  }
});
