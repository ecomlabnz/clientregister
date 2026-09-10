/**
 * The address a client's link is built on.
 *
 * **Reported on 10 September 2026:** *"the links we are sending to clients —
 * quotes, invoices, anything — should not be exposing our internal worker
 * domain - i noticed it was visible somewhere."*
 *
 * They were, and they still will be until a domain is pointed at the register:
 * a link is only reachable at an address that routes here, so the register
 * cannot invent one. What it can do — and what these tests hold — is stop the
 * fallback being silent, so nobody emails the workers.dev address without
 * having been told that is what they are about to do.
 */

import { describe, expect, it } from 'vitest';
import { canonicalBaseFrom, fallbackWarning, type PublicBase } from '../src/core/publicurl';

const ORIGIN = 'https://clientregister.example.workers.dev';

describe('choosing the base address', () => {
  it('prefers the address the practice set', () => {
    expect(canonicalBaseFrom('https://thelawfirm.example', ORIGIN)).toBe('https://thelawfirm.example');
  });

  it('drops a trailing slash so links do not double up', () => {
    expect(canonicalBaseFrom('https://thelawfirm.example/', ORIGIN)).toBe('https://thelawfirm.example');
  });

  it('falls back when nothing is set', () => {
    expect(canonicalBaseFrom('', ORIGIN)).toBe(ORIGIN);
  });

  it('ignores a half-typed address rather than patching it up', () => {
    // Half an address in a settings box must not become half a link in a
    // client's email — the fallback is wrong but reachable, which is better.
    for (const bad of ['thelawfirm.example', 'https://', 'https://a b', 'https://x.test/path']) {
      expect(canonicalBaseFrom(bad, ORIGIN), bad).toBe(ORIGIN);
    }
  });
});

describe('saying so before the link goes out', () => {
  const state = (usingFallback: boolean): PublicBase => ({ base: ORIGIN, usingFallback });

  it('warns while the register is using its own address', () => {
    const warning = fallbackWarning(state(true));
    expect(warning).toContain(ORIGIN);
    expect(warning).toContain('Settings');
  });

  it('says nothing once the practice has its own', () => {
    expect(fallbackWarning(state(false))).toBeNull();
  });
});
