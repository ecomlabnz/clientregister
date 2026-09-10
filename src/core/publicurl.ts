/**
 * The address the practice's clients see.
 *
 * **Reported on 10 September 2026:** *"the links we are sending to clients —
 * quotes, invoices, anything — should not be exposing our internal worker
 * domain - i noticed it was visible somewhere."*
 *
 * They were. Every client-facing link is built on a base address, and that base
 * came from one of two places: the public web address the practice has set, or
 * — when they have not set one — whatever host the request arrived on. In
 * production that host is the Worker's own `*.workers.dev` name, so a fee quote
 * emailed to a client carried it.
 *
 * ## What this file changes, and what it cannot
 *
 * It cannot invent a domain. A link is only reachable at an address that
 * actually routes to this Worker, so setting the public web address to a domain
 * that has not been pointed here would replace an ugly link with a dead one,
 * which is worse. Pointing a domain at the Worker is a Cloudflare step somebody
 * has to take.
 *
 * What it changes is that the fallback stops being silent. `publicBase` says
 * whether it is using the practice's address or falling back, so every screen
 * that shows or sends a client link can say so plainly before it goes out. The
 * fault was never that the fallback existed — it is a sensible fallback, and it
 * is what makes the register work on a fresh deployment. The fault was that
 * nobody was told which address was about to be emailed to a client.
 */

import type { Env } from '../types';
import { getSetting } from './db';

/**
 * A configured address, or the one the request came in on.
 *
 * Anything that is not plainly `scheme://host` is ignored rather than patched
 * up: a half-typed address in a settings box must not become half a link in a
 * client's email.
 */
export function canonicalBaseFrom(configured: string, requestOrigin: string): string {
  const trimmed = configured.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(trimmed) ? trimmed : requestOrigin;
}

export interface PublicBase {
  /** What to build client-facing links on. */
  base: string;
  /**
   * True when no public web address is set, so `base` is the host this request
   * happened to arrive on — in production, the Worker's own name.
   */
  usingFallback: boolean;
}

export async function publicBase(env: Env, requestOrigin: string): Promise<PublicBase> {
  const configured = await getSetting(env, 'website.canonical_url', '');
  const base = canonicalBaseFrom(configured, requestOrigin);
  return { base, usingFallback: base === requestOrigin && base !== configured.trim().replace(/\/+$/, '') };
}

/**
 * The sentence shown wherever a client link is about to be handed out, or null
 * when the practice's own address is in use.
 *
 * Written to be acted on rather than dismissed: it says what the client will
 * see, and where to change it.
 */
export function fallbackWarning(state: PublicBase): string | null {
  if (!state.usingFallback) return null;
  return `This link uses ${state.base}, which is the register's own address rather than `
       + 'the practice’s. Set a public web address under Settings → Website, once a '
       + 'domain has been pointed at the register, and every link written afterwards uses it.';
}
