/**
 * Collect the Worker's secrets from the environment into a file that
 * `wrangler secret bulk` can upload.
 *
 * Only names on this list are ever considered, and only those actually set are
 * included — so a half-configured deployment uploads what exists and leaves the
 * rest alone. Values are never printed; the script logs names only.
 */

import { writeFileSync } from 'node:fs';

const SECRET_NAMES = [
  'SETUP_TOKEN',
  'FIELD_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_ALLOWED_USER_IDS',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ALLOWED_SENDERS',
  'INGEST_EMAIL_ALLOWED_SENDERS',
  'NZBN_API_KEY',
  'NZBN_USE_SANDBOX',
  'MAIL_PROVIDER',
  'MAIL_FROM',
  'RESEND_API_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'AI_PROVIDER',
  // AI_MODEL is deliberately absent: which model runs is a setting, chosen
  // under Admin → Settings → Assistant, so there is one place that answers it.
  'ANTHROPIC_API_KEY',
];

const outputPath = process.argv[2] ?? '.secrets.json';
const secrets = {};

for (const name of SECRET_NAMES) {
  const value = process.env[name];
  if (typeof value === 'string' && value.trim() !== '') secrets[name] = value;
}

const names = Object.keys(secrets);
if (names.length === 0) {
  console.log('No Worker secrets are configured in this repository — skipping the sync.');
  console.log('Add them under Settings → Secrets and variables → Actions.');
  process.exit(0);
}

writeFileSync(outputPath, JSON.stringify(secrets), { mode: 0o600 });
console.log(`Prepared ${names.length} secret(s) to upload: ${names.join(', ')}`);
