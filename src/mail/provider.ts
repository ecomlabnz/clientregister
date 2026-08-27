/**
 * Outbound email.
 *
 * Every message is written to `outbound_emails` before any attempt to send, so
 * what the practice sent (or tried to send) is on the file whether or not the
 * provider is configured. With MAIL_PROVIDER unset, mail queues and stays
 * queued — useful while the domain's SPF/DKIM are still being set up.
 */

import type { Env } from '../types';

export interface OutboundMessage {
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
  html?: string | null;
}

export interface MailProvider {
  readonly name: string;
  send(message: OutboundMessage, from: string): Promise<{ id: string | null }>;
}

export function mailConfigured(env: Env): boolean {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'resend') return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
  return false;
}

export async function getMailProvider(env: Env): Promise<MailProvider | null> {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'resend' && env.RESEND_API_KEY) {
    const { createResendProvider } = await import('./resend');
    return createResendProvider(env.RESEND_API_KEY);
  }
  return null;
}

/** Basic address sanity check — the provider does the real validation. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
