/**
 * WhatsApp ingest via the Meta Cloud API.
 *
 * Meta signs every delivery with an HMAC over the raw body; the signature is
 * checked before the payload is parsed, and only numbers on
 * WHATSAPP_ALLOWED_SENDERS are trusted enough to create records.
 */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import { hmacSha256Hex, timingSafeEqualStr } from '../core/crypto';
import { allowList, captureMessage, digitsOnly, isAllowed } from './pipeline';
import { audit } from '../core/audit';

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { caption?: string; mime_type?: string };
  document?: { caption?: string; filename?: string; mime_type?: string };
  audio?: { mime_type?: string };
  context?: { forwarded?: boolean };
}

interface WhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
}

/** Meta's webhook verification handshake. */
export function handleWhatsAppVerify(c: Context<AppContext>): Response {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token') ?? '';
  const challenge = c.req.query('hub.challenge') ?? '';
  const expected = c.env.WHATSAPP_VERIFY_TOKEN;

  if (!expected) return c.text('whatsapp ingest not configured', 503);
  if (mode === 'subscribe' && timingSafeEqualStr(token, expected)) {
    return c.text(challenge, 200);
  }
  return c.text('verification failed', 403);
}

export async function handleWhatsAppWebhook(c: Context<AppContext>): Promise<Response> {
  const env = c.env;
  if (!env.WHATSAPP_APP_SECRET) return c.json({ ok: false, error: 'whatsapp ingest not configured' }, 503);

  const raw = await c.req.raw.clone().arrayBuffer();
  const signature = c.req.header('x-hub-signature-256') ?? '';
  const expected = `sha256=${await hmacSha256Hex(env.WHATSAPP_APP_SECRET, new Uint8Array(raw))}`;
  if (!signature || !timingSafeEqualStr(signature, expected)) {
    await audit(env, { action: 'ingest.whatsapp_rejected', actorLabel: 'channel:whatsapp', meta: { reason: 'bad_signature' } });
    return c.json({ ok: false }, 401);
  }

  let payload: WhatsAppPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as WhatsAppPayload;
  } catch {
    return c.json({ ok: false, error: 'invalid json' }, 400);
  }

  const allowed = allowList(env.WHATSAPP_ALLOWED_SENDERS, digitsOnly);
  let captured = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      const nameByWaId = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) nameByWaId.set(contact.wa_id, contact.profile.name);
      }

      for (const message of value.messages) {
        const text =
          message.text?.body ??
          message.image?.caption ??
          message.document?.caption ??
          `(${message.type} message with no text)`;
        const attachments = message.document
          ? [{
              filename: message.document.filename ?? 'attachment',
              contentType: message.document.mime_type ?? 'application/octet-stream',
              size: 0,
            }]
          : [];

        await captureMessage(env, {
          channel: 'whatsapp',
          externalId: message.id,
          sender: digitsOnly(message.from),
          senderDisplay: nameByWaId.get(message.from) ?? message.from,
          subject: `WhatsApp message from ${nameByWaId.get(message.from) ?? message.from}`,
          bodyText: message.context?.forwarded ? `(forwarded)\n\n${text}` : text,
          attachments,
          trusted: allowed.length > 0 && isAllowed(allowed, message.from, digitsOnly),
          receivedAt: new Date(Number(message.timestamp) * 1000).toISOString(),
          meta: { wa_id: message.from, type: message.type },
        });
        captured++;
      }
    }
  }

  return c.json({ ok: true, captured });
}
