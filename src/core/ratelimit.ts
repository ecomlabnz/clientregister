/**
 * Fixed-window rate limiting on KV.
 *
 * KV is eventually consistent, so this is a speed bump rather than a hard
 * quota — which is the right shape for login throttling, where the durable
 * per-account lockout in `users.failed_logins` is the real control.
 */

import type { Env } from '../types';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(
  env: Env,
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const kvKey = `rl:${bucket}:${key}:${window}`;
  const current = Number((await env.SESSIONS.get(kvKey)) ?? '0');
  const next = current + 1;

  if (next > limit) {
    const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
    return { ok: false, remaining: 0, retryAfterSeconds: windowSeconds - elapsed };
  }

  await env.SESSIONS.put(kvKey, String(next), { expirationTtl: Math.max(60, windowSeconds) });
  return { ok: true, remaining: limit - next, retryAfterSeconds: 0 };
}
