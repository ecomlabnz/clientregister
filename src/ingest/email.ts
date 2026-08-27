/**
 * Inbound email ingest, via Cloudflare Email Routing.
 *
 * Point a route (e.g. cases@yourdomain) at this Worker and anything sent there
 * is parsed and captured. Mail from an address on INGEST_EMAIL_ALLOWED_SENDERS
 * is trusted and creates an inquiry immediately — that is the "forward it in
 * and it becomes an entry" path. Anything else is captured untrusted and waits
 * in the inbox, so an address that leaks cannot be used to inject records.
 */

import PostalMime from 'postal-mime';
import type { Env } from '../types';
import { allowList, captureMessage, isAllowed } from './pipeline';
import { audit } from '../core/audit';

const MAX_BODY_CHARS = 60_000;

export interface ParsedInboundEmail {
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  text: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
  messageId: string | null;
  date: string | null;
}

/** Parse a raw RFC-822 message into the fields the register cares about. */
export async function parseInboundEmail(raw: ArrayBuffer): Promise<ParsedInboundEmail> {
  const email = await PostalMime.parse(raw);
  const from = email.from;
  const text =
    (email.text && email.text.trim()) ||
    (email.html ? stripHtml(email.html) : '') ||
    '(no text content)';

  return {
    fromAddress: from?.address ? from.address.toLowerCase() : null,
    fromName: from?.name || null,
    subject: email.subject ?? null,
    text: text.slice(0, MAX_BODY_CHARS),
    attachments: (email.attachments ?? []).map((a) => ({
      filename: a.filename ?? 'attachment',
      contentType: a.mimeType ?? 'application/octet-stream',
      size: a.content instanceof ArrayBuffer ? a.content.byteLength : 0,
    })),
    messageId: email.messageId ?? null,
    date: email.date ?? null,
  };
}

/** Crude but adequate: we only need readable text for triage, not fidelity. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cloudflare Email Routing entry point. Never rejects the message: a bounce
 * would tell a sender whether an address is monitored. Failures are logged and
 * the mail is captured for triage instead.
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  try {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await parseInboundEmail(raw);

    const sender = parsed.fromAddress ?? message.from?.toLowerCase() ?? null;
    const allowed = allowList(env.INGEST_EMAIL_ALLOWED_SENDERS);
    const trusted = allowed.length > 0 && isAllowed(allowed, sender);

    await captureMessage(env, {
      channel: 'email',
      externalId: parsed.messageId ?? `${sender ?? 'unknown'}:${Date.now()}`,
      sender,
      senderDisplay: parsed.fromName ?? sender,
      subject: parsed.subject,
      bodyText: parsed.text,
      attachments: parsed.attachments,
      trusted,
      receivedAt: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
      meta: { to: message.to, size: raw.byteLength },
    });
  } catch (err) {
    console.error('inbound email capture failed', err);
    await audit(env, {
      action: 'ingest.email_failed',
      actorLabel: 'channel:email',
      meta: { error: err instanceof Error ? err.message : String(err), from: message.from },
    });
  }
}
