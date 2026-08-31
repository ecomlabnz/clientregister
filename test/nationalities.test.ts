/**
 * A person may hold more than one nationality.
 *
 * Reported on 31 August 2026 from a partnership file: the supporting partner
 * is a national of Vietnam and of New Zealand, the document says so plainly,
 * and the register recorded neither — the intake form had one dropdown, the
 * phrase resolved to no single country, and the box came back "Not recorded".
 *
 * That is not a display fault. Dual nationality decides whether somebody needs
 * a visa at all, which police certificates are required and which passport an
 * application is made on. A field that cannot hold the answer is worse than no
 * field, because it looks answered.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_NATIONALITIES, codesFromText, normaliseCodes,
} from '../src/core/nationalities';

describe('reading nationalities out of what a document says', () => {
  it('reads two out of one phrase', () => {
    // The line that started this. A document states dual nationality as one
    // sentence far more often than as two fields.
    expect(codesFromText('Vietnam and New Zealand')).toEqual(['VN', 'NZ']);
    expect(codesFromText('dual Vietnamese/New Zealand citizen')).toEqual(['VN', 'NZ']);
    expect(codesFromText('Vietnam, New Zealand')).toEqual(['VN', 'NZ']);
    expect(codesFromText('Vietnam; New Zealand')).toEqual(['VN', 'NZ']);
    expect(codesFromText('Vietnam & New Zealand')).toEqual(['VN', 'NZ']);
  });

  it('still reads one', () => {
    expect(codesFromText('Vietnam')).toEqual(['VN']);
    expect(codesFromText('Vietnamese')).toEqual(['VN']);
    expect(codesFromText('NZ')).toEqual(['NZ']);
  });

  it('returns nothing rather than a guess', () => {
    // A wrong nationality confidently pre-filled is worse than an empty box:
    // the empty one gets filled in, and the wrong one gets confirmed.
    expect(codesFromText('Somewhere in the Pacific')).toEqual([]);
    expect(codesFromText(null)).toEqual([]);
    expect(codesFromText('')).toEqual([]);
  });

  it('keeps the order the document used', () => {
    // The first is the one the practice would name first — in practice, the
    // passport the application is likely to be made on.
    expect(codesFromText('New Zealand and Vietnam')).toEqual(['NZ', 'VN']);
  });
});

describe('cleaning what comes off a form', () => {
  it('drops a country chosen twice rather than refusing the save', () => {
    // Two boxes offering the same list is a slip, not an error worth a page.
    expect(normaliseCodes(['NZ', 'NZ'])).toEqual(['NZ']);
  });

  it('drops anything that is not a country code', () => {
    expect(normaliseCodes(['NZ', '', null, undefined, 'Vietnam', 'ZZZ'])).toEqual(['NZ']);
  });

  it('accepts a code in any case, and stores it in one', () => {
    expect(normaliseCodes(['nz', 'vN'])).toEqual(['NZ', 'VN']);
  });

  it('is bounded', () => {
    // Enough for anybody, and a bound all the same: a form is a thing people
    // can build by hand.
    const many = ['NZ', 'VN', 'AU', 'GB', 'US', 'CA', 'FR'];
    expect(normaliseCodes(many)).toHaveLength(MAX_NATIONALITIES);
  });
});
