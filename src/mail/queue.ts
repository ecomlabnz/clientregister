/** The outbound queue: write first, send second, record the outcome. */

import type { Env } from '../types';
import { newId } from '../core/ids';
import { all, getSetting, nowIso, run } from '../core/db';
import { audit } from '../core/audit';
import { getMailProvider, looksLikeEmail, type OutboundMessage } from './provider';

export interface QueuedEmail {
  id: string;
  to_addr: string;
  cc_addr: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  reply_to: string | null;
  status: string;
  provider: string | null;
  provider_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function queueEmail(
  env: Env,
  message: OutboundMessage & { entityType?: string | null; entityId?: string | null; createdBy?: string | null },
): Promise<string> {
  if (!looksLikeEmail(message.to)) throw new Error('invalid recipient address');

  // Resolved here rather than at each call site: every outbound message wants
  // the same answer, and a setting read in one place cannot drift from itself.
  // Passing an explicit replyTo overrides it; passing null suppresses it.
  const replyTo = message.replyTo === undefined
    ? (await getSetting(env, 'practice.reply_to', '')) || null
    : message.replyTo;

  const id = newId('out');
  await run(
    env.DB,
    `INSERT INTO outbound_emails (id, to_addr, cc_addr, subject, body_text, body_html, reply_to,
        status, entity_type, entity_id, created_at, created_by)
     VALUES (?,?,?,?,?,?,?, 'queued', ?,?,?,?)`,
    id, message.to.trim(), message.cc ?? null, message.subject, message.text, message.html ?? null,
    replyTo,
    message.entityType ?? null, message.entityId ?? null, nowIso(), message.createdBy ?? null,
  );
  return id;
}

/**
 * Attempt delivery of queued mail. Called from the scheduled handler and after
 * a user queues something, so a working provider sends promptly and a missing
 * one simply leaves the queue intact.
 */
export async function flushQueue(env: Env, limit = 20): Promise<{ sent: number; failed: number; skipped: number }> {
  const provider = await getMailProvider(env);
  const from = env.MAIL_FROM;
  if (!provider || !from) {
    const pending = await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM outbound_emails WHERE status = 'queued'`);
    return { sent: 0, failed: 0, skipped: pending[0]?.n ?? 0 };
  }

  const queued = await all<QueuedEmail>(
    env.DB, `SELECT * FROM outbound_emails WHERE status = 'queued' ORDER BY created_at LIMIT ?`, limit,
  );

  let sent = 0;
  let failed = 0;
  for (const item of queued) {
    try {
      const result = await provider.send(
        {
          to: item.to_addr, cc: item.cc_addr, subject: item.subject,
          text: item.body_text, html: item.body_html,
          // Stored on the message rather than read from settings at send time,
          // so what was queued is what goes out even if the setting changes in
          // between.
          replyTo: item.reply_to,
        },
        from,
      );
      await run(
        env.DB,
        `UPDATE outbound_emails SET status = 'sent', provider = ?, provider_id = ?, sent_at = ?, error = NULL WHERE id = ?`,
        provider.name, result.id, nowIso(), item.id,
      );
      await audit(env, {
        action: 'mail.sent', entityType: 'outbound_email', entityId: item.id, actorLabel: 'system',
        meta: { to: item.to_addr, subject: item.subject },
      });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await run(
        env.DB,
        `UPDATE outbound_emails SET status = 'failed', provider = ?, error = ? WHERE id = ?`,
        provider.name, message.slice(0, 500), item.id,
      );
      await audit(env, {
        action: 'mail.failed', entityType: 'outbound_email', entityId: item.id, actorLabel: 'system',
        meta: { error: message },
      });
      failed++;
    }
  }
  return { sent, failed, skipped: 0 };
}
