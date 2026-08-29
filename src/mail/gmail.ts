/**
 * Gmail transport.
 *
 * Cloudflare Workers cannot open an SMTP connection — SMTP needs a raw TCP
 * handshake and the runtime does not offer one — so this talks to the Gmail
 * REST API over HTTPS instead. Google is also retiring app passwords, so OAuth
 * is where this was heading regardless.
 *
 * The practice authorises the application once and the resulting refresh token
 * is stored as a Worker secret. That token is exchanged for a short-lived
 * access token when one is needed, and the access token is cached in KV until
 * shortly before it expires, so sending a hundred emails costs one token
 * request rather than a hundred.
 *
 * Sending this way rather than through a bulk provider has a practical
 * advantage for a small practice: the message lands in the Gmail account's own
 * Sent folder, threads correctly, and replies come back to the same inbox the
 * practice already reads.
 */

import type { Env } from '../types';
import type { MailProvider, OutboundMessage } from './provider';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const TOKEN_CACHE_KEY = 'mail:gmail:access_token';

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * Trim, because these arrive by copy and paste.
 *
 * A client id with a trailing newline is a different string, and Google answers
 * "The OAuth client was not found" — which reads like the client was deleted
 * rather than like a stray keystroke. Whitespace is never meaningful in any of
 * these values, so removing it can only help.
 */
const clean = (value: string | undefined): string => (value ?? '').trim();

/** What a Google OAuth client id always ends with. */
export const CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';

/**
 * Whether a credential is the shape Google issues, in words an administrator
 * can act on.
 *
 * Checked before the request rather than after it, because Google's own answer
 * to a malformed client id names neither the field nor the problem.
 */
export function credentialShapeProblem(creds: GmailCredentials): string | null {
  if (!creds.clientId.endsWith(CLIENT_ID_SUFFIX)) {
    return `the client ID does not end "${CLIENT_ID_SUFFIX}", so it is not a Google OAuth client`
      + ' ID — check it was copied whole, and from the right client';
  }
  if (!creds.refreshToken.startsWith('1//')) {
    return 'the refresh token does not start "1//" — an access token or an authorisation code'
      + ' may have been saved in its place';
  }
  return null;
}

export function gmailCredentials(env: Env): GmailCredentials | null {
  const clientId = clean(env.GMAIL_CLIENT_ID);
  const clientSecret = clean(env.GMAIL_CLIENT_SECRET);
  const refreshToken = clean(env.GMAIL_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/**
 * A short-lived access token for a set of credentials.
 *
 * Exported because the inbox reader needs one too, for a different account.
 * `cacheKey` is therefore a parameter: two accounts sharing one cache key would
 * hand each other's tokens out, and the failure would look like an
 * intermittent permissions error rather than what it was.
 */
export async function accessToken(
  env: Env, creds: GmailCredentials, cacheKey: string = TOKEN_CACHE_KEY,
): Promise<string> {
  const cached = await env.SESSIONS.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string; expires_in?: number; error?: string; error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    // Google's answer to a malformed credential names neither the field nor the
    // problem, so say what is checkable about the values before repeating it.
    const shape = credentialShapeProblem(creds);
    if (shape) throw new Error(`gmail token error ${response.status}: ${shape}`);
    // Google's own wording is the useful part here; a revoked or expired grant
    // says so, and that is what an administrator needs to read.
    throw new Error(`gmail token error ${response.status}: ${body.error_description ?? body.error ?? 'unknown'}`);
  }

  // Renew a minute early rather than at the last moment, so a send that starts
  // just before expiry does not fail on a token that lapses mid-request.
  const ttl = Math.max(60, (body.expires_in ?? 3600) - 60);
  await env.SESSIONS.put(cacheKey, body.access_token, { expirationTtl: ttl });
  return body.access_token;
}

/**
 * Build the RFC 2822 message Gmail expects.
 *
 * Headers are encoded rather than trusted: a subject can hold anything a person
 * typed, and a bare newline in one would end the headers early and let the rest
 * be read as more of them. Non-ASCII subjects are sent as encoded words so that
 * a client's name survives the trip.
 */
export function buildMimeMessage(message: OutboundMessage, from: string): string {
  const lines = [
    `From: ${headerValue(from)}`,
    `To: ${headerValue(message.to)}`,
    ...(message.cc ? [`Cc: ${headerValue(message.cc)}`] : []),
    // Gmail reads this, delivers to it, and strips it from what recipients see.
    ...(message.bcc ? [`Bcc: ${headerValue(message.bcc)}`] : []),
    ...(message.replyTo ? [`Reply-To: ${headerValue(message.replyTo)}`] : []),
    `Subject: ${encodeHeaderText(message.subject)}`,
    'MIME-Version: 1.0',
  ];

  const boundary = () => `b_${crypto.randomUUID().replace(/-/g, '')}`;

  /** The message itself: plain, or plain and formatted together. */
  const bodyPart = (): string[] => {
    if (!message.html) {
      return ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit',
              '', message.text];
    }
    const alt = boundary();
    return [
      `Content-Type: multipart/alternative; boundary="${alt}"`, '',
      `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit', '', message.text, '',
      `--${alt}`, 'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit', '', message.html, '',
      `--${alt}--`, '',
    ];
  };

  const files = message.attachments ?? [];
  if (files.length === 0) {
    lines.push(...bodyPart());
    return lines.join('\r\n');
  }

  // multipart/mixed wrapping the body, which may itself be multipart. A reader
  // that cannot show the formatted version still gets the plain one, and still
  // gets the files.
  const mixed = boundary();
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, '');
  lines.push(`--${mixed}`, ...bodyPart(), '');
  for (const file of files) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${headerValue(file.contentType)}; name="${headerValue(file.filename)}"`,
      `Content-Disposition: attachment; filename="${headerValue(file.filename)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      // Wrapped at 76 characters: a base64 body on one enormous line is legal
      // and some mail servers reject it anyway.
      ...(base64(file.bytes).match(/.{1,76}/g) ?? []),
      '',
    );
  }
  lines.push(`--${mixed}--`, '');

  return lines.join('\r\n');
}

/** Strip anything that could start a new header line. */
function headerValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** RFC 2047 encoded word, so a subject may hold any language. */
function encodeHeaderText(value: string): string {
  const clean = headerValue(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  const bytes = new TextEncoder().encode(clean);
  return `=?UTF-8?B?${base64(bytes)}?=`;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64Url(value: string): string {
  return base64(new TextEncoder().encode(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createGmailProvider(env: Env, creds: GmailCredentials): MailProvider {
  return {
    name: 'gmail',
    async send(message: OutboundMessage, from: string): Promise<{ id: string | null }> {
      const token = await accessToken(env, creds);
      const response = await fetch(SEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: base64Url(buildMimeMessage(message, from)) }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        id?: string; error?: { message?: string };
      };
      if (!response.ok) {
        // A 401 means the cached token was rejected — most often because the
        // grant was revoked. Drop it so the next attempt asks for a fresh one
        // rather than replaying a token Google has already refused.
        if (response.status === 401) await env.SESSIONS.delete(TOKEN_CACHE_KEY);
        throw new Error(`gmail error ${response.status}: ${body.error?.message ?? 'unknown'}`);
      }
      return { id: body.id ?? null };
    },
  };
}
