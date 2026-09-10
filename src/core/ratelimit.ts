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
  return rateLimitBy(env, bucket, key, 1, limit, windowSeconds);
}

/**
 * The same window, counting something other than requests.
 *
 * A shortcut upload has two costs and only one of them is the request: twenty
 * requests an hour is a sensible allowance and twenty requests carrying 25 MB
 * each is not. So bytes are counted in a bucket of their own, with the same
 * fixed window, rather than a second mechanism being invented for it.
 *
 * `amount` is added before the test as well as after it, so a single item
 * larger than the whole allowance is refused rather than let through once.
 */
export async function rateLimitBy(
  env: Env,
  bucket: string,
  key: string,
  amount: number,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const kvKey = `rl:${bucket}:${key}:${window}`;
  const current = Number((await env.SESSIONS.get(kvKey)) ?? '0');
  const next = current + amount;

  if (next > limit) {
    const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
    return { ok: false, remaining: 0, retryAfterSeconds: windowSeconds - elapsed };
  }

  await env.SESSIONS.put(kvKey, String(next), { expirationTtl: Math.max(60, windowSeconds) });
  return { ok: true, remaining: limit - next, retryAfterSeconds: 0 };
}

/**
 * Ask whether a bucket is already full, without putting anything in it.
 *
 * For a limit that counts *failures*: the shortcut endpoint refuses a bad token
 * and counts that refusal, but a practice sending its files all morning must
 * not spend the same allowance. So the counter is read at the door and written
 * only when something is actually refused.
 */
export async function rateLimitPeek(
  env: Env,
  bucket: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const current = Number((await env.SESSIONS.get(`rl:${bucket}:${key}:${window}`)) ?? '0');
  if (current >= limit) {
    const elapsed = Math.floor(Date.now() / 1000) % windowSeconds;
    return { ok: false, remaining: 0, retryAfterSeconds: windowSeconds - elapsed };
  }
  return { ok: true, remaining: limit - current, retryAfterSeconds: 0 };
}
