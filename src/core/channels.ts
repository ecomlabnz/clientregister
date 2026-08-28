/**
 * Channels as conversations.
 *
 * Until now a channel was a direction: things arrived. A Telegram message
 * became a row in the inbox and the practice answered it somewhere else — in
 * Telegram itself, from a phone, with nothing on the file to say what was said.
 *
 * A thread is one counterpart on one channel, and it holds both halves: what
 * came in, and what the practice sent back. It may be linked to a client and a
 * case, and once it is, the conversation is part of the file.
 *
 * One rule runs through all of it: nothing sends by itself. Every reply is
 * written by a person, stored with their name against it, and only then handed
 * to the transport. If the transport is not configured the reply stays queued
 * and nothing is lost — the same arrangement outbound email has always had.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';
import { audit } from './audit';
import { queueEmail } from '../mail/queue';

export type ThreadChannel = 'telegram' | 'whatsapp' | 'email';

export const THREAD_CHANNELS: ThreadChannel[] = ['telegram', 'whatsapp', 'email'];

export const CHANNEL_LABELS: Record<ThreadChannel, string> = {
  telegram: 'Telegram', whatsapp: 'WhatsApp', email: 'Email',
};

export function isThreadChannel(value: string): value is ThreadChannel {
  return (THREAD_CHANNELS as string[]).includes(value);
}

export interface ThreadRow {
  id: string;
  channel: ThreadChannel;
  peer_id: string;
  peer_label: string | null;
  client_id: string | null;
  case_id: string | null;
  status: 'open' | 'closed';
  last_message_at: string | null;
  created_at: string;
}

/**
 * The thread for this counterpart, creating it the first time they write.
 *
 * Upserted on (channel, peer_id) rather than looked up and inserted, because
 * two webhooks arriving together is ordinary and a second thread for the same
 * person is not.
 */
export async function threadFor(
  env: Env, channel: ThreadChannel, peerId: string, label: string | null, at: string,
): Promise<string> {
  const id = newId('thr');
  await run(
    env.DB,
    `INSERT INTO channel_threads (id, channel, peer_id, peer_label, status, last_message_at, created_at)
     VALUES (?,?,?,?, 'open', ?, ?)
     ON CONFLICT(channel, peer_id) DO UPDATE SET
       last_message_at = excluded.last_message_at,
       -- A label is only ever improved: somebody who set up their Telegram
       -- name after writing should not go back to being a number.
       peer_label = COALESCE(excluded.peer_label, channel_threads.peer_label)`,
    id, channel, peerId, label, at, nowIso(),
  );
  const row = await one<{ id: string }>(
    env.DB, `SELECT id FROM channel_threads WHERE channel = ? AND peer_id = ?`, channel, peerId,
  );
  return row?.id ?? id;
}

export async function linkThread(
  env: Env, threadId: string, clientId: string | null, caseId: string | null,
): Promise<void> {
  await run(
    env.DB, `UPDATE channel_threads SET client_id = ?, case_id = ? WHERE id = ?`,
    clientId, caseId, threadId,
  );
}

export interface ReplyRow {
  id: string;
  thread_id: string;
  channel: ThreadChannel;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  created_at: string;
  created_by: string;
  sent_at: string | null;
}

/**
 * Write a reply and try to send it.
 *
 * Written first, always. What the practice said is on the file whether or not
 * the transport was working, and a failed send is a row saying so rather than
 * a message that never existed.
 */
export async function postReply(
  env: Env,
  input: { threadId: string; body: string; userId: string; subject?: string },
): Promise<{ ok: boolean; message: string }> {
  const thread = await one<ThreadRow>(env.DB, `SELECT * FROM channel_threads WHERE id = ?`, input.threadId);
  if (!thread) return { ok: false, message: 'That conversation no longer exists.' };

  const body = input.body.trim().slice(0, 4000);
  if (!body) return { ok: false, message: 'Write something first.' };

  const id = newId('rep');
  await run(
    env.DB,
    `INSERT INTO channel_replies (id, thread_id, channel, body, status, created_at, created_by)
     VALUES (?,?,?,?, 'queued', ?, ?)`,
    id, thread.id, thread.channel, body, nowIso(), input.userId,
  );
  await run(env.DB, `UPDATE channel_threads SET last_message_at = ? WHERE id = ?`, nowIso(), thread.id);

  const sent = await deliver(env, thread, body, input.subject ?? null, input.userId);

  await run(
    env.DB,
    `UPDATE channel_replies SET status = ?, provider_id = ?, error = ?, sent_at = ? WHERE id = ?`,
    sent.ok ? 'sent' : (sent.queued ? 'queued' : 'failed'),
    sent.providerId ?? null, sent.error ?? null, sent.ok ? nowIso() : null, id,
  );

  await audit(env, {
    action: 'channel.reply', entityType: 'channel_thread', entityId: thread.id,
    actorId: input.userId,
    meta: { channel: thread.channel, ok: sent.ok, queued: sent.queued, chars: body.length },
  });

  if (sent.ok) return { ok: true, message: 'Sent.' };
  if (sent.queued) return { ok: true, message: sent.error ?? 'Saved, and waiting for the channel to be connected.' };
  return { ok: false, message: sent.error ?? 'That could not be sent.' };
}

type Delivery = { ok: boolean; queued: boolean; providerId?: string | null; error?: string };

/** Hand the reply to whichever transport this channel uses. */
async function deliver(
  env: Env, thread: ThreadRow, body: string, subject: string | null, userId: string,
): Promise<Delivery> {
  if (thread.channel === 'telegram') {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return { ok: false, queued: true, error: 'Saved. Telegram is not connected yet, so it has not gone out.' };
    }
    return sendTelegram(env.TELEGRAM_BOT_TOKEN, thread.peer_id, body);
  }

  if (thread.channel === 'whatsapp') {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      return { ok: false, queued: true, error: 'Saved. WhatsApp sending is not connected yet, so it has not gone out.' };
    }
    return sendWhatsApp(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, thread.peer_id, body);
  }

  // Email goes through the queue the rest of the application uses, so it is
  // subject to the same provider, the same retries and the same record.
  try {
    await queueEmail(env, {
      to: thread.peer_id,
      subject: subject || `Message from your adviser`,
      text: body,
      entityType: 'channel_thread', entityId: thread.id, createdBy: userId,
    });
    const { flushQueue } = await import('../mail/queue');
    const flushed = await flushQueue(env, 5);
    return flushed.sent > 0
      ? { ok: true, queued: false }
      : { ok: false, queued: true, error: 'Saved and queued. It will go out with the next send.' };
  } catch (err) {
    return { ok: false, queued: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<Delivery> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json<{ ok?: boolean; description?: string; result?: { message_id?: number } }>();
    if (!res.ok || !data.ok) {
      return { ok: false, queued: false, error: (data.description ?? `Telegram returned ${res.status}`).slice(0, 300) };
    }
    return { ok: true, queued: false, providerId: data.result?.message_id ? String(data.result.message_id) : null };
  } catch (err) {
    return { ok: false, queued: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * WhatsApp only allows free text within 24 hours of the person's last message.
 * Outside that window Meta rejects it and says so; the message stays on the
 * file marked failed with their reason, which is more useful than this code
 * guessing at the window itself.
 */
async function sendWhatsApp(token: string, phoneNumberId: string, to: string, text: string): Promise<Delivery> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', recipient_type: 'individual',
        to, type: 'text', text: { preview_url: false, body: text },
      }),
    });
    const data = await res.json<{ messages?: Array<{ id: string }>; error?: { message?: string } }>();
    if (!res.ok) {
      return { ok: false, queued: false, error: (data.error?.message ?? `WhatsApp returned ${res.status}`).slice(0, 300) };
    }
    return { ok: true, queued: false, providerId: data.messages?.[0]?.id ?? null };
  } catch (err) {
    return { ok: false, queued: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One conversation, both directions, oldest first. */
export interface ThreadEntry {
  direction: 'in' | 'out';
  at: string;
  body: string;
  who: string;
  status: string | null;
  /** Why it is not simply sent — a transport that is not connected, or a refusal. */
  note: string | null;
  href: string | null;
}

export async function threadHistory(env: Env, threadId: string): Promise<ThreadEntry[]> {
  const [inbound, outbound] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT id, received_at, body_text, sender_display, sender, status
         FROM ingest_messages WHERE thread_id = ? ORDER BY received_at LIMIT 200`,
      threadId,
    ),
    all<any>(
      env.DB,
      `SELECT r.created_at, r.body, r.status, r.error, u.name AS author
         FROM channel_replies r JOIN users u ON u.id = r.created_by
        WHERE r.thread_id = ? ORDER BY r.created_at LIMIT 200`,
      threadId,
    ),
  ]);

  const entries: ThreadEntry[] = [
    ...inbound.map((m: any) => ({
      direction: 'in' as const, at: m.received_at, body: m.body_text ?? '',
      who: m.sender_display ?? m.sender ?? 'them', status: m.status, note: null,
      href: `/inbox/${m.id}`,
    })),
    ...outbound.map((r: any) => ({
      direction: 'out' as const, at: r.created_at, body: r.body,
      who: r.author, status: r.status, note: r.error ?? null, href: null,
    })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

export async function openThreadCount(env: Env): Promise<number> {
  const row = await one<{ n: number }>(
    env.DB, `SELECT COUNT(*) AS n FROM channel_threads WHERE status = 'open'`,
  );
  return row?.n ?? 0;
}
