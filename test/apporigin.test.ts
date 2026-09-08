/**
 * The address the register puts in its own emails.
 *
 * `APP_ORIGIN` is the only place the register knows what it is called from
 * outside. Every automation link — "a deadline is due, open it here" — is built
 * from it, and nothing else in the application can work it out: a scheduled run
 * has no request to read a hostname from.
 *
 * It was `clientregister.workers.dev` until 8 September 2026, when the practice
 * put the register on `app.immigration.kiwi`. The workers.dev name still
 * answers and is deliberately kept as the way back in if the domain ever
 * breaks; what changed is which address a reminder sends somebody to.
 *
 * Two things are worth holding, because both fail silently: a link built from
 * an empty setting is a link to nowhere, and a link built over http is a
 * session token in the clear.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** The vars block as wrangler will read it, comments and all. */
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const appOrigin = wrangler.match(/"APP_ORIGIN":\s*"([^"]*)"/)?.[1] ?? '';

describe('the address in outbound links', () => {
  it('is set at all', () => {
    // `env.APP_ORIGIN ?? ''` is the fallback in src/index.ts, so an unset value
    // does not fail — it produces "/cases/abc" with nothing in front of it.
    expect(appOrigin, 'APP_ORIGIN is not set in wrangler.jsonc').not.toBe('');
  });

  it('is https, with no trailing slash to double up on the path', () => {
    expect(appOrigin).toMatch(/^https:\/\//);
    expect(appOrigin.endsWith('/'), 'a trailing slash makes every link //cases/…')
      .toBe(false);
  });

  it('is the practice’s own address', () => {
    // Not merely "not workers.dev": that would pass on any typo. This is the
    // address the practice signs in on, and a link that does not match it is a
    // link somebody has to think about before pressing.
    expect(appOrigin).toBe('https://app.immigration.kiwi');
  });

  it('is what the scheduled run actually hands to the automations', () => {
    // The value is only useful if the housekeeping pass reads it. A rename in
    // src/index.ts would leave this file correct and every link empty.
    const index = readFileSync('src/index.ts', 'utf8');
    expect(index).toMatch(/origin:\s*env\.APP_ORIGIN/);
  });
});
