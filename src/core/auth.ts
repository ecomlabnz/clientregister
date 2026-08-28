/**
 * Authentication middleware and the sign-in state machine.
 *
 * Sign-in is deliberately two-phase: the password creates an *unverified*
 * session, and TOTP (when enabled) promotes it. An unverified session can
 * reach nothing but the challenge and sign-out routes.
 */

import type { Context, Next } from 'hono';
import type { AppContext, Env, User } from '../types';
import { getBoolSetting, one, nowIso, run } from './db';
import { hashPassword, PASSWORD_HASH_PARAMS, passwordNeedsRehash, verifyPassword } from './crypto';
import { readSession, sessionTokenFrom } from './session';
import { can, type Permission } from './rbac';

interface UserRow extends User {
  password_hash: string;
  failed_logins: number;
  locked_until: string | null;
  totp_secret: string | null;
}

const LOCKOUT_THRESHOLD = 5;
const MAX_LOCKOUT_MINUTES = 30;

export async function attachSession(c: Context<AppContext>, next: Next): Promise<void> {
  c.set('user', null);
  c.set('session', null);

  const token = sessionTokenFrom(c);
  if (token) {
    const session = await readSession(c.env, token);
    if (session) {
      const row = await one<User>(
        c.env.DB,
        'SELECT id, email, name, role, status, totp_enabled, theme, colour_mode FROM users WHERE id = ?',
        session.userId,
      );
      if (row && row.status === 'active') {
        c.set('session', session);
        c.set('user', row);
      }
    }
  }
  await next();
}

/** Require a fully signed-in (password + 2FA where enabled) user. */
export async function requireAuth(c: Context<AppContext>, next: Next): Promise<Response | void> {
  const session = c.get('session');
  const user = c.get('user');
  if (!session || !user) {
    const url = new URL(c.req.url);
    const next_ = encodeURIComponent(url.pathname + url.search);
    return c.redirect(`/login?next=${next_}`, 302);
  }
  if (!session.verified) return c.redirect('/login/verify', 302);
  return next();
}

export function requirePermission(permission: Permission) {
  return async (c: Context<AppContext>, next: Next): Promise<Response | void> => {
    if (!can(c.get('user'), permission)) {
      return c.html(
        '<h1>403 — not permitted</h1><p>Your role does not allow this action.</p><p><a href="/">Back</a></p>',
        403,
      );
    }
    return next();
  };
}

export type LoginResult =
  | { ok: true; user: User; needsTotp: boolean }
  | { ok: false; reason: 'invalid' | 'locked' | 'suspended'; retryAfterMinutes?: number };

/**
 * Verify an email/password pair.
 *
 * A password check is always performed, even for unknown accounts, so response
 * timing does not reveal which addresses exist.
 */
export async function authenticate(env: Env, email: string, password: string): Promise<LoginResult> {
  const row = await one<UserRow>(
    env.DB,
    `SELECT id, email, name, role, status, totp_enabled, theme, colour_mode,
            password_hash, failed_logins, locked_until, totp_secret
       FROM users WHERE email = ?`,
    email.trim().toLowerCase(),
  );

  if (!row) {
    // Constant-ish work for unknown users.
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
    return { ok: false, reason: 'locked', retryAfterMinutes: mins };
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    const failed = row.failed_logins + 1;
    let lockedUntil: string | null = null;
    if (failed >= LOCKOUT_THRESHOLD) {
      const minutes = Math.min(MAX_LOCKOUT_MINUTES, 2 ** (failed - LOCKOUT_THRESHOLD) * 2);
      lockedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    }
    await run(env.DB, 'UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?',
      failed, lockedUntil, nowIso(), row.id);
    return { ok: false, reason: 'invalid' };
  }

  if (row.status !== 'active') return { ok: false, reason: 'suspended' };

  if (passwordNeedsRehash(row.password_hash)) {
    const rehashed = await hashPassword(password);
    await run(env.DB, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', rehashed, nowIso(), row.id);
  }

  await run(
    env.DB,
    'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
    nowIso(), nowIso(), row.id,
  );

  const user: User = {
    id: row.id, email: row.email, name: row.name,
    role: row.role, status: row.status, totp_enabled: row.totp_enabled,
    theme: row.theme, colour_mode: row.colour_mode,
  };
  return { ok: true, user, needsTotp: row.totp_enabled === 1 && !!row.totp_secret };
}

/**
 * A syntactically valid hash that no password matches, used to keep the work
 * done for an unknown email indistinguishable from the work done for a real
 * one. Its cost parameters must stay in step with `hashPassword`, or the
 * timing difference it exists to hide reappears.
 */
const DUMMY_HASH = `pbkdf2-sha256$${PASSWORD_HASH_PARAMS.rounds}x${PASSWORD_HASH_PARAMS.iterations}$` +
  'AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Minimum viable password policy: length beats composition rules.
 *
 * The floor is a constant, not a setting — the configurable minimum can be
 * raised above it but never lowered below it, so no administrator can weaken
 * the policy past what the application considers safe.
 */
export const PASSWORD_MIN_LENGTH_FLOOR = 12;

export function validatePassword(password: string, minLength = PASSWORD_MIN_LENGTH_FLOOR): string | null {
  const min = Math.max(PASSWORD_MIN_LENGTH_FLOOR, minLength);
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (password.length > 256) return 'Password must be 256 characters or fewer.';
  if (/^(.)\1+$/.test(password)) return 'Password must not be a single repeated character.';
  return null;
}

/**
 * Enforce the two-factor requirement, once an administrator has switched it on.
 *
 * A user without it can still reach their account pages and sign out — being
 * told to enable two-factor must not lock someone out of the screen where they
 * enable it.
 */
export function requireTwoFactorWhenPolicyDemands() {
  const EXEMPT = ['/account/2fa', '/account/password', '/logout', '/help'];

  return async (c: Context<AppContext>, next: Next): Promise<Response | void> => {
    const user = c.get('user');
    if (!user || user.totp_enabled === 1) return next();

    const path = new URL(c.req.url).pathname;
    if (EXEMPT.some((p) => path === p || path.startsWith(`${p}/`))) return next();

    const required = await getBoolSetting(c.env, 'security.require_two_factor', false);
    if (!required) return next();

    return c.redirect(
      '/account/2fa?err=' + encodeURIComponent(
        'Two-factor authentication is required for everyone in this practice. Set it up to continue.'),
      302,
    );
  };
}
