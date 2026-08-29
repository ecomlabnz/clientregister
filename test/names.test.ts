import { describe, expect, it } from 'vitest';
import { composeFullName, formalName, splitFullName } from '../src/core/names';

describe('composeFullName', () => {
  it('joins a person’s given and family names in reading order', () => {
    expect(composeFullName('individual', { givenNames: 'Ana Maria', familyName: 'Silva' }))
      .toBe('Ana Maria Silva');
  });

  it('tolerates a missing half rather than leaving stray spaces', () => {
    expect(composeFullName('individual', { givenNames: '', familyName: 'Silva' })).toBe('Silva');
    expect(composeFullName('individual', { givenNames: 'Ana', familyName: null })).toBe('Ana');
    expect(composeFullName('individual', {})).toBe('');
  });

  it('collapses untidy whitespace from pasted values', () => {
    expect(composeFullName('individual', { givenNames: '  Ana   Maria ', familyName: ' Silva  ' }))
      .toBe('Ana Maria Silva');
  });

  it('uses the registered name for an organisation, ignoring person fields', () => {
    expect(composeFullName('organisation', { givenNames: 'Ana', familyName: 'Silva' }, 'Kiwi Orchards Limited'))
      .toBe('Kiwi Orchards Limited');
  });
});

describe('formalName', () => {
  it('reads family first for listings', () => {
    expect(formalName({ givenNames: 'Ana Maria', familyName: 'Silva' })).toBe('SILVA, Ana Maria');
    expect(formalName({ familyName: 'Silva' })).toBe('SILVA');
    expect(formalName({ givenNames: 'Ana' })).toBe('Ana');
    expect(formalName({}, 'Unnamed')).toBe('Unnamed');
  });

  it('capitalises the family name, as a passport does', () => {
    // Half this practice's clients have names whose order is not the English
    // one. "TRUONG, Thi Thu Thuy" says which part is the family name;
    // "Truong, Thi Thu Thuy" leaves it to be guessed, and guessing wrong on a
    // form comes back as a request for evidence.
    expect(formalName({ givenNames: 'Thi Thu Thuy', familyName: 'Truong' }))
      .toBe('TRUONG, Thi Thu Thuy');
    // Only the family name. Given names keep the capitalisation they were
    // entered with, because that is how the person writes them.
    expect(formalName({ givenNames: 'Dac Dat', familyName: 'bui' })).toBe('BUI, Dac Dat');
  });
});

describe('splitFullName', () => {
  it('treats the last word as the family name', () => {
    expect(splitFullName('Ana Maria Silva')).toEqual({ givenNames: 'Ana Maria', familyName: 'Silva' });
    expect(splitFullName('Ana Silva')).toEqual({ givenNames: 'Ana', familyName: 'Silva' });
  });

  it('honours an explicit "Family, Given" form', () => {
    expect(splitFullName('Silva, Ana Maria')).toEqual({ givenNames: 'Ana Maria', familyName: 'Silva' });
  });

  it('treats a single word as a family name, which mononyms usually are', () => {
    expect(splitFullName('Prince')).toEqual({ givenNames: '', familyName: 'Prince' });
  });

  it('handles empty input without throwing', () => {
    expect(splitFullName('')).toEqual({ givenNames: '', familyName: '' });
    expect(splitFullName(null)).toEqual({ givenNames: '', familyName: '' });
  });
});
