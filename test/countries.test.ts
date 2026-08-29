import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { COUNTRIES, COUNTRY_NAMES, countryCodeFor, countryName, countryOptions } from '../src/core/countries';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Nationality is an ISO 3166-1 alpha-2 code, and the database refuses anything
 * else.
 *
 * It used to be a text box, which meant "Vietnam", "Viet Nam", "VN" and
 * "Vietnamese" were four different nationalities and none of them could be
 * counted. The list lives in `src/core/countries.ts`; the migration is
 * generated from it. These check the two never drift apart, and that the
 * guarantee is the database's rather than the form's.
 */

function schema() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return db;
}

describe('the list itself', () => {
  it('holds every officially assigned code', () => {
    // 249 at the time of writing. A number rather than a range, so that adding
    // or losing one is a decision somebody makes rather than a thing that
    // happens.
    expect(COUNTRIES).toHaveLength(249);
  });

  it('has no duplicate code or name', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(COUNTRIES.length);
  });

  it('uses two upper-case letters for every code', () => {
    for (const c of COUNTRIES) expect(`${c.name}: ${c.code}`).toMatch(/: [A-Z]{2}$/);
  });

  it('writes names in plain English letters, as the client names are', () => {
    // These get copied onto INZ forms. A curly apostrophe or a diacritic that
    // survives here is one that has to be cleaned up by hand there.
    for (const c of COUNTRIES) expect(c.name).toMatch(/^[\x20-\x7e]+$/);
  });

  it('reads alphabetically, because that is how a dropdown is used', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('names the ones an adviser would otherwise have to hunt for', () => {
    // The runtime's own names are used, except where CLDR writes something
    // nobody would look under.
    expect(COUNTRY_NAMES.HK).toBe('Hong Kong');
    expect(COUNTRY_NAMES.MM).toBe('Myanmar');
    expect(COUNTRY_NAMES.PS).toBe('Palestine');
    expect(COUNTRY_NAMES.CD).toBe('Democratic Republic of the Congo');
    expect(COUNTRY_NAMES.VN).toBe('Vietnam');
    expect(COUNTRY_NAMES.KR).toBe('South Korea');
    expect(COUNTRY_NAMES.WS).toBe('Samoa');
  });
});

describe('the migration is generated from the list', () => {
  it('loads exactly the same countries into the table', () => {
    // Two sources of truth for the same list is how a dropdown ends up
    // offering a country the database then refuses.
    const db = schema();
    const rows = db.prepare('SELECT code, name FROM countries ORDER BY name')
      .all() as Array<{ code: string; name: string }>;
    expect(rows).toEqual(COUNTRIES.map((c) => ({ code: c.code, name: c.name })));
  });
});

describe('the database owns the column', () => {
  it('refuses a nationality that is not a country', () => {
    // A guarantee in the route that happens to write the row lasts until
    // somebody adds a second route. Attacked directly, which is the only way
    // to know it holds.
    const db = schema();
    const add = (nat: string | null) =>
      db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, nationality,
                                       created_at, updated_at)
                  VALUES (?, ?, 'individual', 'A PERSON', 'active', ?, 'x', 'x')`)
        .run(`c${Math.random()}`, `CL-${Math.random()}`, nat);

    expect(() => add('ZZ')).toThrow(/ISO 3166-1/);
    // The country's name is not a country code, however obviously it means one.
    expect(() => add('Vietnam')).toThrow(/ISO 3166-1/);
    expect(() => add('vn')).toThrow(/ISO 3166-1/);
    expect(() => add('VN')).not.toThrow();
    // Blank is always allowed. Not knowing is a real state.
    expect(() => add(null)).not.toThrow();
  });

  it('refuses one written in by an update, too', () => {
    const db = schema();
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, nationality,
                                     created_at, updated_at)
                VALUES ('c1', 'CL-1', 'individual', 'A PERSON', 'active', 'VN', 'x', 'x')`).run();
    expect(() => db.prepare(`UPDATE clients SET nationality = 'Vietnam' WHERE id = 'c1'`).run())
      .toThrow(/ISO 3166-1/);
    const after = db.prepare(`SELECT nationality FROM clients WHERE id = 'c1'`)
      .all() as Array<{ nationality: string }>;
    expect(after[0]!.nationality).toBe('VN');
  });
});

describe('reading a nationality out of what somebody wrote', () => {
  it('takes the code itself', () => {
    expect(countryCodeFor('NZ')).toBe('NZ');
    expect(countryCodeFor('nz')).toBe('NZ');
  });

  it('takes the country name', () => {
    expect(countryCodeFor('Vietnam')).toBe('VN');
    expect(countryCodeFor('  south korea ')).toBe('KR');
  });

  it('takes the variants people actually write', () => {
    expect(countryCodeFor('UK')).toBe('GB');
    expect(countryCodeFor('England')).toBe('GB');
    expect(countryCodeFor('USA')).toBe('US');
    expect(countryCodeFor('Holland')).toBe('NL');
    expect(countryCodeFor('Viet Nam')).toBe('VN');
    expect(countryCodeFor('Burma')).toBe('MM');
    expect(countryCodeFor('Czech Republic')).toBe('CZ');
  });

  it('takes the demonyms this caseload arrives under', () => {
    expect(countryCodeFor('Vietnamese')).toBe('VN');
    expect(countryCodeFor('Filipino')).toBe('PH');
    expect(countryCodeFor('Samoan')).toBe('WS');
    expect(countryCodeFor('Sri Lankan')).toBe('LK');
  });

  it('gives up rather than guessing', () => {
    // Better an empty field somebody fills in than a confident guess at
    // another person's nationality.
    expect(countryCodeFor('Freedonia')).toBeNull();
    expect(countryCodeFor('probably Indian?')).toBeNull();
    expect(countryCodeFor('')).toBeNull();
    expect(countryCodeFor(null)).toBeNull();
  });
});

describe('showing it back', () => {
  it('shows the name, never the code', () => {
    expect(countryName('VN')).toBe('Vietnam');
    expect(countryName(null)).toBe('');
    // A code we do not know is shown as itself rather than swallowed — if one
    // ever appears, it should be visible.
    expect(countryName('ZZ')).toBe('ZZ');
  });

  it('offers every country to a dropdown', () => {
    const options = countryOptions();
    expect(options).toHaveLength(COUNTRIES.length);
    expect(options[0]).toEqual({ value: 'AF', label: 'Afghanistan' });
  });
});
