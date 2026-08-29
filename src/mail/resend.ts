/** Resend transport. */

import type { MailProvider, OutboundMessage } from './provider';

export function createResendProvider(apiKey: string): MailProvider {
  return {
    name: 'resend',
    async send(message: OutboundMessage, from: string): Promise<{ id: string | null }> {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          ...(message.cc ? { cc: [message.cc] } : {}),
          ...(message.bcc ? { bcc: [message.bcc] } : {}),
          ...(message.replyTo ? { reply_to: [message.replyTo] } : {}),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) {
        throw new Error(`resend error ${response.status}: ${body.message ?? 'unknown'}`);
      }
      return { id: body.id ?? null };
    },
  };
}
