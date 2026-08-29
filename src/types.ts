/**
 * Bindings and shared request-scoped types.
 *
 * Everything optional in `Env` is a capability the app degrades gracefully
 * without: no Telegram token means no Telegram ingest, no mail provider means
 * outbound email queues but never sends, and so on. The app must boot and be
 * usable with nothing configured beyond DB + SESSIONS.
 */

export interface Env {
  // --- Required bindings ---
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS?: Fetcher;

  // --- Optional bindings ---
  /** Workers AI. Present but unused unless the AI layer is switched on. */
  AI?: Ai;
  /** R2 bucket for documents. Absent until R2 is enabled on the account. */
  DOCS?: R2Bucket;

  // --- Vars ---
  APP_NAME: string;
  APP_ENV: string;
  APP_ORIGIN: string;

  // --- Secrets (all optional; features gate on their presence) ---
  SETUP_TOKEN?: string;
  /** base64-encoded 32 bytes; enables sealed (encrypted) PII fields. */
  FIELD_KEY?: string;

  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ALLOWED_USER_IDS?: string;

  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_ALLOWED_SENDERS?: string;
  /** Cloud API credentials, needed only to reply — receiving does not use them. */
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;

  INGEST_EMAIL_ALLOWED_SENDERS?: string;

  /** MBIE NZBN register. Free, but needs a registered subscriber key. */
  NZBN_API_KEY?: string;
  NZBN_USE_SANDBOX?: string;

  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  /**
   * The mailbox the register *reads*, which is not the account it sends from.
   *
   * A practice sends as its own firm address and forwards its mail into a
   * separate Gmail account for the register to poll. Whatever holds this token
   * can read that entire mailbox, so it must be a dedicated account carrying
   * forwarded work mail and nothing else. The client id and secret fall back to
   * the sending ones when both accounts sit in the same Google project.
   */
  GMAIL_INBOX_REFRESH_TOKEN?: string;
  GMAIL_INBOX_CLIENT_ID?: string;
  GMAIL_INBOX_CLIENT_SECRET?: string;
  /** Only for display on the integrations page; nothing is authorised by it. */
  GMAIL_INBOX_ADDRESS?: string;

  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
}

export type Role = 'owner' | 'admin' | 'adviser' | 'assistant' | 'readonly';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'suspended';
  totp_enabled: number;
  /** Appearance, so the server can render the right theme on the first paint. */
  theme: string;
  colour_mode: string;
}

export interface SessionData {
  /** session_records.id — the durable handle used for revocation. */
  sid: string;
  userId: string;
  csrf: string;
  createdAt: number;
  expiresAt: number;
  /** false while a TOTP challenge is outstanding. */
  verified: boolean;
}

/** Hono context variables set by middleware. */
/** What the banner in the corner needs, resolved once per request. */
export interface NotifySettings {
  on: boolean;
  position: string;
  sound: string;
  everySeconds: number;
}

export interface Vars {
  user: User | null;
  session: SessionData | null;
  requestId: string;
  nonce: string;
  /** Resolved once per request for the banner in the corner. */
  notify: NotifySettings | null;
}

export type AppContext = { Bindings: Env; Variables: Vars };

export type EntityType = 'client' | 'case' | 'inquiry' | 'quote';
