/**
 * Session handling.
 *
 * The cookie carries a 256-bit random token. What is *stored* — both in KV and
 * in D1 — is only its SHA-256. A dump of either store therefore yields no
 * usable session. KV holds the live session (and expires it on its own); D1
 * holds the durable record so sessions can be listed and revoked.
 */

import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext, Env, SessionData, User } from '../types';
import { randomToken, newId } from './ids';
import { sha256Hex } from './crypto';
import { all, nowIso, run } from './db';
import { clientIp } from './audit';

export const SESSION_COOKIE = '__Host-cr_session';

/** Hard cap on session lifetime, regardless of activity. */
const ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
/** Sessions idle longer than this are dropped. */
const IDLE_TTL_MS = 4 * 60 * 60 * 1000;
/** Don't rewrite KV/D1 on every request; only after this much drift. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

interface StoredSession extends SessionData {
  lastSeenAt: number;
}

const kvKey = (sid: string) => `sess:${sid}`;

export async function createSession(
  env: Env,
  user: User,
  req: Request,
  opts: { verified: boolean },
): Promise<string> {
  const token = randomToken(32);
  const sid = await sha256Hex(token);
  const now = Date.now();
  const data: StoredSession = {
    sid,
    userId: user.id,
    csrf: randomToken(24),
    createdAt: now,
    expiresAt: now + ABSOLUTE_TTL_MS,
    verified: opts.verified,
    lastSeenAt: now,
  };

  await env.SESSIONS.put(kvKey(sid), JSON.stringify(data), {
    expirationTtl: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
  await run(
    env.DB,
    `INSERT INTO session_records (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    sid,
    user.id,
    nowIso(),
    nowIso(),
    new Date(data.expiresAt).toISOString(),
    clientIp(req),
    (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
  );
  return token;
}

export async function readSession(env: Env, token: string): Promise<SessionData | null> {
  if (!token || token.length < 20) return null;
  const sid = await sha256Hex(token);
  const raw = await env.SESSIONS.get(kvKey(sid));
  if (!raw) return null;

  let data: StoredSession;
  try {
    data = JSON.parse(raw) as StoredSession;
  } catch {
    await env.SESSIONS.delete(kvKey(sid));
    return null;
  }

  const now = Date.now();
  if (now >= data.expiresAt || now - data.lastSeenAt > IDLE_TTL_MS) {
    await destroySessionBySid(env, sid);
    return null;
  }

  if (now - data.lastSeenAt > TOUCH_INTERVAL_MS) {
    data.lastSeenAt = now;
    const remaining = Math.max(60, Math.floor((data.expiresAt - now) / 1000));
    await env.SESSIONS.put(kvKey(sid), JSON.stringify(data), { expirationTtl: remaining });
    await run(env.DB, 'UPDATE session_records SET last_seen_at = ? WHERE id = ?', nowIso(), sid);
  }
  return data;
}

/** Persist a mutated session (e.g. after passing the TOTP challenge). */
export async function saveSession(env: Env, data: SessionData): Promise<void> {
  const raw = await env.SESSIONS.get(kvKey(data.sid));
  const existing: Partial<StoredSession> = raw ? JSON.parse(raw) : {};
  const merged: StoredSession = { ...data, lastSeenAt: existing.lastSeenAt ?? Date.now() };
  const remaining = Math.max(60, Math.floor((data.expiresAt - Date.now()) / 1000));
  await env.SESSIONS.put(kvKey(data.sid), JSON.stringify(merged), { expirationTtl: remaining });
}

export async function destroySessionBySid(env: Env, sid: string): Promise<void> {
  await env.SESSIONS.delete(kvKey(sid));
  await run(env.DB, 'UPDATE session_records SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', nowIso(), sid);
}

/** Sign every session of a user out — used on password change and suspension. */
export async function revokeAllSessions(env: Env, userId: string, exceptSid?: string): Promise<number> {
  const rows = await all<{ id: string }>(
    env.DB,
    'SELECT id FROM session_records WHERE user_id = ? AND revoked_at IS NULL',
    userId,
  );
  let n = 0;
  for (const row of rows) {
    if (exceptSid && row.id === exceptSid) continue;
    await destroySessionBySid(env, row.id);
    n++;
  }
  return n;
}

export function setSessionCookie(c: Context<AppContext>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

export function clearSessionCookie(c: Context<AppContext>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

export function sessionTokenFrom(c: Context<AppContext>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

/** Session id is a hash, so it is safe to show a short prefix in the UI. */
export function sessionLabel(sid: string): string {
  return sid.slice(0, 8);
}
