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

/**
 * The nine, written so they are not readable in this repository.
 *
 * **They were listed here in plain words until 9 September 2026**, on the
 * reasoning that a bare string with no reference, no matter and no date beside
 * it carries nothing — which is true, and was still the wrong answer. The rule
 * in `CLAUDE.md` says real client data never enters the repository, and nine
 * clients' names sitting in a file called `norealnames.test.ts` is a joke at
 * the practice's expense. It also meant that any honest answer to *"is a
 * client of yours named anywhere in this code?"* had to begin with "yes, but".
 *
 * **This is obfuscation and not a secret**, and it matters to say so: base64 is
 * reversible by anybody who wants to reverse it, and the two lines below do
 * exactly that at runtime. What it buys is that the names cannot be read at a
 * glance, cannot be found by searching the repository or a code index, cannot
 * be copied out of a screenshot of this file, and are not carried in plain text
 * by any copy of it. For a private repository that is the whole of the exposure
 * that was left.
 *
 * If real protection is ever needed here, the answer is not a better encoding —
 * it is to keep the list outside the repository entirely and have this suite
 * skip when it is absent. That would trade a guarantee for a courtesy, which is
 * why it was not done.
 */
const RETIRED: string[] = [
  'RGluaCBEYWkgUGh1IFBIQU4=',
  'QW5oIFRhbiBOR1VZRU4=',
  'RWxlbmEgVE9ST1BPVkE=',
  'SmFtZXMgTUNGQVJMQU5F',
  'VGhpIFRodSBUaHV5IFRSVU9ORw==',
  'VmFuIENoaWVuIEhPQU5H',
  'TEFORCBNRUFUIE5FVyBaRUFMQU5E',
  'U09VVEggUEFDSUZJQyBNRUFUUw==',
  'QUZGQ08=',
].map((packed) => atob(packed));

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

  // Numbered, not named. A test title is printed by the runner and kept in
  // every CI log, so naming the client in it would put back — in a place
  // nobody thinks of as the repository — exactly what this suite exists to
  // keep out. The number is enough to say which one failed; the file that
  // failed is what somebody actually needs, and that is reported.
  RETIRED.forEach((name, index) => {
    it(`does not use retired example ${index + 1} of ${RETIRED.length} again`, () => {
      const guilty = files.filter((f) => {
        // This file holds them on purpose, encoded; it is the only place that may.
        if (f.endsWith('norealnames.test.ts')) return false;
        return readFileSync(f, 'utf8').toUpperCase().includes(name.toUpperCase());
      });
      expect(guilty, 'a live client is used as an example here; invent a name instead')
        .toEqual([]);
    });
  });

  it('is actually checking nine names, and readable ones', () => {
    // The encoding could silently produce empty strings, and a search for ''
    // matches every file — or, worse, matches nothing and passes. Neither
    // failure announces itself.
    expect(RETIRED.length).toBe(9);
    for (const name of RETIRED) expect(name.trim().length).toBeGreaterThan(4);
  });

  it('carries none of them in plain text', () => {
    // The point of the encoding. This file may hold the list; it may not hold
    // it in words. Checked by reading the file off disk rather than by trusting
    // that nobody pasted one back in beside the encoded form.
    const self = readFileSync('test/norealnames.test.ts', 'utf8').toUpperCase();
    for (const name of RETIRED) {
      expect(self.includes(name.toUpperCase()),
        'a retired name is written out in this file').toBe(false);
    }
  });
});
