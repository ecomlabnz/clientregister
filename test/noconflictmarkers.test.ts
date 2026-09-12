/**
 * No file carries the leftovers of a merge.
 *
 * **Written 12 September 2026, because it had already happened.** A cherry-pick
 * of the trusted-machine work conflicted in `CHANGELOG.md`. The conflict was
 * resolved by reordering the two release blocks — and the three marker lines
 * were carried along with the blocks rather than deleted, then committed, then
 * pushed. It survived a full test run, a typecheck and a spec regeneration,
 * and was found by somebody else reading the file for an unrelated reason.
 *
 * The reason nothing caught it is the thing worth fixing: the check made after
 * resolving was "are the release headings in the right order", which they were.
 * A check that asks whether the *outcome* looks right cannot see debris beside
 * it. So this asks the plainer question instead.
 *
 * `CHANGELOG.md` is the likeliest victim and the least likely to be noticed:
 * it is append-at-the-top, every release touches the same first few lines, and
 * almost nothing reads it back. A marker in a `.ts` file fails the typecheck
 * within seconds; one in prose can sit there for months.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Everything committable, walked from disk.
 *
 * `git ls-files` would be the exact answer, but it needs `node:child_process`,
 * which this project's TypeScript config does not carry types for — the code
 * here is built for Workers, where there is no child process. Walking the tree
 * and skipping what git ignores reaches the same set for this purpose.
 */
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.wrangler', 'dist', 'coverage']);


function committableFiles(dir = '.', out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const path = dir === '.' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) committableFiles(path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * The three markers, anchored to the start of a line and written so this file
 * does not trip its own test — each is assembled rather than spelled out.
 */
const MARKERS = [
  { label: 'ours', re: new RegExp(`^${'<'.repeat(7)} `, 'm') },
  { label: 'theirs', re: new RegExp(`^${'>'.repeat(7)} `, 'm') },
  { label: 'divider', re: new RegExp(`^${'='.repeat(7)}$`, 'm') },
];

/** Binary and generated things a grep would only produce noise on. */
const SKIP = /(\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip|lock)$|^package-lock\.json$|\.min\.[a-z]+$)/i;

describe('nothing committed carries the debris of a merge', () => {
  it('has no conflict markers in any tracked file', () => {
    const found: string[] = [];
    const files = committableFiles();
    // A walk that found almost nothing would pass silently, so check it read
    // the repository rather than an empty directory.
    expect(files.length, 'the walk found no files, so this proves nothing')
      .toBeGreaterThan(200);
    for (const file of files) {
      if (SKIP.test(file)) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue; // Unreadable as text: not our business.
      }
      for (const { label, re } of MARKERS) {
        const m = re.exec(text);
        if (m) {
          const line = text.slice(0, m.index).split('\n').length;
          found.push(`${file}:${line} (${label})`);
        }
      }
    }
    expect(found, `a merge was resolved and its markers were left behind:\n  ${found.join('\n  ')}`)
      .toEqual([]);
  });

  it('can actually see one, so a pass means something', () => {
    // The test above is a search that finds nothing. That is indistinguishable
    // from a search that cannot find anything, so prove the pattern bites.
    const sample = ['a line', '<'.repeat(7) + ' HEAD', 'mine', '='.repeat(7), 'theirs',
                    '>'.repeat(7) + ' abc123', 'another line'].join('\n');
    expect(MARKERS.filter((m) => m.re.test(sample)).map((m) => m.label))
      .toEqual(['ours', 'theirs', 'divider']);
  });
});
