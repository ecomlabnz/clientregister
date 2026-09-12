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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Every file git tracks, which is exactly the set that can be committed. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
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
const SKIP = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip|lock)$/i;

describe('nothing committed carries the debris of a merge', () => {
  it('has no conflict markers in any tracked file', () => {
    const found: string[] = [];
    for (const file of trackedFiles()) {
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
