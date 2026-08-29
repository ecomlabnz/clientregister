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
  /**
   * Copied, without the other recipients being told.
   *
   * Recorded like every other recipient — a blind copy that leaves no trace is
   * one nobody can answer a question about later. Blind is a property of the
   * message, not of the file.
   */
  bcc?: string | null;
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

/**
 * What the configured transport actually does, for the integrations page.
 *
 * The page used to print `MAIL_PROVIDER=resend — sending.` and stop, which is
 * true and tells an administrator nothing they wanted to know. The question a
 * practice actually has is "where does the copy of what I sent end up, and can I
 * have it in my own mailbox" — and the answer depends entirely on which of the
 * two transports is in use. So the answer is written next to the switch.
 */
export function mailTransportDetail(env: Env): string {
  const provider = (env.MAIL_PROVIDER ?? 'none').toLowerCase();
  if (!mailConfigured(env)) {
    const gaps = mailSetupGaps(env);
    return `MAIL_PROVIDER=${env.MAIL_PROVIDER ?? 'none'}. Mail queues until this is set; nothing is `
      + `lost.${gaps.length ? ` Still needed: ${gaps.join(', ')}.` : ''} Two transports are `
      + 'available: “gmail” sends from the practice’s own mailbox and leaves the message in its '
      + 'Sent folder; “resend” sends from a domain verified with Resend.';
  }
  if (provider === 'gmail') {
    return `MAIL_PROVIDER=gmail — sending as ${env.MAIL_FROM ?? 'the authorised account'}. `
      + 'Each message is sent through Gmail’s API, so a copy stays in that account’s Sent folder '
      + 'and replies land in its inbox.';
  }
  return 'MAIL_PROVIDER=resend — sending from a domain verified with Resend. What was sent is '
    + 'recorded here, but no copy reaches any mailbox. To keep a copy in Gmail instead, set '
    + 'MAIL_PROVIDER=gmail with GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN — '
    + 'see Help → Connecting Telegram, WhatsApp and email.';
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
