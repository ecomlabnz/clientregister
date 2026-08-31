import { describe, expect, it } from 'vitest';
import {
  ALL_PREFERENCES, PREFERENCE_GROUPS, asPrefBoolean, asPrefInteger, coercePreference, preferenceByKey,
} from '../src/core/preferences';

const landing = preferenceByKey('pref.landing')!;
const pageSize = preferenceByKey('pref.page_size')!;
const assign = preferenceByKey('pref.assign_to_me')!;

describe('only an offered value can be stored', () => {
  it('accepts one of the options', () => {
    expect(coercePreference(landing, '/cases')).toBe('/cases');
    expect(coercePreference(pageSize, '50')).toBe('50');
  });

  it('falls back to the default for anything else', () => {
    // Notably an absolute URL: a landing preference is used in a redirect, and
    // must never become one somebody else chose.
    for (const junk of ['https://evil.example', '//evil.example', '/admin/../etc', '', null]) {
      expect(coercePreference(landing, junk as string), String(junk)).toBe('/');
    }
    expect(coercePreference(pageSize, '10000')).toBe('25');
  });
});

describe('a checkbox says no by being absent', () => {
  it('reads absence as false and presence as true', () => {
    expect(coercePreference(assign, null)).toBe('false');
    expect(coercePreference(assign, 'on')).toBe('true');
    expect(coercePreference(assign, 'true')).toBe('true');
    expect(coercePreference(assign, 'anything else')).toBe('false');
  });
});

describe('numbers are clamped rather than trusted', () => {
  const def = { key: 'x', label: 'x', type: 'integer' as const, default: '25', min: 5, max: 100 };
  it('holds a value inside its range', () => {
    expect(coercePreference(def, '4')).toBe('5');
    expect(coercePreference(def, '500')).toBe('100');
    expect(coercePreference(def, '60')).toBe('60');
    expect(coercePreference(def, 'lots')).toBe('25');
  });
});

describe('reading values back', () => {
  it('handles a missing value', () => {
    expect(asPrefInteger(undefined, 25)).toBe(25);
    expect(asPrefInteger('50', 25)).toBe(50);
    expect(asPrefBoolean(undefined, true)).toBe(true);
    expect(asPrefBoolean('false', true)).toBe(false);
  });
});

describe('every declared preference is usable', () => {
  it('has a default that is itself valid', () => {
    for (const def of ALL_PREFERENCES) {
      expect(coercePreference(def, def.default), def.key).toBe(def.default);
      if (def.type === 'enum') {
        expect(def.options?.length, `${def.key} has no options`).toBeGreaterThan(1);
      }
    }
  });

  it('has a unique key, so two groups cannot fight over one', () => {
    const keys = ALL_PREFERENCES.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(PREFERENCE_GROUPS.length).toBeGreaterThan(0);
  });
});

describe('a group of preferences is saved on its own', () => {
  it('puts every preference in exactly one group', () => {
    const seen = new Map<string, string>();
    for (const group of PREFERENCE_GROUPS) {
      for (const def of group.preferences) {
        expect(seen.has(def.key), `${def.key} appears in two groups`).toBe(false);
        seen.set(def.key, group.id);
      }
    }
    // Each group is its own form. A handler that iterated every preference
    // instead of the submitted group's would read the other group's unticked
    // boxes as "off" and quietly turn them off.
    expect([...seen.keys()].sort()).toEqual(ALL_PREFERENCES.map((p) => p.key).sort());
  });

  it('gives every group a distinct id to submit under', () => {
    const ids = PREFERENCE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a list opens showing everything', () => {
  /**
   * The practice's decision of 1 September 2026: no list narrows itself before
   * anybody has asked it to.
   *
   * This is a guard against a quiet regression rather than a statement of
   * taste. A default that hides part of a list is invisible by construction —
   * the rows that are missing are exactly the ones nobody sees — so it can be
   * reintroduced in a refactor and go unnoticed for months. The filter is one
   * click away; choosing to narrow is safe, being narrowed without knowing is
   * not.
   */
  const defaultOf = (key: string) =>
    PREFERENCE_GROUPS.flatMap((g) => g.preferences).find((p) => p.key === key)?.default;

  it('opens Clients on everyone', () => {
    expect(defaultOf('pref.clients_view')).toBe('all');
  });

  it('opens Cases on every matter, not only the open ones', () => {
    expect(defaultOf('pref.cases_scope')).toBe('all');
  });

  it('opens Tasks on everybody’s tasks, not only mine', () => {
    // Stored as a boolean meaning "only mine", so unfiltered is false.
    expect(defaultOf('pref.tasks_mine')).toBe('false');
  });
});
