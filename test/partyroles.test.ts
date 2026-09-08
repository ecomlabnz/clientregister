/**
 * Who somebody is on a matter.
 *
 * **Asked 8 September 2026:** *"i need another option in the drop down —
 * 'Partner', someone who is partner but not party to the application, not a
 * supporting partner, just partner."* And, a moment later: *"and one more —
 * 'Family member'."*
 *
 * The distinction is the whole point and it is easy to lose, so it is written
 * down here as well as in the list:
 *
 *   - **Supporting partner** — the partner the application turns on, whose
 *     relationship INZ will assess and whose evidence the file is built on.
 *   - **Partner** — simply the applicant's partner. On the file because the
 *     file needs to know who they are, not because anything is being claimed
 *     through them.
 *   - **Family member** — any other relative in the same position: named,
 *     neither applying nor relied on.
 *
 * `case_parties.role` carries no CHECK — the list is enforced in the routes by
 * `f.enum(PARTY_ROLES)` — so what holds the list together is this test and the
 * label map, and a role added to one without the other is what it catches.
 */

import { describe, expect, it } from 'vitest';
import { PARTY_ROLES, PARTY_ROLE_LABELS, APPLICANT_ROLES, isPartyRole } from '../src/domain';
import { ROLE_ORDER_FOR_TEST } from '../src/core/parties';

describe('the roles somebody can hold on a matter', () => {
  it('offers Partner and Family member', () => {
    expect(PARTY_ROLES).toContain('partner');
    expect(PARTY_ROLES).toContain('family_member');
    expect(PARTY_ROLE_LABELS.partner).toBe('Partner');
    expect(PARTY_ROLE_LABELS.family_member).toBe('Family member');
  });

  it('keeps Partner distinct from Supporting partner', () => {
    // Two rows, two meanings. Collapsing them would lose the answer to "is
    // INZ going to assess this relationship", which is the only question the
    // distinction exists to answer.
    expect(PARTY_ROLE_LABELS.partner).not.toBe(PARTY_ROLE_LABELS.supporting_partner);
    expect(new Set(Object.values(PARTY_ROLE_LABELS)).size).toBe(PARTY_ROLES.length);
  });

  it('makes neither of them an applicant', () => {
    // The reason the practice asked for them: somebody named on the file who
    // is not part of the application.
    expect(APPLICANT_ROLES).not.toContain('partner');
    expect(APPLICANT_ROLES).not.toContain('family_member');
  });

  it('accepts them from a form', () => {
    expect(isPartyRole('partner')).toBe(true);
    expect(isPartyRole('family_member')).toBe(true);
    expect(isPartyRole('spouse')).toBe(false);
  });

  it('names every role exactly once in the reading order', () => {
    // A role missing here sorts to the top of every matter, because
    // indexOf returns -1. That is how it would be noticed: silently, and on
    // the wrong screen.
    expect([...ROLE_ORDER_FOR_TEST].sort()).toEqual([...PARTY_ROLES].sort());
  });

  it('reads Partner next to Supporting partner, where the choice is made', () => {
    const order = ROLE_ORDER_FOR_TEST;
    expect(order.indexOf('partner')).toBe(order.indexOf('supporting_partner') + 1);
  });

  it('gives every role a label', () => {
    for (const role of PARTY_ROLES) {
      expect(PARTY_ROLE_LABELS[role], `${role} has no label`).toBeTruthy();
    }
  });
});
