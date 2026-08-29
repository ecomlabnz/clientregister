/**
 * Reading a Gmail mailbox, so nobody has to forward mail by hand.
 *
 * The practice sends from its own address and forwards everything it receives
 * into a separate Gmail account. This polls that account and puts what it finds
 * through the same ingest pipeline Cloudflare Email Routing uses, so a message
 * that arrives this way is indistinguishable afterwards from one that arrived
 * the other way — same capture, same dedupe, same trust rule, same inbox.
 *
 * Three deliberate limits.
 *
 * **Read-only.** The scope is `gmail.readonly`. The register never labels,
 * moves, marks, or deletes anything in that mailbox: whatever holds this token
 * can read every message in it, and there is no reason for it to be able to
 * write as well. Which messages have been taken is answered by the register's
 * own inbox, which is where somebody is looking anyway.
 *
 * **A dedicated account.** This must be a mailbox that receives forwarded work
 * mail and nothing else. Pointed at a person's own inbox it would read their
 * private and privileged correspondence, and the token is a deployment secret
 * rather than something a person unlocks.
 *
 * **It files; it does not decide.** Everything here ends at `captureMessage`.
 * Whether a message becomes an inquiry is the pipeline's existing rule — the
 * sender is on the allow-list, or a person presses the button. Nothing in this
 * file changes a case, a date or a status.
 */

import type { Env } from '../types';
import { accessToken, type GmailCredentials } from '../mail/gmail';
import { allowList, captureMessage, isAllowed } from './pipeline';
import { parseInboundEmail } from './email';
import { audit } from '../core/audit';

/**
 * How often the mailbox is read. Must match the entry in `wrangler.jsonc`, and
 * a test holds the two together — if they drift, every firing runs the nightly
 * housekeeping and the mailbox is never read.
 *
 * Here rather than in `src/index.ts` because that file is the Worker's module,
 * and the runtime rejects an export from it that is not a handler. It refuses
 * to start at all, which is the good version of that mistake.
 */
export const MAIL_POLL_CRON = '*/5 * * * *';

const LIST_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const TOKEN_CACHE_KEY = 'mail:gmail:inbox_access_token';
const SEEN_PREFIX = 'ingest:gmail:';
/** A week is far longer than any backlog and keeps the key space bounded. */
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How far back a poll looks.
 *
 * Longer than any plausible gap between runs, so an outage or a missed cron
 * catches up by itself rather than losing the mail that arrived meanwhile.
 * Re-reading is free: the pipeline dedupes on the message's own Message-ID.
 */
const LOOKBACK = 'newer_than:2d';
const MAX_PER_POLL = 25;

export interface InboxCredentials extends GmailCredentials {
  address: string | null;
}

/**
 * The reading account's credentials, or null if it has not been set up.
 *
 * The client id and secret fall back to the sending ones, because both accounts
 * commonly live in the same Google project. The refresh token never falls back:
 * it names the mailbox, and reading the wrong one is exactly the mistake worth
 * making impossible.
 */
export function inboxCredentials(env: Env): InboxCredentials | null {
  // Trimmed for the same reason as the sending pair: these are pasted, and a
  // trailing newline turns a valid client id into one Google has never heard of.
  const trim = (value: string | undefined) => (value ?? '').trim();
  const refreshToken = trim(env.GMAIL_INBOX_REFRESH_TOKEN);
  const clientId = trim(env.GMAIL_INBOX_CLIENT_ID) || trim(env.GMAIL_CLIENT_ID);
  const clientSecret = trim(env.GMAIL_INBOX_CLIENT_SECRET) || trim(env.GMAIL_CLIENT_SECRET);
  if (!refreshToken || !clientId || !clientSecret) return null;
  return {
    clientId, clientSecret, refreshToken,
    address: trim(env.GMAIL_INBOX_ADDRESS) || null,
  };
}

export function inboxSetupGaps(env: Env): string[] {
  const needed: Array<[string, string | undefined]> = [
    ['GMAIL_INBOX_REFRESH_TOKEN', env.GMAIL_INBOX_REFRESH_TOKEN],
    ['GMAIL_INBOX_CLIENT_ID', env.GMAIL_INBOX_CLIENT_ID ?? env.GMAIL_CLIENT_ID],
    ['GMAIL_INBOX_CLIENT_SECRET', env.GMAIL_INBOX_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET],
  ];
  return needed.filter(([, value]) => !value).map(([name]) => name);
}

/** Gmail returns raw messages base64url-encoded. */
export function decodeRawMessage(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function gmailGet(url: string, token: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`gmail ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

export interface PollResult {
  looked: number;
  captured: number;
  skipped: number;
  failed: number;
}

/**
 * One pass over the mailbox.
 *
 * Every message is taken through `parseInboundEmail` — the same parser the
 * routing path uses — so a forwarded message keeps the original sender in its
 * From header and is trusted, or not, on exactly the same rule.
 */
export async function pollInbox(env: Env): Promise<PollResult | null> {
  const creds = inboxCredentials(env);
  if (!creds) return null;

  const result: PollResult = { looked: 0, captured: 0, skipped: 0, failed: 0 };
  const token = await accessToken(env, creds, TOKEN_CACHE_KEY);

  const listUrl = `${LIST_ENDPOINT}?q=${encodeURIComponent(`in:inbox ${LOOKBACK}`)}`
    + `&maxResults=${MAX_PER_POLL}`;
  const list = await gmailGet(listUrl, token) as { messages?: Array<{ id: string }> };
  const messages = list.messages ?? [];
  result.looked = messages.length;

  for (const { id } of messages) {
    // Seen ids live in KV rather than being re-derived from the database,
    // because the cheap thing to skip is the fetch of the raw message, and that
    // decision has to be made before anything is parsed.
    const seenKey = `${SEEN_PREFIX}${id}`;
    if (await env.SESSIONS.get(seenKey)) { result.skipped++; continue; }

    try {
      const message = await gmailGet(`${LIST_ENDPOINT}/${id}?format=raw`, token) as { raw?: string };
      if (!message.raw) { result.skipped++; continue; }

      const parsed = await parseInboundEmail(decodeRawMessage(message.raw));
      const sender = parsed.fromAddress;
      const allowed = allowList(env.INGEST_EMAIL_ALLOWED_SENDERS);

      await captureMessage(env, {
        channel: 'email',
        externalId: parsed.messageId ?? `gmail:${id}`,
        sender,
        senderDisplay: parsed.fromName ?? sender,
        subject: parsed.subject,
        bodyText: parsed.text,
        attachments: parsed.attachments,
        trusted: allowed.length > 0 && isAllowed(allowed, sender),
        toAddresses: parsed.toAddresses,
        ccAddresses: parsed.ccAddresses,
        receivedAt: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
        // The sender is the counterpart, so the message joins their
        // conversation and a reply has somewhere to go.
        peerId: sender,
        peerLabel: parsed.fromName ?? sender,
        meta: { via: 'gmail-poll', gmailId: id, mailbox: creds.address },
      });

      await env.SESSIONS.put(seenKey, '1', { expirationTtl: SEEN_TTL_SECONDS });
      result.captured++;
    } catch (err) {
      // One unreadable message must not stop the rest of the poll, and must not
      // be marked seen — the next pass tries it again.
      result.failed++;
      console.error('gmail poll: message failed', id, err);
    }
  }

  if (result.captured > 0 || result.failed > 0) {
    await audit(env, {
      action: 'ingest.gmail_polled',
      actorLabel: 'channel:email',
      meta: { ...result, mailbox: creds.address },
    });
  }
  return result;
}
