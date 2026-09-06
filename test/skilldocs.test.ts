/**
 * The skills the practice installs in their own Claude project.
 *
 * `docs/skills/case-to-register/SKILL.md` tells another Claude how to write a
 * handover this register's intake can read. Its whole value is that the values
 * it writes match what the form matches on — a status or a role the register
 * does not have arrives as an empty box, silently, and the person checking has
 * to know it should not have been empty.
 *
 * Two of those lists live in code and cannot be changed without a deployment,
 * so they can be held against it here: the statuses a matter can be in, and the
 * roles a person can hold on one. Add a status, and this fails until the skill
 * knows about it.
 *
 * The other lists in that file — case types, visa types, flag kinds — are
 * **vocabularies**, editable by an administrator in Settings, and the practice's
 * own differ from the shipped defaults (their list says `rv_partner` where the
 * default says `rv_partnership`). So there is nothing in this repository to
 * check those against, and asserting them against the defaults would be
 * asserting the wrong thing. The skill carries the date they were read and says
 * what makes them stale; that is the honest arrangement, and it is written down
 * in `docs/skills/README.md` rather than left to be discovered.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CASE_STATUSES, PARTY_ROLES } from '../src/domain';

const skill = readFileSync('docs/skills/case-to-register/SKILL.md', 'utf8');

/**
 * The fenced block under one heading.
 *
 * Read from the block rather than from the whole file, because the whole file
 * is prose about immigration and searching it for a bare word finds the word.
 * The first attempt at this test did exactly that, and a party role called
 * `interpreter` passed because the flags section happens to mention an
 * interpreter.
 */
function listUnder(heading: string): string[] {
  const at = skill.indexOf(heading);
  if (at === -1) return [];
  const open = skill.indexOf('```', at);
  const close = skill.indexOf('```', open + 3);
  if (open === -1 || close === -1) return [];
  return skill.slice(open + 3, close).split('\n')
    .map((line) => line.split('|')[0]!.trim())
    .filter((key) => /^[a-z][a-z0-9_]*$/.test(key));
}

describe('the case-to-register skill', () => {
  it('lists every status a matter can be in, and no status there is not', () => {
    const listed = listUnder('### Matter status');
    expect(listed.length, 'the status list was not found in the skill').toBeGreaterThan(10);
    expect([...listed].sort()).toEqual([...CASE_STATUSES].sort());
  });

  it('lists every role a person can hold on a matter, and no role there is not', () => {
    const listed = listUnder('### Roles on a matter');
    expect(listed.length, 'the role list was not found in the skill').toBeGreaterThan(5);
    expect([...listed].sort()).toEqual([...PARTY_ROLES].sort());
  });

  it('gives a template line for every field the intake form has a box for', () => {
    // Checked in the two templates the skill tells the model to fill in, not
    // anywhere in the file — the worked example at the bottom carries the same
    // field names, so searching the whole document would pass on a template
    // that had lost one.
    const templates = skill.slice(skill.indexOf('### 1. Matter'), skill.indexOf('### 3. Summary'));
    for (const field of [
      'descriptor', 'case_type', 'status', 'inz_client_number', 'inz_application_number',
      'lodged_on', 'decision_due_on', 'given_names', 'family_name', 'preferred_name',
      'date_of_birth', 'email', 'phone', 'nationality', 'current_visa_type',
      'current_visa_expiry', 'role',
    ]) {
      expect(templates, `${field} is not in the skill's templates`).toContain(`${field}:`);
    }
    // Extracted by the model and then dropped: there is no box for it. The
    // skill has to say so rather than offer it as a field.
    expect(skill).toContain('Occupation, and anything else not in the list above');
  });

  it('says the limits the register actually imposes', () => {
    // Each of these is enforced in the code and would otherwise be found out by
    // having a handover truncated: the paste box, the file note, the warning
    // list, and the uploads on the same page.
    expect(skill).toContain('40,000 characters');
    expect(skill).toContain('8,000 characters');
    expect(skill).toContain('twelve lines');
    expect(skill).toContain('5 files, 8 MB each');
  });

  it('keeps the rule that nothing is written without a person', () => {
    expect(skill).toContain('Nothing is saved until a person');
  });
});
