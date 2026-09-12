/**
 * The machine that does not have to be asked for the six-digit code.
 *
 * **Asked for on 12 September 2026:** *"allow for 40 days of authentication
 * memory on a machine, not every time. it is annoying. so the machine should
 * become trusted and only reset on the 41st day"*
 *
 * ## What trusting a machine does, and the four things it does not
 *
 * It stands in for the **second factor, and for nothing else**:
 *
 *  1. The **password is still required**, every single sign-in. A trusted
 *     machine with no password gets nowhere at all.
 *  2. It **never restores a session**. Signing out signs you out; coming back
 *     means signing in again, with the password, and only the code is skipped.
 *  3. It **never lengthens a session**. Twelve hours absolute and four idle,
 *     exactly as before.
 *  4. It **never weakens the rate limiter or the lockout**. Both run before a
 *     password is checked, and the trust is not consulted until after one has
 *     been accepted.
 *
 * ## Absolute, not sliding
 *
 * The practice said *"only reset on the 41st day"*. So the deadline is set once,
 * when the code was typed, and using the machine does not push it out — a
 * sliding window on a machine somebody opens every morning never expires at
 * all. The database refuses to move `expires_at` (migration 0093), so this is a
 * guarantee rather than an intention.
 *
 * ## The shape of the credential
 *
 *     rt_  QxfP2n9wKb4T  8s...43 characters...
 *     └┬┘  └─────┬────┘  └──────────┬───────┘
 *   prefix    selector            secret
 *
 * The same two-part shape as an upload token (`core/uploadtokens.ts`), for the
 * same reasons: the **selector** is in the clear so one row can be found in one
 * read, and carries no authority; the **secret** is 32 random bytes held only
 * as a PBKDF2 hash, so a dump of the database yields nothing that opens
 * anything. One verification is always performed, against a dummy hash when
 * there is no row, so an unknown selector costs the same work as a real one.
 *
 * ## Checked where it is spent — fault 43
 *
 * *"A bearer credential outlives the decision that allowed it, so the permission
 * is checked where it is spent, not only where it is issued."* This cookie sits
 * on a laptop for forty days, through a suspension, a demotion, a password
 * change and a two-factor reset that nobody re-runs it against. So every one of
 * those is asked again, from the database, at the moment it is presented:
 *
 *  - the row exists, is not revoked, and its deadline has not passed — read
 *    from the row, never from the cookie's own lifetime, which is a hint to a
 *    browser and not a fact about anything;
 *  - the person is still `active`;
 *  - the person still has two-factor switched on;
 *  - and the authenticator is still **the same one**. `totp_fingerprint` is a
 *    SHA-256 of the TOTP secret the trust was granted under. Turn two-factor
 *    off and on again and the secret changes, so every machine trusted under
 *    the old one is dead on the spot — with nothing to remember to revoke.
 *
 * The application also revokes these in all the places it should (a password
 * change, a suspension, a recovery code, two-factor being turned off or on).
 * The checks above are what holds when somebody later adds a second way to do
 * one of those things and forgets.
 */

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, Env } from '../types';
import { all, getSetting, nowIso, one, run } from './db';
import { newId, randomToken } from './ids';
import { hashPassword, PASSWORD_HASH_PARAMS, sha256Hex, timingSafeEqualStr, verifyPassword } from './crypto';
import { clientIp } from './audit';

/** `rt_` for "register trust", so one is recognisable if it is ever pasted somewhere. */
export const TRUSTED_DEVICE_PREFIX = 'rt_';

/**
 * `__Host-` so no other host and no subdomain can set it, `Lax` so it is not
 * sent from somebody else's page, `HttpOnly` so a script cannot read it.
 */
export const TRUST_COOKIE = '__Host-cr_trust';

/** What the practice asked for, and what the setting defaults to. */
export const TRUSTED_DEVICE_DEFAULT_DAYS = 40;

/**
 * The ceiling an administrator cannot raise, the way `PASSWORD_MIN_LENGTH_FLOOR`
 * is a floor they cannot lower. A setting may shorten the period or switch it
 * off; it may not set a second factor aside for ten years. Migration 0093 keeps
 * the same number as a refusal, so it holds against a row written by hand.
 */
export const TRUSTED_DEVICE_MAX_DAYS = 90;

/** 9 random bytes is exactly 12 base64url characters, with no padding. */
const SELECTOR_BYTES = 9;
export const SELECTOR_LENGTH = 12;

/** 32 random bytes is exactly 43 base64url characters. 256 bits, unguessable. */
const SECRET_BYTES = 32;
const SECRET_LENGTH = 43;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A syntactically valid hash that no secret matches, so an unknown selector
 * costs the same work as a known one. Its parameters must stay in step with
 * `hashPassword`, exactly as the twins of this line in `core/auth.ts` and
 * `core/uploadtokens.ts` must.
 */
const DUMMY_HASH = `pbkdf2-sha256$${PASSWORD_HASH_PARAMS.rounds}x${PASSWORD_HASH_PARAMS.iterations}$` +
  'AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export interface TrustedDeviceRow {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  uses: number;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
}

export type TrustedDeviceCheck =
  | { ok: true; id: string; userId: string }
  | { ok: false };

/**
 * How long a machine stays trusted, in days. `0` means the feature is off and
 * every sign-in asks for the code.
 *
 * Read from the setting and then clamped, so the number this returns is the
 * number that is used — nothing downstream has to remember the ceiling. A value
 * that is not a whole number of days reads as off rather than as the default,
 * because a setting nobody can parse should fail towards asking for the code.
 */
export async function trustedDeviceDays(env: Env): Promise<number> {
  const raw = (await getSetting(env, 'security.trusted_device_days', String(TRUSTED_DEVICE_DEFAULT_DAYS))).trim();
  if (!/^\d+$/.test(raw)) return 0;
  const days = Number(raw);
  if (days <= 0) return 0;
  return Math.min(days, TRUSTED_DEVICE_MAX_DAYS);
}

/** Split a presented credential into its two halves, or say it is not one. */
export function parseTrustToken(raw: string): { selector: string; secret: string } | null {
  const value = raw.trim();
  if (!value.startsWith(TRUSTED_DEVICE_PREFIX)) return null;
  const body = value.slice(TRUSTED_DEVICE_PREFIX.length);
  if (body.length !== SELECTOR_LENGTH + SECRET_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  return { selector: body.slice(0, SELECTOR_LENGTH), secret: body.slice(SELECTOR_LENGTH) };
}

/**
 * Remember this machine, and hand back the only copy of the credential that
 * will ever exist.
 *
 * `days` is whatever `trustedDeviceDays` returned, so it is already clamped;
 * the database holds the same ceiling regardless. The TOTP secret is not
 * stored — what is stored is a SHA-256 of it, which is enough to notice that it
 * has changed and not enough to produce a code.
 */
export async function createTrustedDevice(
  env: Env,
  opts: { userId: string; totpSecret: string; days: number; req?: Request },
): Promise<{ token: string; row: TrustedDeviceRow }> {
  const days = Math.min(Math.max(1, Math.floor(opts.days)), TRUSTED_DEVICE_MAX_DAYS);
  const selector = randomToken(SELECTOR_BYTES);
  const secret = randomToken(SECRET_BYTES);
  const id = newId('trd');
  /*
   * One reading of the clock, used for both ends.
   *
   * This was two — `nowIso()` and then `Date.now()` — and the milliseconds
   * between them made the life of the row *slightly longer* than the number of
   * days asked for. At any length but the ceiling nobody would ever know. At
   * exactly 90 days it put the row over the cap, and the database refused it:
   * ninety days plus three milliseconds is more than ninety days.
   *
   * It failed in CI minutes after passing on the same commit, because whether
   * the clock ticks between two statements depends on the machine and the
   * moment. Found on 12 September 2026 by a deploy going red.
   */
  const now = Date.now();
  const at = new Date(now).toISOString();
  const expiresAt = new Date(now + days * DAY_MS).toISOString();
  const ip = opts.req ? clientIp(opts.req) : null;
  const userAgent = opts.req ? ((opts.req.headers.get('user-agent') ?? '').slice(0, 300) || null) : null;

  await run(
    env.DB,
    `INSERT INTO trusted_devices
       (id, user_id, selector, secret_hash, totp_fingerprint, created_at, expires_at, uses, ip, user_agent)
     VALUES (?,?,?,?,?,?,?,0,?,?)`,
    id, opts.userId, selector, await hashPassword(secret), await sha256Hex(opts.totpSecret),
    at, expiresAt, ip, userAgent,
  );

  return {
    token: `${TRUSTED_DEVICE_PREFIX}${selector}${secret}`,
    row: {
      id, user_id: opts.userId, created_at: at, expires_at: expiresAt,
      last_used_at: null, uses: 0, revoked_at: null, ip, user_agent: userAgent,
    },
  };
}

/**
 * Decide whether a presented cookie still stands in for the code, and whose it
 * is.
 *
 * Says `{ ok: false }` for every kind of failure, having done the same work
 * either way. Nothing about *why* reaches the caller, because the sign-in page
 * says the same sentence regardless and a difference here would eventually
 * become a difference there.
 *
 * Note what is read fresh on every presentation rather than trusted from the
 * cookie: the deadline, the account's status, whether two-factor is still on,
 * and whether it is still the same authenticator. See the note at the top of
 * this file, and fault 43.
 */
export async function verifyTrustedDevice(env: Env, presented: string): Promise<TrustedDeviceCheck> {
  const parts = parseTrustToken(presented);

  const row = parts
    ? await one<{
        id: string; user_id: string; secret_hash: string; totp_fingerprint: string;
        revoked_at: string | null; expires_at: string;
        user_status: string | null; user_totp_enabled: number | null; user_totp_secret: string | null;
      }>(
        env.DB,
        `SELECT t.id, t.user_id, t.secret_hash, t.totp_fingerprint, t.revoked_at, t.expires_at,
                u.status AS user_status, u.totp_enabled AS user_totp_enabled,
                u.totp_secret AS user_totp_secret
           FROM trusted_devices t JOIN users u ON u.id = t.user_id
          WHERE t.selector = ?`,
        parts.selector)
    : null;

  // Always one verification, even with no row and even with no cookie at all,
  // so the work done — and therefore the time taken — is the same either way.
  const matches = await verifyPassword(parts?.secret ?? 'no machine was offered', row?.secret_hash ?? DUMMY_HASH);

  if (!parts || !row || !matches) return { ok: false };
  if (row.revoked_at) return { ok: false };

  // The deadline is the row's, never the cookie's. A browser that declines to
  // drop an expired cookie — or a copy of one lifted off a disk and replayed —
  // must not buy a single day past the date the code was typed plus the period.
  if (row.expires_at <= nowIso()) return { ok: false };

  if (row.user_status !== 'active') return { ok: false };

  // A trust granted under two-factor must not outlive two-factor. Both halves:
  // switched off at all, and switched off and on again under a new secret.
  if (row.user_totp_enabled !== 1 || !row.user_totp_secret) return { ok: false };
  if (!timingSafeEqualStr(await sha256Hex(row.user_totp_secret), row.totp_fingerprint)) return { ok: false };

  return { ok: true, id: row.id, userId: row.user_id };
}

/** Record that a machine stood in for the code, so an unused one is visible. */
export async function noteTrustedDeviceUsed(env: Env, id: string): Promise<void> {
  await run(
    env.DB,
    'UPDATE trusted_devices SET last_used_at = ?, uses = uses + 1 WHERE id = ?',
    nowIso(), id,
  );
}

/** Somebody's machines, newest first, live ones above dead ones. */
export async function trustedDevicesFor(env: Env, userId: string): Promise<TrustedDeviceRow[]> {
  return all<TrustedDeviceRow>(
    env.DB,
    `SELECT id, user_id, created_at, expires_at, last_used_at, uses, revoked_at, ip, user_agent
       FROM trusted_devices WHERE user_id = ?
      ORDER BY (revoked_at IS NOT NULL), created_at DESC`,
    userId);
}

/**
 * Forget one.
 *
 * Scoped to the owner in the statement itself rather than checked first, like
 * `revokeUploadToken`: a request naming somebody else's machine changes nothing
 * and reports the same "not found" as an id that never existed.
 */
export async function revokeTrustedDevice(
  env: Env, opts: { userId: string; id: string },
): Promise<boolean> {
  const result = await run(
    env.DB,
    'UPDATE trusted_devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    nowIso(), opts.id, opts.userId,
  );
  return Number((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

/**
 * Forget every machine one person has trusted, and say how many.
 *
 * Called beside `revokeAllSessions` at every point where the ground under a
 * second factor moves: the password changes, the account is suspended, an
 * administrator resets a password, two-factor is turned off or on again, or a
 * recovery code is used. A recovery code in particular means the authenticator
 * is gone — which is exactly when a machine that no longer needs it should stop
 * being one.
 */
export async function revokeAllTrustedDevices(env: Env, userId: string): Promise<number> {
  const result = await run(
    env.DB,
    'UPDATE trusted_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    nowIso(), userId,
  );
  return Number((result.meta as { changes?: number } | undefined)?.changes ?? 0);
}

export function setTrustCookie(c: Context<AppContext>, token: string, days: number): void {
  setCookie(c, TRUST_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: Math.floor(days * DAY_MS / 1000),
  });
}

export function clearTrustCookie(c: Context<AppContext>): void {
  deleteCookie(c, TRUST_COOKIE, { path: '/', secure: true });
}

export function trustTokenFrom(c: Context<AppContext>): string | undefined {
  return getCookie(c, TRUST_COOKIE);
}
