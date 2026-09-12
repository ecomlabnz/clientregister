/**
 * The six-digit code that arrives by email, for the sign-in where the phone is
 * not there.
 *
 * **Asked for on 12 September 2026:** *"build the email code as a fallback"* —
 * said after being told that of the three ways of doing this, a text message is
 * the weakest of them and the only one that costs money.
 *
 * ## A fallback, not an alternative
 *
 * The authenticator app stays the way in. This is a link on the challenge page
 * for the morning the phone is flat, lost or on the kitchen table, and somebody
 * who never loses their phone should never notice it exists.
 *
 * Three things follow from "fallback", and each is enforced rather than
 * intended:
 *
 *  1. **Only for an account that already has two-factor on.** With
 *     `totp_enabled` at 0 there is no challenge to pass, so there is no code to
 *     send. This must not become a way to have weak two-factor.
 *  2. **It goes to the address on the account and nowhere else.** There is no
 *     box to type a different address into, on any page, ever. A fallback that
 *     can be pointed somewhere else is a password reset with no password.
 *  3. **It is nothing on its own.** Like the six digits off an authenticator, it
 *     is presented by somebody who has already given the right password and
 *     holds an unverified session. It never restores a session and never
 *     creates one.
 *
 * ## The code, and why hashing six digits is still worth doing
 *
 * Six cryptographically random digits, stored only as a PBKDF2 hash, alive for
 * ten minutes, accepted once.
 *
 * Hashing six digits does not make them unguessable: a million candidates is a
 * minute of somebody's afternoon. That is not the job. The job is that the
 * register never **holds a working credential in the clear** — not in the
 * database, not in a console query, not in a backup archive — for the ten
 * minutes it is alive. What makes the code hard to guess *through the register*
 * is the rate limiter and the ten minutes, which is where that work belongs and
 * where it is done.
 *
 * ## Judged at the moment it is spent — fault 43
 *
 * *"A bearer credential outlives the decision that allowed it, so the permission
 * is checked where it is spent, not only where it is issued."* Ten minutes is
 * short, and an account can be suspended or have its two-factor turned off
 * inside it. So every condition is asked again, of the database, when the code
 * is presented: the row is unused, the deadline has not passed, the person is
 * still active, and they still have two-factor switched on. The same questions
 * `trusteddevices.ts` asks of a cookie forty days old.
 *
 * ## What it does *not* touch
 *
 * A machine trusted after passing by email code is a trusted machine like any
 * other, and its `totp_fingerprint` is still a hash of the **TOTP secret** —
 * the authenticator remains the thing trust is pinned to, so turning two-factor
 * off and on again still kills every machine. An email code grants no trust of
 * its own and creates no second kind.
 *
 * Unlike a recovery code, using one does **not** forget every trusted machine.
 * A recovery code is one of eight you printed and put in a drawer, so using one
 * says the authenticator is gone; asking for an email code says the phone is in
 * the other room. Treating the two the same would punish the ordinary case this
 * was built for.
 */

import type { Env } from '../types';
import { newId } from './ids';
import { nowIso, one, run } from './db';
import { hashPassword, PASSWORD_HASH_PARAMS, verifyPassword } from './crypto';
import { mailConfigured } from '../mail/provider';
import { queueEmail } from '../mail/queue';
import { clientIp } from './audit';

/** How long one lasts. The database holds the same ceiling (migration 0098). */
export const EMAIL_CODE_MINUTES = 10;

/** Six digits: what a person can read off a phone and type without a mistake. */
export const EMAIL_CODE_DIGITS = 6;

const MINUTE_MS = 60 * 1000;

/**
 * A syntactically valid hash that no code matches, so a person with no
 * outstanding code costs the same work as one with. Its parameters must stay in
 * step with `hashPassword`, exactly as the twins of this line in `core/auth.ts`,
 * `core/uploadtokens.ts` and `core/trusteddevices.ts` must.
 */
const DUMMY_HASH = `pbkdf2-sha256$${PASSWORD_HASH_PARAMS.rounds}x${PASSWORD_HASH_PARAMS.iterations}$` +
  'AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * Six digits from `crypto.getRandomValues`, with no modulo bias.
 *
 * `random % 1000000` is the obvious line and it is very slightly wrong: 2^32 is
 * not a whole number of millions, so the low codes would come up marginally
 * more often than the high ones. The bias is tiny and the fix is three lines,
 * so there is no reason to carry it. Draws above the largest whole multiple of
 * the range are thrown away and drawn again.
 */
export function randomDigits(digits = EMAIL_CODE_DIGITS): string {
  const range = 10 ** digits;
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0]!;
  } while (value >= limit);
  return (value % range).toString().padStart(digits, '0');
}

/**
 * Whether this person can be offered an email code at all, and where it would
 * go.
 *
 * One function rather than two, because the page that offers the link and the
 * route that sends the code must not be able to disagree — the shape of fault
 * 43 in miniature. Everything it reads comes from the database at the moment it
 * is asked, never from the session's copy of the user.
 */
export type EmailCodeOffer =
  | { ok: true; email: string }
  /** `no_provider` is the only one the page explains; the others cannot be seen from the challenge. */
  | { ok: false; reason: 'no_provider' | 'no_two_factor' | 'not_active' | 'no_address' };

export async function emailCodeOffer(env: Env, userId: string): Promise<EmailCodeOffer> {
  /*
   * The provider first, because this is the one that decides whether the link
   * is drawn. With `MAIL_PROVIDER` unset the queue accepts a message and holds
   * it — which is exactly right for a fee quote and exactly wrong for a code
   * that is only worth anything for ten minutes. Offering the link on a
   * register that cannot send would be a button that quietly does nothing.
   */
  if (!mailConfigured(env)) return { ok: false, reason: 'no_provider' };

  const row = await one<{
    email: string | null; status: string | null;
    totp_enabled: number | null; totp_secret: string | null;
  }>(
    env.DB, 'SELECT email, status, totp_enabled, totp_secret FROM users WHERE id = ?', userId);

  if (!row || row.status !== 'active') return { ok: false, reason: 'not_active' };
  // No two-factor, no challenge to pass, so no code. This is what keeps the
  // fallback from becoming a way of having weak two-factor.
  if (row.totp_enabled !== 1 || !row.totp_secret) return { ok: false, reason: 'no_two_factor' };
  if (!row.email) return { ok: false, reason: 'no_address' };
  return { ok: true, email: row.email };
}

/**
 * Make one, replacing whatever was outstanding, and hand back the only copy
 * that will be readable.
 *
 * The row before it is deleted rather than left to expire: two live codes means
 * "which one did I get" has two answers, and the older one goes on working for
 * its remaining minutes after somebody asked for a fresh one precisely because
 * they had lost track of the first.
 *
 * One reading of the clock is used for both ends of the row. It was two here as
 * well until the lesson of the trusted-machine ceiling — `nowIso()` and then
 * `Date.now()` — and the milliseconds between them made the row very slightly
 * longer than it was meant to be, which at the ceiling is the difference
 * between a working feature and a database refusing it.
 */
export async function createLoginEmailCode(
  env: Env, opts: { userId: string; req?: Request },
): Promise<{ code: string; id: string; expiresAt: string }> {
  const code = randomDigits();
  const id = newId('lec');
  const now = Date.now();
  const at = new Date(now).toISOString();
  const expiresAt = new Date(now + EMAIL_CODE_MINUTES * MINUTE_MS).toISOString();
  const ip = opts.req ? clientIp(opts.req) : null;
  const userAgent = opts.req ? ((opts.req.headers.get('user-agent') ?? '').slice(0, 300) || null) : null;

  await run(env.DB, 'DELETE FROM login_email_codes WHERE user_id = ?', opts.userId);
  await run(
    env.DB,
    `INSERT INTO login_email_codes (id, user_id, code_hash, created_at, expires_at, ip, user_agent)
     VALUES (?,?,?,?,?,?,?)`,
    id, opts.userId, await hashPassword(code), at, expiresAt, ip, userAgent,
  );

  return { code, id, expiresAt };
}

/**
 * The letter itself. Plain text, short, and it says the three things somebody
 * needs: the code, how long it lasts, and what to do if they did not ask.
 *
 * No link in it, deliberately. A sign-in email carrying a link is the shape
 * every phishing message imitates, and the person reading this is already on
 * the page that wants the code.
 *
 * **The code is not in the subject line**, which is where every other service
 * puts it. Found by a test, 12 September 2026: the queue writes a `mail.sent`
 * line into the audit log carrying the recipient *and the subject*, and the
 * audit log is append-only — so a code in the subject would be a live
 * credential written permanently into the one table nothing can edit. It costs
 * the reader one extra second in their inbox and it is worth it.
 */
export function loginEmailCodeMessage(code: string, appName: string): { subject: string; text: string } {
  return {
    subject: 'Your sign-in code',
    text: [
      `Your sign-in code is ${code}`,
      '',
      `Type it into the page that asked for it. It lasts ${EMAIL_CODE_MINUTES} minutes and works once.`,
      '',
      'If you did not just try to sign in, somebody has your password. Ignore this',
      'email, then change your password as soon as you can.',
      '',
      `— ${appName}`,
    ].join('\n'),
  };
}

/**
 * Send one, through the queue every other letter goes through.
 *
 * So it lands in `outbound_emails` like everything else and the practice can
 * see that it went. The queue is flushed straight away rather than waiting for
 * the nightly pass, because a code that arrives tomorrow is not a code.
 */
export async function sendLoginEmailCode(
  env: Env, opts: { userId: string; email: string; code: string },
): Promise<{ sent: boolean }> {
  const { subject, text } = loginEmailCodeMessage(opts.code, env.APP_NAME ?? 'The client register');
  await queueEmail(env, {
    to: opts.email,
    subject,
    text,
    // Against the person, so the letter has a home in the record. Nothing in the
    // register lists a user's mail, which is deliberate — see docs/issues.md.
    entityType: 'user',
    entityId: opts.userId,
  });
  const { flushQueue } = await import('../mail/queue');
  const result = await flushQueue(env, 5);
  return { sent: result.sent > 0 };
}

export type EmailCodeCheck =
  | { ok: true; id: string }
  /**
   * `outstanding` says a live code existed and this was not it — a guess at a
   * real code rather than somebody mistyping an authenticator. It is used to
   * decide which line goes in the audit log and reaches nobody outside it: the
   * page says the same sentence either way.
   */
  | { ok: false; outstanding: boolean };

/**
 * Decide whether a presented six digits is this person's live code, and spend
 * it if it is.
 *
 * One verification is always performed, against a dummy hash when there is no
 * row, so a person with no outstanding code costs the same work as one with.
 *
 * The mark of use is written with `used_at IS NULL` still in the statement, so
 * two requests arriving together cannot both spend the same code: the second
 * changes no rows and is refused. The database refuses to touch a used row at
 * all, which is the same rule kept a second time in the place a later handler
 * cannot avoid.
 */
export async function verifyLoginEmailCode(
  env: Env, userId: string, presented: string,
): Promise<EmailCodeCheck> {
  const digits = presented.replace(/[\s-]/g, '');

  const row = await one<{
    id: string; code_hash: string; expires_at: string; used_at: string | null;
    user_status: string | null; user_totp_enabled: number | null; user_totp_secret: string | null;
  }>(
    env.DB,
    `SELECT c.id, c.code_hash, c.expires_at, c.used_at,
            u.status AS user_status, u.totp_enabled AS user_totp_enabled,
            u.totp_secret AS user_totp_secret
       FROM login_email_codes c JOIN users u ON u.id = c.user_id
      WHERE c.user_id = ?`,
    userId);

  const matches = await verifyPassword(digits || 'no code was presented', row?.code_hash ?? DUMMY_HASH);

  // Everything below is read from the row and the person as they are now, not
  // from anything the request carried. Fault 43, over ten minutes instead of
  // forty days.
  const live = !!row
    && !row.used_at
    && row.expires_at > nowIso()
    && row.user_status === 'active'
    && row.user_totp_enabled === 1
    && !!row.user_totp_secret;

  if (!row || !matches || !live) return { ok: false, outstanding: live };

  const spent = await run(
    env.DB,
    'UPDATE login_email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL',
    nowIso(), row.id,
  );
  if (Number((spent.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
    return { ok: false, outstanding: false };
  }
  return { ok: true, id: row.id };
}

/** Throw away a person's outstanding code, where the ground moves under it. */
export async function clearLoginEmailCode(env: Env, userId: string): Promise<void> {
  await run(env.DB, 'DELETE FROM login_email_codes WHERE user_id = ?', userId);
}
