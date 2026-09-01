import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RELEASES } from '../src/modules/help';

/**
 * A release is three edits that must agree.
 *
 * The version in `package.json`, an entry in `CHANGELOG.md`, and a line under
 * Help → Recent changes written in the practice's voice. The rule is written
 * down in CLAUDE.md and nothing enforced it, so the three could drift — and the
 * one that drifts is always Help, because it is the one a developer does not
 * see while working.
 *
 * This asserts the agreement rather than the wording.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const changelog = readFileSync('CHANGELOG.md', 'utf8');

/** Every version heading in the changelog, newest first. */
const changelogVersions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+) —/gm)].map((m) => m[1]!);

describe('a release is three edits that agree', () => {
  it('has a changelog entry for the version in package.json', () => {
    expect(changelogVersions).toContain(pkg.version);
  });

  it('has a line under Help → Recent changes for it', () => {
    expect(RELEASES.map((r) => r.version)).toContain(pkg.version);
  });

  it('leads both lists with the current version', () => {
    // Not merely present — newest. A release added below an older one reads as
    // history rather than as what just shipped.
    expect(changelogVersions[0]).toBe(pkg.version);
    expect(RELEASES[0]!.version).toBe(pkg.version);
  });

  it('says the same thing on both lists, version for version', () => {
    // Help may lag the changelog for versions before this rule existed, so the
    // comparison runs over what Help claims, not over the whole changelog.
    for (const r of RELEASES) {
      expect(changelogVersions, `${r.version} is on Help but not in CHANGELOG.md`)
        .toContain(r.version);
    }
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it('gives every Help entry a date and something to read', () => {
    for (const r of RELEASES) {
      expect(r.date, `${r.version} has no date`).toMatch(/\d{1,2} \w+ \d{4}/);
      expect(r.notes.length, `${r.version} has no notes`).toBeGreaterThan(0);
      for (const note of r.notes) {
        // A sentence, not a length. The first version of this counted
        // characters and failed "Sign out added to the top bar." — a perfectly
        // good note that happens to be thirty characters long. What makes a
        // note useful is that it says something, and a fragment like "This
        // manual." does not.
        expect(note.trim().split(/\s+/).length, `a note on ${r.version} is not a sentence`)
          .toBeGreaterThanOrEqual(4);
        expect(note.trim(), `a note on ${r.version} does not end in a full stop`)
          .toMatch(/[.?]$/);
        // The practice's voice: plain words a non-developer reads without
        // translation. These are the terms that have had to be taken out before.
        expect(note, `${r.version} uses a developer's word`)
          .not.toMatch(/\b(refactor|migration \d+|regex|API|null|boolean|middleware|callback)\b/i);
      }
    }
  });

  it('orders Help newest first', () => {
    const rank = (v: string) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
    const ranks = RELEASES.map((r) => rank(r.version));
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });
});
