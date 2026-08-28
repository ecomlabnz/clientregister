import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CASE_TYPE_VOCAB, isTerm, labelFor, parseVocabulary, termOptions,
} from '../src/core/vocabulary';
import { LEGACY_CASE_TYPE_LABELS } from '../src/domain';

describe('reading a configured list', () => {
  it('reads key and label', () => {
    expect(parseVocabulary('wv_aewv | WV. AEWV\nrv_smc | RV. SMC')).toEqual([
      { key: 'wv_aewv', label: 'WV. AEWV' },
      { key: 'rv_smc', label: 'RV. SMC' },
    ]);
  });

  it('derives a key from a bare line, so a plain list still works', () => {
    expect(parseVocabulary('Visitor visa')).toEqual([{ key: 'visitor_visa', label: 'Visitor visa' }]);
  });

  it('normalises a key rather than refusing it', () => {
    expect(parseVocabulary('WV. AEWV | Work visa')).toEqual([{ key: 'wv_aewv', label: 'Work visa' }]);
  });

  it('ignores blank lines and comments, so the list can be grouped', () => {
    expect(parseVocabulary('# Visitor\nvv_general | VV. General\n\n# Work\nwv_aewv | WV. AEWV')).toEqual([
      { key: 'vv_general', label: 'VV. General' },
      { key: 'wv_aewv', label: 'WV. AEWV' },
    ]);
  });

  it('keeps the first of a duplicated key and drops what cannot be a key', () => {
    expect(parseVocabulary('x | First\nx | Second')).toEqual([{ key: 'x', label: 'First' }]);
    expect(parseVocabulary(' | orphan\n!!! | \n')).toEqual([]);
  });
});

describe('showing a stored value', () => {
  const terms = parseVocabulary('wv_aewv | WV. AEWV');

  it('uses the configured label', () => {
    expect(labelFor(terms, 'wv_aewv')).toBe('WV. AEWV');
  });

  it('shows a retired value as itself rather than hiding it', () => {
    // A case filed under a type since removed from the list is still that kind
    // of case; showing a blank would lose information off the file.
    expect(labelFor(terms, 'rv_parent')).toBe('rv_parent');
  });

  it('shows an em dash for nothing at all', () => {
    expect(labelFor(terms, null)).toBe('—');
    expect(labelFor(terms, '')).toBe('—');
  });
});

describe('what may be written', () => {
  const terms = parseVocabulary('wv_aewv | WV. AEWV\nrv_smc | RV. SMC');

  it('accepts only a configured term', () => {
    expect(isTerm(terms, 'wv_aewv')).toBe(true);
    for (const junk of ['rv_parent', '', null, undefined, 'wv_aewv; drop']) {
      expect(isTerm(terms, junk as string), String(junk)).toBe(false);
    }
  });

  it('offers exactly the configured terms to a dropdown', () => {
    expect(termOptions(terms)).toEqual([
      { value: 'wv_aewv', label: 'WV. AEWV' },
      { value: 'rv_smc', label: 'RV. SMC' },
    ]);
  });
});

describe('the case types shipped as the default', () => {
  const terms = parseVocabulary(CASE_TYPE_VOCAB.defaults);

  it('covers the practice list, with unique usable keys', () => {
    expect(terms.length).toBeGreaterThan(50);
    expect(new Set(terms.map((t) => t.key)).size).toBe(terms.length);
    for (const t of terms) expect(t.key, t.label).toMatch(/^[a-z0-9_]{1,60}$/);
  });

  it('includes every target the migration maps the old types onto', () => {
    const migration = readFileSync('migrations/0012_case_type_vocabulary.sql', 'utf8');
    const targets = [...migration.matchAll(/THEN '([a-z0-9_]+)'/g)].map((m) => m[1]!);
    expect(targets).toHaveLength(Object.keys(LEGACY_CASE_TYPE_LABELS).length);
    for (const target of targets) {
      expect(isTerm(terms, target), `${target} is mapped to but not offered`).toBe(true);
    }
  });
});
