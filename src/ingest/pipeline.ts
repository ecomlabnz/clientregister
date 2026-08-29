/**
 * The ingest pipeline.
 *
 * Everything arriving from outside the practice — email, Telegram, WhatsApp —
 * lands in `ingest_messages` first, verbatim. Nothing from a channel writes
 * directly into the register.
 *
 * A message is *trusted* only when its sender is on that channel's allow-list.
 * Trusted messages may auto-create an inquiry (so forwarding a WhatsApp message
 * to the bot produces something actionable straight away). Untrusted messages
 * are captured and left in the inbox for a human to triage, which keeps a
 * stranger who guesses the address from creating register records.
 */

import type { Env } from '../types';
import type { InquirySource } from '../domain';
import { newId } from '../core/ids';
import { sha256Hex } from '../core/crypto';
import { getBoolSetting, nowIso, one, run } from '../core/db';
import { audit } from '../core/audit';
import { createInquiry, matchClient } from '../modules/inquiries';
import { addEntry } from '../core/timeline';
import { isThreadChannel, threadFor } from '../core/channels';

export type Channel = 'email' | 'telegram' | 'whatsapp' | 'api';

export interface CapturedMessage {
  channel: Channel;
  externalId?: string | null;
  sender?: string | null;
  senderDisplay?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  attachments?: Array<{ filename: string; contentType: string; size: number }>;
  trusted: boolean;
  /** Everyone the message was addressed to, so a reply can reach them all. */
  toAddresses?: string[];
  ccAddresses?: string[];
  receivedAt?: string;
  meta?: Record<string, unknown>;
  /**
   * The counterpart's address on this channel — a chat id, a phone number, an
   * email address. Given one, the message joins a conversation that can be
   * replied to; without one it is captured exactly as before.
   */
  peerId?: string | null;
  peerLabel?: string | null;
}

export interface CaptureResult {
  messageId: string;
  duplicate: boolean;
  inquiryId?: string;
  inquiryRef?: string;
}

/** Stable key so a redelivered webhook does not create a second record. */
async function dedupeKey(msg: CapturedMessage): Promise<string> {
  if (msg.externalId) return `${msg.channel}:${msg.externalId}`;
  const digest = await sha256Hex(
    `${msg.channel}|${msg.sender ?? ''}|${msg.subject ?? ''}|${(msg.bodyText ?? '').slice(0, 2000)}`,
  );
  return `${msg.channel}:sha:${digest}`;
}

const CHANNEL_TO_SOURCE: Record<Channel, InquirySource> = {
  email: 'email', telegram: 'telegram', whatsapp: 'whatsapp', api: 'other',
};

export async function captureMessage(env: Env, msg: CapturedMessage): Promise<CaptureResult> {
  const key = await dedupeKey(msg);

  const existing = await one<{ id: string; inquiry_id: string | null }>(
    env.DB, 'SELECT id, inquiry_id FROM ingest_messages WHERE dedupe_key = ?', key,
  );
  if (existing) return { messageId: existing.id, duplicate: true, inquiryId: existing.inquiry_id ?? undefined };

  const id = newId('ing');
  await run(
    env.DB,
    `INSERT INTO ingest_messages (id, channel, external_id, dedupe_key, received_at, sender, sender_display,
        subject, body_text, attachments_json, trusted, status, meta_json, created_at,
        to_addrs, cc_addrs)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?)`,
    id, msg.channel, msg.externalId ?? null, key, msg.receivedAt ?? nowIso(),
    msg.sender ?? null, msg.senderDisplay ?? null, msg.subject ?? null,
    (msg.bodyText ?? '').slice(0, 60_000),
    msg.attachments && msg.attachments.length ? JSON.stringify(msg.attachments) : null,
    msg.trusted ? 1 : 0,
    msg.meta ? JSON.stringify(msg.meta) : null,
    nowIso(),
    msg.toAddresses?.length ? msg.toAddresses.join(', ') : null,
    msg.ccAddresses?.length ? msg.ccAddresses.join(', ') : null,
  );

  // A message from somebody identifiable joins their conversation, so the
  // reply has somewhere to go and the file shows both halves of it.
  if (msg.peerId && isThreadChannel(msg.channel)) {
    const threadId = await threadFor(
      env, msg.channel, msg.peerId, msg.senderDisplay ?? null, msg.receivedAt ?? nowIso(),
    );
    await run(env.DB, `UPDATE ingest_messages SET thread_id = ? WHERE id = ?`, threadId, id);
  }

  await audit(env, {
    action: 'ingest.captured', entityType: 'ingest_message', entityId: id,
    actorLabel: `channel:${msg.channel}`,
    meta: { sender: msg.sender, trusted: msg.trusted, subject: msg.subject },
  });

  const autoCreate = await getBoolSetting(env, 'ingest.auto_create_inquiries', true);
  if (msg.trusted && autoCreate) {
    const result = await processMessage(env, id, null);
    return { messageId: id, duplicate: false, inquiryId: result?.inquiryId, inquiryRef: result?.inquiryRef };
  }

  return { messageId: id, duplicate: false };
}

export interface ProcessResult { inquiryId: string; inquiryRef: string }

/**
 * Turn a captured message into an inquiry, linking it to an existing client
 * when the sender's details match one.
 */
export async function processMessage(
  env: Env,
  messageId: string,
  actorId: string | null,
): Promise<ProcessResult | null> {
  const msg = await one<{
    id: string; channel: Channel; sender: string | null; sender_display: string | null;
    subject: string | null; body_text: string | null; received_at: string; status: string;
    meta_json: string | null; inquiry_id: string | null;
  }>(env.DB, 'SELECT * FROM ingest_messages WHERE id = ?', messageId);

  if (!msg) return null;
  if (msg.status === 'processed' && msg.inquiry_id) {
    const existing = await one<{ ref: string }>(env.DB, 'SELECT ref FROM inquiries WHERE id = ?', msg.inquiry_id);
    return existing ? { inquiryId: msg.inquiry_id, inquiryRef: existing.ref } : null;
  }

  try {
    const meta = msg.meta_json ? (JSON.parse(msg.meta_json) as Record<string, unknown>) : {};
    const isEmail = msg.channel === 'email';
    const senderPhone = msg.channel === 'whatsapp' ? msg.sender : null;

    const client = await matchClient(env, {
      email: isEmail ? msg.sender : null,
      phone: senderPhone,
      whatsapp: senderPhone,
      telegramUserId: msg.channel === 'telegram' ? String(meta['from_id'] ?? '') || null : null,
    });

    const { id: inquiryId, ref } = await createInquiry(env, {
      source: CHANNEL_TO_SOURCE[msg.channel],
      sourceRef: msg.sender,
      receivedAt: msg.received_at,
      contactName: msg.sender_display,
      contactEmail: isEmail ? msg.sender : null,
      contactPhone: senderPhone,
      subject: msg.subject,
      body: msg.body_text,
      clientId: client?.id ?? null,
      createdBy: actorId,
    });

    await run(
      env.DB,
      `UPDATE ingest_messages SET status = 'processed', processed_at = ?, inquiry_id = ?, error = NULL WHERE id = ?`,
      nowIso(), inquiryId, messageId,
    );

    if (client) {
      await addEntry(env, {
        entityType: 'client', entityId: client.id, kind: 'message',
        body: `Inbound ${msg.channel} message captured as inquiry ${ref}${msg.subject ? `: ${msg.subject}` : ''}.`,
        createdBy: actorId,
      });
    }

    await audit(env, {
      action: 'ingest.processed', entityType: 'ingest_message', entityId: messageId,
      actorId, actorLabel: actorId ? 'user' : `channel:${msg.channel}`,
      meta: { inquiryId, ref, matchedClient: client?.ref ?? null },
    });

    return { inquiryId, inquiryRef: ref };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      env.DB,
      `UPDATE ingest_messages SET status = 'failed', error = ?, processed_at = ? WHERE id = ?`,
      message.slice(0, 500), nowIso(), messageId,
    );
    console.error('ingest processing failed', messageId, message);
    return null;
  }
}

/** Comma-separated allow-list from a secret, normalised for comparison. */
export function allowList(value: string | undefined, normalise: (s: string) => string = (s) => s.trim().toLowerCase()): string[] {
  if (!value) return [];
  return value.split(',').map(normalise).filter(Boolean);
}

export function isAllowed(list: string[], candidate: string | null | undefined, normalise: (s: string) => string = (s) => s.trim().toLowerCase()): boolean {
  if (!candidate) return false;
  return list.includes(normalise(candidate));
}

export const digitsOnly = (s: string): string => s.replace(/\D/g, '');
