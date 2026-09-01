/**
 * Every route a module writes down must actually be registered.
 *
 * The fee-line save, status and delete routes were defined but unreachable for
 * an unknown time: the handler above them was missing its closing `});`, so all
 * three sat *inside* another route's callback. That is valid JavaScript, so it
 * compiled; it is valid TypeScript, so it type-checked; and no test touched
 * those three routes, so the suite stayed green. Saving a fee line returned
 * "Not found" and the register gave no other clue.
 *
 * This compares what each module's source *says* it registers against what the
 * built application actually has. It cannot be fooled by nesting, because a
 * nested route never reaches the router.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createApp } from '../src/app';

/** Routes as written in a module's source, with the prefix it mounts under. */
function declaredIn(file: string): Set<string> {
  const src = readFileSync(file, 'utf8');
  // A module builds one or more sub-routers and mounts each at a prefix.
  const mounts = new Map<string, string>();
  for (const m of src.matchAll(/app\.route\('([^']*)',\s*(\w+)\)/g)) mounts.set(m[2]!, m[1]!);

  const out = new Set<string>();
  // `r.get('/path'` / `app.post('/path'` — a real path always starts with a slash.
  for (const m of src.matchAll(/\b(\w+)\.(get|post)\(\s*'(\/[^']*)'/g)) {
    const holder = m[1]!, verb = m[2]!, path = m[3]!;
    const prefix = mounts.get(holder) ?? '';
    const full = ((prefix === '/' ? '' : prefix) + path).replace(/\/$/, '') || '/';
    out.add(`${verb.toUpperCase()} ${full}`);
  }
  return out;
}

describe('every route a module declares is reachable', () => {
  const app = createApp() as any;
  const registered = new Set<string>(
    app.routes.map((r: any) => `${String(r.method).toUpperCase()} ${r.path}`),
  );

  // Every module directory that actually has an index.ts to read.
  const files = readdirSync('src/modules')
    .filter((name) => {
      try { return readdirSync(`src/modules/${name}`).includes('index.ts'); }
      catch { return false; }
    })
    .map((name) => `src/modules/${name}/index.ts`);

  it('finds the modules', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const mod = file.split('/')[2]!;
    it(`${mod}: nothing declared is missing from the router`, () => {
      const declared = [...declaredIn(file)];
      const missing = declared.filter((d) => !registered.has(d));
      expect(missing, `declared but not registered:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
  }
});
