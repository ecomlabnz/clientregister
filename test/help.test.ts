/**
 * Help, in parts.
 *
 * **Asked for on 12 September 2026**, in the middle of taking explanatory text
 * off the screens: *"re Less on the screen - i believe it is good time to
 * thoroughly review and update the help section, please do."*
 *
 * What was wrong with it was not the writing. Every one of the twenty-eight
 * sections and every release ever made were rendered into **one page** — about
 * eleven thousand words of guidance and twenty-two thousand of release notes,
 * on the page somebody opens when they are already stuck.
 *
 * There was no test for this page at all, which is how it grew that way. These
 * are the guarantees worth holding:
 *
 *  * every section is on exactly one tab, and none is orphaned — a section that
 *    exists and is on no tab is a section nobody can reach;
 *  * a tab shows only its own sections;
 *  * a link from elsewhere in the register lands on the right section, opened;
 *  * the release list is capped, and says how many there are in all.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { helpModule, RELEASES } from '../src/modules/help';

const mounted = () => mountModule(helpModule, { user: fakeUser() });
const at = async (path: string) => (await mounted().request(path)).text();

/** The `id` of every section the page can draw, read out of the source. */
const SECTION_IDS = [...readFileSync('src/modules/help/index.ts', 'utf8')
  .matchAll(/^      id: '([a-z-]+)',$/gm)].map((m) => m[1]!);

/** The groups, as declared. */
const GROUPS = [...readFileSync('src/modules/help/index.ts', 'utf8')
  .matchAll(/\{\s*id: '([a-z-]+)', label: '[^']+',\s*sections: \[([^\]]+)\]/gs)]
  .map((m) => ({
    id: m[1]!,
    sections: [...m[2]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!),
  }));

describe('every section is reachable', () => {
  it('reads a group list and a section list out of the module', () => {
    // Guards the two regexes above: if either stops matching, the tests below
    // would pass vacuously.
    expect(SECTION_IDS.length).toBeGreaterThan(20);
    expect(GROUPS.length).toBeGreaterThan(4);
  });

  it('puts every section on a tab', () => {
    const grouped = new Set(GROUPS.flatMap((g) => g.sections));
    const orphans = SECTION_IDS.filter((id) => !grouped.has(id));
    expect(orphans, `on no tab: ${orphans.join(', ')}`).toEqual([]);
  });

  it('names no section that does not exist', () => {
    const known = new Set(SECTION_IDS);
    const ghosts = GROUPS.flatMap((g) => g.sections).filter((id) => !known.has(id));
    expect(ghosts, `named but missing: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('puts each section on exactly one tab', () => {
    const seen = new Map<string, number>();
    for (const id of GROUPS.flatMap((g) => g.sections)) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(twice, `on more than one tab: ${twice.join(', ')}`).toEqual([]);
  });
});

describe('a tab shows its own sections and no others', () => {
  it('opens on the first tab', async () => {
    const body = await at('/help');
    expect(body).toContain('<h2>Getting around</h2>');
    // A money section is on another tab.
    expect(body).not.toContain('<h2>Quotes</h2>');
  });

  it('shows the money sections on the money tab', async () => {
    const body = await at('/help?g=money');
    expect(body).toContain('<h2>Quotes</h2>');
    expect(body).not.toContain('<h2>Getting around</h2>');
  });

  it('falls back to the first tab rather than to nothing', async () => {
    // A help page that opens empty because of a stale link is the worst
    // version of this page there is.
    const body = await at('/help?g=nonsense');
    expect(body).toContain('<h2>Getting around</h2>');
  });
});

describe('a link from elsewhere lands on the answer', () => {
  it('opens the section it names, on whichever tab it lives', async () => {
    const body = await at('/help?s=connecting');
    expect(body).toContain('<h2>Connecting');
    // Opened rather than merely present.
    const at_ = body.indexOf('<h2>Connecting');
    const tag = body.slice(body.lastIndexOf('<details', at_), at_);
    expect(tag).toContain('open');
  });

  it('the register links to it that way, not by a fragment', () => {
    // A fragment never reaches the server, so `/help#connecting` would land on
    // whatever tab happened to be first.
    const src = ['src/modules/admin/index.ts', 'src/modules/assistant/index.ts',
      'src/modules/help/index.ts'].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toContain('/help#');
    expect(src).toContain('/help?s=connecting');
  });

  it('ignores a section name it does not know', async () => {
    const body = await at('/help?s=nonsense');
    expect(body).toContain('<h2>Getting around</h2>');
  });
});

describe('sections start closed, so a tab is a list of questions', () => {
  it('leaves them shut on a tab with more than one', async () => {
    const body = await at('/help?g=money');
    const shut = [...body.matchAll(/<details class="card-fold" >/g)].length;
    expect(shut).toBeGreaterThanOrEqual(2);
  });

  it('opens the only one on a tab that has one', async () => {
    // "What changed" is a tab of one. Making somebody click it would be silly.
    const body = await at('/help?g=changes');
    expect(body).toContain('<details class="card-fold" open>');
  });
});

describe('recent changes are recent', () => {
  it('shows a capped list, not every release ever made', async () => {
    const body = await at('/help?g=changes');
    const shown = [...body.matchAll(/<h4>\d+\.\d+\.\d+ — /g)].length;
    expect(shown).toBeLessThanOrEqual(20);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(RELEASES.length);
  });

  it('says how many there have been in all', async () => {
    const body = await at('/help?g=changes');
    expect(body).toContain(`${RELEASES.length} releases in all`);
  });

  it('starts with the newest', async () => {
    const body = await at('/help?g=changes');
    expect(body).toContain(`<h4>${RELEASES[0]!.version} —`);
  });
});

describe('the guidance matches what the register does', () => {
  const help = readFileSync('src/modules/help/index.ts', 'utf8');

  it.each([
    ['a certificate can be corrected', 'Correcting one'],
    ['the submitted box goes away', 'until\n           you have used it, then goes away'],
    ['the three histories', 'Employment, education and travel history'],
    ['a gap is drawn', 'shaded line saying how many months'],
    ['unemployment is a row', 'A period of unemployment is a row like any other'],
    ['the military block holds the three questions', 'The three questions the INZ 1200 asks'],
    ['visa conditions and stay limit', 'Stay limit'],
    ['the five closed blocks on a matter', 'Five of them start closed'],
    ['the practice caseload', 'Load the caseload'],
    ['no trial-only login', 'own copy of it instead'],
    ['a decision says which way it went', 'A decision says which way it went'],
  ])('says %s', (_what, phrase) => {
    expect(help).toContain(phrase);
  });
});
