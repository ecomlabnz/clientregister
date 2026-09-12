/**
 * The token an Apple Shortcut carries instead of signing in.
 *
 * **Asked for on 11 September 2026:** *"may as well build the apple shortcut
 * option - not sure how it works but should be available."*
 *
 * ## What this authority is, and what it is not
 *
 * A shortcut running in Finder or on a phone has no browser, no cookie, no
 * session and nobody to type a password. So it carries a token in an
 * `Authorization: Bearer …` header, and that token is the whole of what it can
 * prove. Assume it leaks — it lives on a laptop and a phone, in a Shortcuts
 * action anyone holding the device can open and read.
 *
 * So the authority is deliberately the smallest thing that is still useful:
 *
 *   **A holder of one of these may create an inbox item, with files, and do
 *   nothing else whatever.** It cannot read a client, a matter, a quotation, an
 *   invoice, a file note or a document. It cannot list what it has sent. It
 *   cannot see its own token's name. It is not a session, it is never turned
 *   into one, and no route but `POST /api/ingest/shortcut` consults it.
 *
 * That is enforced by there being exactly one caller: `verifyUploadToken` is
 * imported by `modules/shortcut` and by nothing else, and every other route in
 * the register is behind `requireAuth`, which reads a session cookie this token
 * cannot produce. A test asserts both halves.
 *
 * What a finder of a leaked token can therefore do is send the practice files
 * it did not ask for. They land in the inbox marked untrusted, like anything
 * else that arrives from outside, and somebody deletes them. What they cannot
 * do is read one line of one client's file.
 *
 * ## The shape of the token, and why it has two parts
 *
 *     ru_  QxfP2n9wKb4T  8s...43 characters...
 *     └┬┘  └─────┬────┘  └──────────┬───────┘
 *   prefix    selector            secret
 *
 * The **selector** is stored in the clear and indexed. It carries no authority
 * at all; it says only *which* token is being offered. The **secret** is 32
 * random bytes and is stored only as a PBKDF2 hash, made and checked by the
 * same `hashPassword`/`verifyPassword` a password uses.
 *
 * Hashing the whole token with no selector would mean verifying every token in
 * the table on every upload — one PBKDF2 hash apiece, and the Workers CPU
 * budget does not stretch to that. Keeping it in the clear would mean the
 * register held a working credential for every device the practice owns. Two
 * parts gives one row read, one hash verified, and nothing recoverable in the
 * database.
 *
 * ## Telling nobody anything
 *
 * Every failure — no header, a malformed token, a selector that was never
 * issued, a wrong secret, a revoked token, a suspended user — returns the same
 * `UploadTokenRefusal` and the caller says the same sentence. A PBKDF2
 * verification is performed even when there is no row, against a hash no secret
 * matches, so the time taken does not say whether the token exists. The token
 * itself is never logged, never audited and never put in an error message.
 */

import type { Env, Role } from '../types';
import { all, nowIso, one, run } from './db';
import { newId, randomToken } from './ids';
import { hashPassword, PASSWORD_HASH_PARAMS, verifyPassword } from './crypto';
import { can, isRole } from './rbac';

/**
 * `ru_` for "register upload". A prefix on a credential is worth having: it
 * makes one recognisable in a support conversation without being read out, and
 * makes one findable by a secret scanner if it is ever pasted somewhere public.
 */
export const UPLOAD_TOKEN_PREFIX = 'ru_';

/**
 * Where a shortcut sends its files.
 *
 * Here rather than in the module that answers it, because two places need the
 * address and neither may import the other: the module owns the route, and the
 * account page has to print it for somebody to paste into Shortcuts. A module
 * importing another module is the one thing `core/module.ts` says a feature
 * must not do.
 */
export const SHORTCUT_PATH = '/api/ingest/shortcut';

/** 9 random bytes is exactly 12 base64url characters, with no padding. */
const SELECTOR_BYTES = 9;
export const SELECTOR_LENGTH = 12;

/** 32 random bytes is exactly 43 base64url characters. 256 bits, unguessable. */
const SECRET_BYTES = 32;
const SECRET_LENGTH = 43;

export interface UploadTokenRow {
  id: string;
  user_id: string;
  selector: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  uses: number;
  revoked_at: string | null;
}

/**
 * A syntactically valid hash that no secret matches, so an unknown selector
 * costs the same work as a known one. Its parameters must stay in step with
 * `hashPassword` or the timing difference it exists to hide comes back — the
 * same reasoning, and the same construction, as `DUMMY_HASH` in `core/auth.ts`.
 */
const DUMMY_HASH = `pbkdf2-sha256$${PASSWORD_HASH_PARAMS.rounds}x${PASSWORD_HASH_PARAMS.iterations}$` +
  'AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/**
 * The one sentence every refusal says.
 *
 * One wording for "no header", "not a token", "never issued", "wrong secret"
 * and "revoked", because five wordings would let somebody with a list of
 * guesses learn which of them was a real token that had merely been turned off.
 */
export const UPLOAD_REFUSED = 'That upload token was not accepted.';

export type UploadTokenCheck =
  | { ok: true; tokenId: string; userId: string; userName: string; userEmail: string; label: string }
  | { ok: false };

/** Split a presented token into its two halves, or say it is not one at all. */
export function parseUploadToken(raw: string): { selector: string; secret: string } | null {
  const value = raw.trim();
  if (!value.startsWith(UPLOAD_TOKEN_PREFIX)) return null;
  const body = value.slice(UPLOAD_TOKEN_PREFIX.length);
  if (body.length !== SELECTOR_LENGTH + SECRET_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  return { selector: body.slice(0, SELECTOR_LENGTH), secret: body.slice(SELECTOR_LENGTH) };
}

/** The token out of an `Authorization: Bearer …` header, if there is one. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Make a token for one person, and hand back the only copy that will ever
 * exist.
 *
 * The returned `token` is shown once, on the page that asked for it, and is
 * then gone: the database holds a hash, and migration 0087 has a trigger that
 * refuses a row whose secret is not one. Nothing here writes the token to a
 * log, an audit row or an error.
 */
export async function createUploadToken(
  env: Env, opts: { userId: string; label: string },
): Promise<{ token: string; row: UploadTokenRow }> {
  const selector = randomToken(SELECTOR_BYTES);
  const secret = randomToken(SECRET_BYTES);
  const id = newId('upt');
  const at = nowIso();
  const label = opts.label.trim().slice(0, 80) || 'Apple Shortcut';

  await run(
    env.DB,
    `INSERT INTO upload_tokens (id, user_id, selector, secret_hash, label, created_at, uses)
     VALUES (?,?,?,?,?,?,0)`,
    id, opts.userId, selector, await hashPassword(secret), label, at,
  );

  return {
    token: `${UPLOAD_TOKEN_PREFIX}${selector}${secret}`,
    row: {
      id, user_id: opts.userId, selector, label,
      created_at: at, last_used_at: null, uses: 0, revoked_at: null,
    },
  };
}

/** Somebody's tokens, newest first, live ones above revoked ones. */
export async function uploadTokensFor(env: Env, userId: string): Promise<UploadTokenRow[]> {
  return all<UploadTokenRow>(
    env.DB,
    `SELECT id, user_id, selector, label, created_at, last_used_at, uses, revoked_at
       FROM upload_tokens WHERE user_id = ?
      ORDER BY (revoked_at IS NOT NULL), created_at DESC`,
    userId);
}

/**
 * Turn one off.
 *
 * Scoped to the owner in the statement itself rather than checked first: a
 * request naming somebody else's token id changes nothing and reports the same
 * "not found" as a token id that never existed. Revocation is final — the
 * database refuses to undo it.
 */
export async function revokeUploadToken(env: Env, opts: { userId: string; tokenId: string }): Promise<boolean> {
  const result = await run(
    env.DB,
    `UPDATE upload_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    nowIso(), opts.tokenId, opts.userId,
  );
  return Number((result.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

/**
 * Decide whether a presented token is one of ours, and whose.
 *
 * Says `{ ok: false }` and nothing more for every kind of failure. The user is
 * joined in and checked for being active, because a suspended person's devices
 * must stop working the moment their account does — the token belongs to them,
 * not to the practice.
 *
 * This does **not** record the use. `noteUploadTokenUsed` does that, and is
 * called only once an upload has actually been accepted, so "last used" means
 * "last sent us something" rather than "last had a go".
 */
export async function verifyUploadToken(env: Env, presented: string): Promise<UploadTokenCheck> {
  const parts = parseUploadToken(presented);

  const row = parts
    ? await one<{
        id: string; user_id: string; secret_hash: string; label: string; revoked_at: string | null;
        user_name: string | null; user_email: string | null; user_status: string | null;
        user_role: string | null; user_is_demo: number | null;
      }>(
        env.DB,
        `SELECT t.id, t.user_id, t.secret_hash, t.label, t.revoked_at,
                u.name AS user_name, u.email AS user_email, u.status AS user_status,
                u.role AS user_role, u.is_demo AS user_is_demo
           FROM upload_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.selector = ?`,
        parts.selector)
    : null;

  // Always one verification, even with no row and even with no token at all, so
  // the work done — and therefore the time taken — is the same either way.
  const matches = await verifyPassword(parts?.secret ?? 'no token was presented', row?.secret_hash ?? DUMMY_HASH);

  if (!parts || !row || !matches) return { ok: false };
  if (row.revoked_at) return { ok: false };
  if (row.user_status !== 'active') return { ok: false };

  /*
   * The holder must *still* be somebody who may work the inbox.
   *
   * Minting one needs `ingest:triage`, but a token already in a pocket outlives
   * the decision that allowed it. Without this line, moving somebody to "Read
   * only" leaves a working write credential on their laptop, and the practice
   * has no way to take it back: revoking is scoped to the token's own owner, so
   * nobody else can reach it, and the only lever left is suspending the whole
   * account.
   *
   * So the role is checked where the credential is *used*, not only where it is
   * made. A demotion stops the token at the next request, with nothing to
   * revoke and nobody to remember to do it — which is the difference between a
   * rule and an intention. Found in review, 12 September 2026.
   *
   * `is_demo` is here for the same reason. The shared demonstration account is
   * refused a token at the point of minting, and refused again here, so a
   * token made before the account was marked stops at the next request rather
   * than living on as a write credential anybody may hold.
   */
  const role: string = row.user_role ?? '';
  if (row.user_is_demo === 1) return { ok: false };
  if (!isRole(role)
      || !can({ role: role as Role, status: 'active', is_demo: row.user_is_demo ?? 0 }, 'ingest:triage')) {
    return { ok: false };
  }

  return {
    ok: true,
    tokenId: row.id,
    userId: row.user_id,
    userName: row.user_name ?? 'somebody',
    userEmail: row.user_email ?? '',
    label: row.label,
  };
}

/** Record that a token sent something in, so an unused one is visible as such. */
export async function noteUploadTokenUsed(env: Env, tokenId: string): Promise<void> {
  await run(
    env.DB,
    'UPDATE upload_tokens SET last_used_at = ?, uses = uses + 1 WHERE id = ?',
    nowIso(), tokenId,
  );
}
