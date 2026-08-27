/**
 * Cryptographic primitives, all on WebCrypto (the only option in Workers).
 *
 *  - Passwords: PBKDF2-SHA256. Argon2/scrypt are not available in the runtime,
 *    so the iteration count carries the cost. It is stored inside the hash so
 *    it can be raised later without invalidating existing credentials.
 *  - Sealed fields: AES-256-GCM under FIELD_KEY, for the handful of columns
 *    that hold document-identity data (passport numbers).
 *  - TOTP: RFC 6238, SHA-1/6 digits/30s — what authenticator apps expect.
 */

import { base64Decode, base64Encode } from './ids';

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEYLEN_BITS = 256;

const enc = new TextEncoder();

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEYLEN_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[2]!);
    expected = base64Decode(parts[3]!);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** True when the hash was made with weaker parameters than we now use. */
export function passwordNeedsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return true;
  return Number(parts[1]) < PBKDF2_ITERATIONS;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, message: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const data = typeof message === 'string' ? enc.encode(message) : message;
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Sealed fields -----------------------------------------------------------

async function fieldKey(rawBase64: string): Promise<CryptoKey> {
  const raw = base64Decode(rawBase64);
  if (raw.length !== 32) throw new Error('FIELD_KEY must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt a value for storage. Returns `v1.<base64(iv||ciphertext)>`. */
export async function sealField(plaintext: string, keyB64: string): Promise<string> {
  const key = await fieldKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(plaintext));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return `v1.${base64Encode(combined)}`;
}

/** Decrypt a sealed value. Returns null if the value is malformed or forged. */
export async function unsealField(sealed: string, keyB64: string): Promise<string | null> {
  if (!sealed.startsWith('v1.')) return null;
  try {
    const key = await fieldKey(keyB64);
    const combined = base64Decode(sealed.slice(3));
    if (combined.length <= 12) return null;
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

// --- TOTP (RFC 6238) ---------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base32Encode(buf);
}

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    'raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1]! & 0x0f;
  const code =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

/** The 6-digit code for a secret at a given moment. */
export async function totpCode(secretBase32: string, now = Date.now()): Promise<string> {
  return hotp(base32Decode(secretBase32), Math.floor(now / 1000 / 30));
}

/**
 * Verify a 6-digit TOTP code, allowing one 30s step of clock drift each way.
 */
export async function verifyTotp(secretBase32: string, code: string, now = Date.now()): Promise<boolean> {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) return false;
  let secret: Uint8Array;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const step = Math.floor(now / 1000 / 30);
  for (const drift of [-1, 0, 1]) {
    const expected = await hotp(secret, step + drift);
    if (timingSafeEqualStr(expected, digits)) return true;
  }
  return false;
}

export function totpUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
