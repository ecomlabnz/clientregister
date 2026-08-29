/**
 * Outbound email.
 *
 * Every message is written to `outbound_emails` before any attempt to send, so
 * what the practice sent (or tried to send) is on the file whether or not the
 * provider is configured. With MAIL_PROVIDER unset, mail queues and stays
 * queued — useful while a domain or a Google authorisation is still being set
 * up, and the reason nothing is ever lost while the transport is changed.
 *
 * Two transports, both over HTTPS because Workers cannot open an SMTP
 * connection: Gmail, which sends from the practice's own mailbox and leaves the
 * message in its Sent folder, and Resend, which sends from a verified domain.
 */

import type { Env } from '../types';

export interface OutboundMessage {
  to: string;
  cc?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  /**
   * Where a reply should go, when that is not the sending address.
   *
   * A provider will only put a From address on a domain verified with it, and
   * that domain may have no mailbox behind it. Reply-To is how a practice sends
   * from an address its provider authorises and is answered at one somebody
   * reads. Left empty, replies go to From, which is the ordinary case.
   */
  replyTo?: string | null;
}

export interface MailProvider {
  readonly name: string;
  send(message: OutboundMessage, from: string): Promise<{ id: string | null }>;
}

export function mailConfigured(env: Env): boolean {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'resend') return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
  if (provider === 'gmail') {
    return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.MAIL_FROM);
  }
  return false;
}

/** What is missing, for an administrator looking at the integrations page. */
export function mailSetupGaps(env: Env): string[] {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'none' || !provider) return ['MAIL_PROVIDER'];
  const needed = provider === 'gmail'
    ? ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'MAIL_FROM']
    : provider === 'resend'
      ? ['RESEND_API_KEY', 'MAIL_FROM']
      : [];
  return needed.filter((name) => !env[name as keyof Env]);
}

export async function getMailProvider(env: Env): Promise<MailProvider | null> {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (provider === 'resend' && env.RESEND_API_KEY) {
    const { createResendProvider } = await import('./resend');
    return createResendProvider(env.RESEND_API_KEY);
  }
  if (provider === 'gmail') {
    const { createGmailProvider, gmailCredentials } = await import('./gmail');
    const creds = gmailCredentials(env);
    if (creds) return createGmailProvider(env, creds);
  }
  return null;
}

/** Basic address sanity check — the provider does the real validation. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
