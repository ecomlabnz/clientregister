/** Resend transport. */

import { addressList, type MailProvider, type OutboundMessage } from './provider';

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
          to: addressList(message.to),
          ...(message.cc ? { cc: addressList(message.cc) } : {}),
          ...(message.bcc ? { bcc: addressList(message.bcc) } : {}),
          ...(message.replyTo ? { reply_to: addressList(message.replyTo) } : {}),
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.attachments?.length
            ? { attachments: message.attachments.map((a) => ({
                filename: a.filename,
                content: base64(a.bytes),
              })) }
            : {}),
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


/** Resend takes attachment content as base64. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
