/**
 * Telegram ingest.
 *
 * Forward a message to your bot and it becomes an inquiry. Two controls keep
 * this from being an open door:
 *
 *  1. Telegram signs the webhook with the secret token registered at
 *     setWebhook time; a request without it is dropped before parsing.
 *  2. Only the numeric user IDs in TELEGRAM_ALLOWED_USER_IDS are trusted.
 *     Anyone else's message is captured for triage but creates nothing.
 */

import type { Context } from 'hono';
import type { AppContext, Env } from '../types';
import { timingSafeEqualStr } from '../core/crypto';
import { allowList, captureMessage, isAllowed } from './pipeline';
import { audit } from '../core/audit';

interface TelegramUser { id: number; first_name?: string; last_name?: string; username?: string }
interface TelegramMessage {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat?: { id: number; type: string; title?: string };
  text?: string;
  caption?: string;
  forward_origin?: {
    type: string;
    sender_user?: TelegramUser;
    sender_user_name?: string;
    chat?: { title?: string; username?: string };
    date?: number;
  };
  document?: { file_name?: string; mime_type?: string; file_size?: number };
  photo?: Array<{ file_size?: number }>;
}
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
}

function displayName(user: TelegramUser | undefined): string | null {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return name || (user.username ? `@${user.username}` : null);
}

/** Who the message is *about*, which for a forward is the original author. */
function originLabel(msg: TelegramMessage): string | null {
  const origin = msg.forward_origin;
  if (!origin) return null;
  if (origin.sender_user) return displayName(origin.sender_user);
  if (origin.sender_user_name) return origin.sender_user_name;
  if (origin.chat?.title) return origin.chat.title;
  return null;
}

export async function handleTelegramWebhook(c: Context<AppContext>): Promise<Response> {
  const env = c.env;
  const configured = env.TELEGRAM_WEBHOOK_SECRET;
  if (!configured) return c.json({ ok: false, error: 'telegram ingest not configured' }, 503);

  const provided = c.req.header('x-telegram-bot-api-secret-token') ?? '';
  if (!provided || !timingSafeEqualStr(provided, configured)) {
    await audit(env, { action: 'ingest.telegram_rejected', actorLabel: 'channel:telegram', meta: { reason: 'bad_secret' } });
    return c.json({ ok: false }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.json({ ok: false, error: 'invalid json' }, 400);
  }

  const msg = update.message ?? update.edited_message ?? update.channel_post;
  if (!msg) return c.json({ ok: true, ignored: 'no message' });

  const fromId = msg.from?.id ? String(msg.from.id) : null;
  const allowed = allowList(env.TELEGRAM_ALLOWED_USER_IDS, (s) => s.trim());
  const trusted = allowed.length > 0 && isAllowed(allowed, fromId, (s) => s.trim());

  const text = msg.text ?? msg.caption ?? '';
  const forwardedFrom = originLabel(msg);
  const body = forwardedFrom ? `Forwarded from ${forwardedFrom}:\n\n${text}` : text;

  const attachments = msg.document
    ? [{
        filename: msg.document.file_name ?? 'attachment',
        contentType: msg.document.mime_type ?? 'application/octet-stream',
        size: msg.document.file_size ?? 0,
      }]
    : [];

  const result = await captureMessage(env, {
    channel: 'telegram',
    externalId: `${msg.chat?.id ?? 'na'}:${msg.message_id}`,
    sender: fromId,
    senderDisplay: forwardedFrom ?? displayName(msg.from),
    subject: forwardedFrom ? `Forwarded from ${forwardedFrom}` : 'Telegram message',
    bodyText: body,
    attachments,
    trusted,
    receivedAt: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    // The chat, not the sender: a reply goes back to where the message came
    // from, which in a group is the group.
    //
    // A forward has no counterpart at all, and this is the whole of it. What
    // arrives is a message *about* somebody, relayed through the practice's own
    // chat with the bot — there is nobody at the other end of it to answer. Key
    // it on the chat id and every forward, whoever it was originally from,
    // lands in one conversation named after whoever forwarded it, which is
    // exactly what happened: three unrelated people in a thread called "TZ".
    // So a forward becomes an inbox message and an inquiry, and no
    // conversation. The database refuses to give it one (migration 0037).
    peerId: forwardedFrom ? null : (msg.chat?.id !== undefined ? String(msg.chat.id) : null),
    peerLabel: forwardedFrom ? null : (msg.chat?.title ?? displayName(msg.from)),
    meta: { from_id: fromId, chat_id: msg.chat?.id, username: msg.from?.username, forwarded: Boolean(msg.forward_origin) },
  });

  // Acknowledge in-chat so the sender knows the register has it.
  if (trusted && env.TELEGRAM_BOT_TOKEN && msg.chat?.id) {
    const reply = result.duplicate
      ? 'Already captured.'
      : result.inquiryRef
        ? `Captured as inquiry ${result.inquiryRef}.`
        : 'Captured — waiting in the register inbox.';
    c.executionCtx.waitUntil(sendTelegramMessage(env, msg.chat.id, reply));
  }

  return c.json({ ok: true });
}

export async function sendTelegramMessage(env: Env, chatId: number | string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_notification: true }),
    });
  } catch (err) {
    console.error('telegram sendMessage failed', err);
  }
}
