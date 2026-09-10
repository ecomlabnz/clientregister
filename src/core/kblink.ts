/**
 * The private link a client opens to read one of the practice's document lists.
 *
 * **Asked for on 10 September 2026**, in the same breath as the lists
 * themselves: *"ideally I should be able to share those lists with clients if
 * necessary - and it is often necessary."*
 *
 * ## Why not just paste it into an email
 *
 * Because the list is long, it is grouped under headings that an email will
 * flatten, and it changes. Pasted, every client ends up holding a slightly
 * different version, frozen on the day it was sent, and a correction reaches
 * none of them. Behind a link, the body the practice edits is the body the
 * client reads, and a correction reaches everybody at once.
 *
 * ## The link, and how it differs from a quotation's
 *
 * The same 128 bits of unguessable address, and the same reasoning: there is no
 * account behind it, so the address *is* the credential, and its shape is a
 * rule the database keeps (migration 0080) rather than a habit of this file.
 *
 * What differs is revocation. A quotation's link is minted once and kept for
 * good, because breaking it would break a contract already formed. A document
 * list carries nothing back, so this link can be taken away — and being able to
 * take it away is most of the point: a list sent to the wrong address has to be
 * able to stop working. Sharing again after revoking mints a fresh address, and
 * the old one stays dead.
 *
 * ## Nothing is shared by accident
 *
 * The knowledge base holds internal material as well as client-facing lists —
 * the practice's own procedures, notes on live matters. So no article is
 * readable by an outsider until somebody presses a button on that particular
 * article, and the row records who pressed it.
 */

import type { Env } from '../types';
import { nowIso, one, run } from './db';

/** 128 bits, hex, matching the shape the database insists on. */
export function newShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Share an article, returning the address to hand out.
 *
 * Idempotent while a link is live: pressing Share twice gives the same address,
 * so an email already sent keeps working. It is only after a revoke that a
 * fresh one is minted.
 */
export async function shareArticle(
  env: Env, articleId: string, byUserId: string | null,
): Promise<string | null> {
  const row = await one<{ share_token: string | null }>(
    env.DB, 'SELECT share_token FROM kb_articles WHERE id = ?', articleId);
  if (!row) return null;
  if (row.share_token) return row.share_token;

  const token = newShareToken();
  // Guarded by `share_token IS NULL` and by the unique index, so two presses
  // arriving together cannot produce two addresses — one loses and re-reads.
  await run(
    env.DB,
    `UPDATE kb_articles SET share_token = ?, shared_at = ?, shared_by = ?
      WHERE id = ? AND share_token IS NULL`,
    token, nowIso(), byUserId, articleId);
  const after = await one<{ share_token: string | null }>(
    env.DB, 'SELECT share_token FROM kb_articles WHERE id = ?', articleId);
  return after?.share_token ?? null;
}

/**
 * Stop the link working.
 *
 * The three columns clear together because the database refuses any other
 * combination: an article with a live address and nobody's name against it is
 * a door nobody admitted opening.
 */
export async function revokeArticleLink(env: Env, articleId: string): Promise<void> {
  await run(
    env.DB,
    `UPDATE kb_articles SET share_token = NULL, shared_at = NULL, shared_by = NULL
      WHERE id = ?`,
    articleId);
}

/** The full address to put in an email or a message. */
export function documentUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/d/${token}`;
}

export interface SharedArticle {
  id: string;
  ref: string;
  title: string;
  summary: string | null;
  body: string;
  status: string;
  updated_at: string;
}

/**
 * The article behind a link, or nothing.
 *
 * A token that was never ours, one mistyped, and one that has been revoked are
 * all the same answer — a page that told them apart would let somebody learn
 * which links exist by trying.
 */
export async function articleByToken(env: Env, token: string): Promise<SharedArticle | null> {
  if (!/^[0-9a-f]{32,}$/.test(token)) return null;
  return one<SharedArticle>(
    env.DB,
    `SELECT id, ref, title, summary, body, status, updated_at
       FROM kb_articles WHERE share_token = ?`,
    token,
  );
}
