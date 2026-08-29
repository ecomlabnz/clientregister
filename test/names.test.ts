import { describe, expect, it } from 'vitest';
import { composeFullName, familyNameFor, formalName, plainAscii, splitFullName } from '../src/core/names';

describe('composeFullName', () => {
  it('joins a person’s given and family names in reading order', () => {
    // The family name comes out in capitals: it is stored that way, so a
    // composed full name that did not would disagree with the column it was
    // built from.
    expect(composeFullName('individual', { givenNames: 'Ana Maria', familyName: 'Silva' }))
      .toBe('Ana Maria SILVA');
  });

  it('tolerates a missing half rather than leaving stray spaces', () => {
    expect(composeFullName('individual', { givenNames: '', familyName: 'Silva' })).toBe('SILVA');
    expect(composeFullName('individual', { givenNames: 'Ana', familyName: null })).toBe('Ana');
    expect(composeFullName('individual', {})).toBe('');
  });

  it('collapses untidy whitespace from pasted values', () => {
    expect(composeFullName('individual', { givenNames: '  Ana   Maria ', familyName: ' Silva  ' }))
      .toBe('Ana Maria SILVA');
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

describe('familyNameFor', () => {
  it('capitalises whatever was typed', () => {
    expect(familyNameFor('bui')).toBe('BUI');
    expect(familyNameFor('de Vries')).toBe('DE VRIES');
    expect(familyNameFor('  Silva  ')).toBe('SILVA');
    expect(familyNameFor(null)).toBe('');
    expect(familyNameFor(undefined)).toBe('');
  });

  it('handles names SQL could not', () => {
    // Two things SQL cannot do to a name. It has no way to strip diacritics at
    // all, and its UPPER() is ASCII-only — 'Nguyễn' comes back 'NGUYễN',
    // changing half the letters and leaving half. Both are why this lives in
    // the application rather than in a migration.
    expect(familyNameFor('Nguyễn')).toBe('NGUYEN');
    expect(familyNameFor('müller')).toBe('MULLER');
    expect(familyNameFor("ma'afu")).toBe("MA'AFU");
  });

  it('is what composeFullName uses, so the two never disagree', () => {
    expect(composeFullName('individual', { givenNames: 'Dac Dat', familyName: 'Bui' }))
      .toBe('Dac Dat BUI');
    // An organisation has a registered name, not a surname to capitalise.
    expect(composeFullName('organisation', {}, 'Kiwi Orchards Limited'))
      .toBe('Kiwi Orchards Limited');
  });
});

describe('plainAscii', () => {
  it('writes a name in plain English letters', () => {
    expect(plainAscii('Rāwiri')).toBe('Rawiri');
    expect(plainAscii('José')).toBe('Jose');
    expect(plainAscii('Müller')).toBe('Muller');
    expect(plainAscii('Nguyễn')).toBe('Nguyen');
  });

  it('handles the letters that do not decompose', () => {
    // The Vietnamese đ is the one that matters most for this caseload: without
    // an explicit map "Đặng" comes out "Đang" — half converted, which is worse
    // than either end of the choice.
    expect(plainAscii('Đặng')).toBe('Dang');
    expect(plainAscii('Ørsted')).toBe('Orsted');
    expect(plainAscii('Łukasz')).toBe('Lukasz');
    expect(plainAscii('Straße')).toBe('Strasse');
  });

  it('leaves a plain name alone', () => {
    expect(plainAscii('Tagata')).toBe('Tagata');
    expect(plainAscii("O'Brien")).toBe("O'Brien");
    expect(plainAscii('')).toBe('');
    expect(plainAscii(null)).toBe('');
  });

  it('is applied to both halves of a name', () => {
    expect(familyNameFor('Rāwiri')).toBe('RAWIRI');
    expect(composeFullName('individual', { givenNames: 'Hiné', familyName: 'Rāwiri' }))
      .toBe('Hine RAWIRI');
    expect(formalName({ givenNames: 'Thi Thu Thuy', familyName: 'Trương' }))
      .toBe('TRUONG, Thi Thu Thuy');
  });

  it('leaves a registered company name as the register holds it', () => {
    // An organisation's name is copied from the Companies Office, not restyled
    // by this practice.
    expect(composeFullName('organisation', {}, 'Kiwi Ōrchards Limited'))
      .toBe('Kiwi Ōrchards Limited');
  });
});
