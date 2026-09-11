/**
 * Turning what was typed into a box back into the thing that was picked.
 *
 * The half of the type-to-find box that can go wrong quietly. A dropdown
 * posted an id and the route either had it or did not; a text box posts words,
 * and the failure to guard against is not an error page — it is a quotation
 * attaching itself to the wrong person's matter because two lines looked
 * alike.
 *
 * So the rule being pinned here is: **exact where it can be, refused where it
 * cannot, and never a guess between two.**
 */

import { describe, expect, it } from 'vitest';
import { matchOption, matchProblem, readChoice } from '../src/core/options';

const OPTIONS = [
  { value: 'k1', label: 'RV. Partner — VUONG, Bao Long (CASE-26-014)' },
  { value: 'k2', label: 'RV. Partner — VUONG, Bao Long (CASE-26-015)' },
  { value: 'k3', label: 'WV. AEWV — DOAN, Thi Kim Oanh (CASE-26-021)' },
  { value: 'k4', label: 'EMP. Employer Accreditation — ACME PACKING LIMITED (CASE-26-030)' },
];

describe('what it resolves', () => {
  it('takes the line exactly as it was offered', () => {
    expect(matchOption('WV. AEWV — DOAN, Thi Kim Oanh (CASE-26-021)', OPTIONS))
      .toEqual({ found: true, value: 'k3' });
  });

  it('takes the id, which is what a preset link carries', () => {
    expect(matchOption('k3', OPTIONS)).toEqual({ found: true, value: 'k3' });
  });

  it('forgives case and stray spacing in a retyped line', () => {
    expect(matchOption('  wv. aewv —  doan, thi kim oanh (case-26-021) ', OPTIONS))
      .toEqual({ found: true, value: 'k3' });
  });

  it('takes a reference on its own, which is what is in front of somebody reading a file', () => {
    expect(matchOption('CASE-26-021', OPTIONS)).toEqual({ found: true, value: 'k3' });
    expect(matchOption('case-26-021', OPTIONS)).toEqual({ found: true, value: 'k3' });
  });

  it('takes a fragment when only one line contains it', () => {
    expect(matchOption('doan', OPTIONS)).toEqual({ found: true, value: 'k3' });
    expect(matchOption('acme', OPTIONS)).toEqual({ found: true, value: 'k4' });
    expect(matchOption('26-030', OPTIONS)).toEqual({ found: true, value: 'k4' });
  });

  it('reads an empty box as nothing chosen, not as a failure', () => {
    expect(matchOption('', OPTIONS)).toEqual({ found: true, value: null });
    expect(matchOption('   ', OPTIONS)).toEqual({ found: true, value: null });
    expect(matchOption(null, OPTIONS)).toEqual({ found: true, value: null });
  });
});

describe('what it refuses', () => {
  it('refuses a fragment that fits two matters rather than picking one', () => {
    // The failure this whole file exists for: the same person, two matters of
    // the same kind. Guessing here bills the wrong file.
    expect(matchOption('vuong', OPTIONS)).toEqual({ found: false, ambiguous: true });
    expect(matchOption('RV. Partner', OPTIONS)).toEqual({ found: false, ambiguous: true });
  });

  it('refuses something that matches nothing', () => {
    expect(matchOption('a name nobody typed', OPTIONS)).toEqual({ found: false, ambiguous: false });
  });

  it('refuses a reference that is not on the list it was offered', () => {
    // A closed matter is not offered, so typing its reference must not reach
    // it. The list is the permission, not a convenience.
    expect(matchOption('CASE-25-001', OPTIONS)).toEqual({ found: false, ambiguous: false });
  });

  it('says which of the two problems it is', () => {
    expect(matchProblem('vuong', 'matter', true)).toContain('More than one matter');
    expect(matchProblem('vuong', 'matter', false)).toContain('No matter matches');
    expect(matchProblem('vuong', 'matter', true)).toContain('vuong');
  });
});

describe('reading one off a form', () => {
  function reader(value: string) {
    return {
      errors: {} as Record<string, string>,
      optional: () => value,
    };
  }

  it('puts the problem on the field, so the form comes back filled in', () => {
    const f = reader('vuong');
    expect(readChoice(f, 'case_id', OPTIONS, { label: 'Matter' })).toBe(null);
    expect(f.errors['case_id']).toContain('More than one matter');
  });

  it('says a required box is required when it is left empty', () => {
    const f = reader('');
    expect(readChoice(f, 'client_id', OPTIONS, { required: true, label: 'Client' })).toBe(null);
    expect(f.errors['client_id']).toBe('Client is required.');
  });

  it('lets an optional box be left empty', () => {
    const f = reader('');
    expect(readChoice(f, 'case_id', OPTIONS, { label: 'Matter' })).toBe(null);
    expect(f.errors).toEqual({});
  });

  it('leaves a message already on the field alone', () => {
    const f = reader('nothing like it');
    f.errors['case_id'] = 'Something else was wrong first.';
    readChoice(f, 'case_id', OPTIONS, { label: 'Matter' });
    expect(f.errors['case_id']).toBe('Something else was wrong first.');
  });
});
