/**
 * Transport and browser-side hardening applied to every response, plus the
 * cross-site request checks applied to every state-changing request.
 */

import type { Context, Next } from 'hono';
import type { AppContext } from '../types';
import { randomToken } from './ids';
import { timingSafeEqualStr } from './crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function securityHeaders(c: Context<AppContext>, next: Next): Promise<void> {
  const nonce = randomToken(16);
  c.set('nonce', nonce);
  c.set('requestId', crypto.randomUUID());

  await next();

  const h = c.res.headers;
  // No inline script, no third-party anything, no framing. The UI ships its
  // own CSS and JS from the same origin; there are no CDN dependencies.
  //
  // A route that has already set its own policy keeps it. Only the two file
  // downloads do — a client's document and an article's attachment — and both
  // set the tightest policy there is (`default-src 'none'; sandbox`), because
  // what they hand back came from outside. Setting this unconditionally was
  // quietly replacing that with the *page* policy, which permits same-origin
  // script, on a response whose whole point is that it is not a page of ours.
  // Found on 4 September 2026 while adding the second of the two.
  if (!h.has('Content-Security-Policy')) h.set(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  );
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'same-origin');
  h.set('X-Frame-Options', 'DENY');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  h.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Client files are a register of real people; never let a proxy hold them.
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store, private');
  h.set('X-Request-Id', c.get('requestId'));
}

/**
 * Cross-site request forgery defence, belt and braces:
 *  1. `Origin` must match this deployment (or `Sec-Fetch-Site` must be same-origin).
 *  2. The form must carry the session's CSRF token.
 * Webhook and API routes opt out via `skipPaths` — they authenticate by
 * signature instead, and carry no ambient cookie authority.
 */
export function csrfProtection(skipPaths: string[] = []) {
  return async (c: Context<AppContext>, next: Next): Promise<Response | void> => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const path = new URL(c.req.url).pathname;
    if (skipPaths.some((p) => path === p || path.startsWith(`${p}/`))) return next();

    const requestOrigin = new URL(c.req.url).origin;
    const origin = c.req.header('origin');
    const fetchSite = c.req.header('sec-fetch-site');
    const originOk =
      (origin && origin === requestOrigin) ||
      (!origin && (fetchSite === 'same-origin' || fetchSite === 'none'));
    if (!originOk) {
      return c.text('Cross-origin request rejected', 403);
    }

    // Pre-session forms (sign-in, first-run setup) are protected by the origin
    // check above; there is no session yet to hold a token.
    const session = c.get('session');
    if (!session) return next();

    const contentType = c.req.header('content-type') ?? '';
    let token = '';
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const body = await c.req.raw.clone().formData();
      token = String(body.get('_csrf') ?? '');
    } else {
      token = c.req.header('x-csrf-token') ?? '';
    }

    if (!token || !timingSafeEqualStr(token, session.csrf)) {
      return c.text('Invalid or missing CSRF token', 403);
    }
    return next();
  };
}
