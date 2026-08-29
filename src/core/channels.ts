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
import { renderEmailHtml } from './richtext';
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
export interface ReplyInput {
  threadId: string;
  body: string;
  userId: string;
  subject?: string;
  /**
   * Where it goes, when that is not simply the person the conversation is with.
   *
   * A conversation has one counterpart; a piece of correspondence may have
   * five. Left empty these fall back to the thread's peer, which is the
   * ordinary case and the one that should need no thought.
   */
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
  /** Send the formatted version as well as the plain text. */
  asHtml?: boolean;
}

export async function postReply(
  env: Env,
  input: ReplyInput,
): Promise<{ ok: boolean; message: string }> {
  const thread = await one<ThreadRow>(env.DB, `SELECT * FROM channel_threads WHERE id = ?`, input.threadId);
  if (!thread) return { ok: false, message: 'That conversation no longer exists.' };

  const body = input.body.trim().slice(0, 4000);
  if (!body) return { ok: false, message: 'Write something first.' };

  // Only email has recipients other than the counterpart. A chat id is the
  // conversation, so anything typed into these fields on Telegram or WhatsApp
  // would be silently ignored rather than honoured — better to not carry it.
  const email = thread.channel === 'email';
  const to = (email && input.to?.trim()) || thread.peer_id;
  const cc = email ? (input.cc?.trim() || null) : null;
  const bcc = email ? (input.bcc?.trim() || null) : null;
  const asHtml = email && input.asHtml === true;

  const id = newId('rep');
  await run(
    env.DB,
    `INSERT INTO channel_replies (id, thread_id, channel, body, status, created_at, created_by,
        to_addr, cc_addr, bcc_addr, sent_html)
     VALUES (?,?,?,?, 'queued', ?,?,?,?,?,?)`,
    id, thread.id, thread.channel, body, nowIso(), input.userId,
    to, cc, bcc, asHtml ? 1 : 0,
  );
  await run(env.DB, `UPDATE channel_threads SET last_message_at = ? WHERE id = ?`, nowIso(), thread.id);

  const sent = await deliver(env, thread, body, input.subject ?? null, input.userId,
    { to, cc, bcc, asHtml });

  await run(
    env.DB,
    `UPDATE channel_replies SET status = ?, provider_id = ?, error = ?, sent_at = ? WHERE id = ?`,
    sent.ok ? 'sent' : (sent.queued ? 'queued' : 'failed'),
    sent.providerId ?? null, sent.error ?? null, sent.ok ? nowIso() : null, id,
  );

  await audit(env, {
    action: 'channel.reply', entityType: 'channel_thread', entityId: thread.id,
    actorId: input.userId,
    meta: { channel: thread.channel, ok: sent.ok, queued: sent.queued, chars: body.length,
            to, cc, bcc, html: asHtml },
  });

  if (sent.ok) return { ok: true, message: 'Sent.' };
  if (sent.queued) return { ok: true, message: sent.error ?? 'Saved, and waiting for the channel to be connected.' };
  return { ok: false, message: sent.error ?? 'That could not be sent.' };
}

type Delivery = { ok: boolean; queued: boolean; providerId?: string | null; error?: string };

/** Hand the reply to whichever transport this channel uses. */
async function deliver(
  env: Env, thread: ThreadRow, body: string, subject: string | null, userId: string,
  email: { to: string; cc: string | null; bcc: string | null; asHtml: boolean },
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
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: subject || `Message from your adviser`,
      text: body,
      // The plain text goes either way. A formatted message carries both, so a
      // client that will not render HTML still gets a readable letter.
      html: email.asHtml ? renderEmailHtml(body) : null,
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
      // Ignored messages are left out. Ignoring one is a decision that it was
      // not correspondence — a notification, a circular, something sent to the
      // wrong address — and a conversation that keeps showing it is a
      // conversation whose shape disagrees with the decision. It is still in
      // the inbox under "Ignored", and the audit log still records that it
      // arrived; only this reading of the exchange leaves it out.
      `SELECT id, received_at, body_text, sender_display, sender, status
         FROM ingest_messages
        WHERE thread_id = ? AND status != 'ignored' ORDER BY received_at LIMIT 200`,
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


/**
 * The conversations attached to a client or a matter, with their last word.
 *
 * Correspondence used to live only in the Incoming section: a message reached a
 * client's file as a one-line stub when somebody turned it into an inquiry, and
 * otherwise not at all. That made "what did we actually tell them" a question
 * you answered by remembering which conversation it was in.
 *
 * Read rather than copied. The message stays in one place and the file shows
 * it — copying the body onto a timeline would give it a second owner, and the
 * two would disagree the first time one was edited.
 */
export interface ThreadSummary {
  id: string;
  channel: ThreadChannel;
  peer_id: string;
  peer_label: string | null;
  last_message_at: string | null;
  /** The most recent thing said, whichever side said it. */
  last_body: string | null;
  last_direction: 'in' | 'out' | null;
  waiting: number;
}

export async function threadsFor(
  env: Env, entity: 'client' | 'case', entityId: string,
): Promise<ThreadSummary[]> {
  const column = entity === 'client' ? 'client_id' : 'case_id';
  return all<ThreadSummary>(
    env.DB,
    `SELECT t.id, t.channel, t.peer_id, t.peer_label, t.last_message_at,
            (SELECT COUNT(*) FROM ingest_messages m
              WHERE m.thread_id = t.id AND m.status = 'pending') AS waiting,
            (SELECT body_text FROM ingest_messages m
              WHERE m.thread_id = t.id AND m.status != 'ignored'
              ORDER BY m.received_at DESC LIMIT 1) AS last_in,
            (SELECT r.body FROM channel_replies r
              WHERE r.thread_id = t.id ORDER BY r.created_at DESC LIMIT 1) AS last_out,
            (SELECT MAX(m.received_at) FROM ingest_messages m
              WHERE m.thread_id = t.id AND m.status != 'ignored') AS last_in_at,
            (SELECT MAX(r.created_at) FROM channel_replies r WHERE r.thread_id = t.id) AS last_out_at
       FROM channel_threads t
      WHERE t.${column} = ?
      ORDER BY t.last_message_at DESC LIMIT 50`,
    entityId,
  ).then((rows) => rows.map((row: any) => {
    // Whichever side spoke last. Comparing the two timestamps rather than
    // trusting last_message_at, which is only bumped on a reply.
    const outLater = (row.last_out_at ?? '') > (row.last_in_at ?? '');
    return {
      id: row.id, channel: row.channel, peer_id: row.peer_id, peer_label: row.peer_label,
      last_message_at: row.last_out_at && outLater ? row.last_out_at : row.last_in_at,
      last_body: outLater ? row.last_out : row.last_in,
      last_direction: (row.last_in_at || row.last_out_at) ? (outLater ? 'out' : 'in') : null,
      waiting: row.waiting ?? 0,
    } as ThreadSummary;
  }));
}
