/**
 * Cryptographic primitives, all on WebCrypto (the only option in Workers).
 *
 *  - Passwords: PBKDF2-SHA256. Argon2/scrypt are not available in the runtime,
 *    so the iteration count carries the cost. It is stored inside the hash so
 *    it can be raised later without invalidating existing credentials.
 *  - Sealed fields: AES-256-GCM under a 32-byte key. Kept as a general
 *    primitive; since 0042 no register column uses it (passport numbers are
 *    stored as written, the practice's decision).
 *  - TOTP: RFC 6238, SHA-1/6 digits/30s — what authenticator apps expect.
 */

import { base64Decode, base64Encode } from './ids';

/**
 * Workers refuses more than 100,000 PBKDF2 iterations in a single deriveBits
 * call — it throws NotSupportedError rather than doing the work. Local
 * development does not enforce this, so the cap has to be respected in code.
 */
const MAX_PBKDF2_ITERATIONS = 100_000;

/**
 * The cap is per call, not per password. Chaining rounds — feeding each
 * round's output in as the next round's input — multiplies the work an
 * attacker must repeat, without any single call breaching the platform limit.
 * `PBKDF2_ROUNDS x PBKDF2_ITERATIONS` is therefore the real work factor.
 *
 * One round (100,000) is the most the platform will do in roughly 15ms of CPU,
 * which is what the Workers Free plan allows per request. On the Paid plan the
 * rounds can be raised — six of them reaches the 600,000 OWASP recommends for
 * PBKDF2-SHA256 — and because the parameters are stored inside each hash,
 * raising it re-hashes users transparently as they next sign in.
 */
const PBKDF2_ITERATIONS = MAX_PBKDF2_ITERATIONS;
const PBKDF2_ROUNDS = 1;
const PBKDF2_KEYLEN_BITS = 256;

export const PASSWORD_HASH_PARAMS = {
  rounds: PBKDF2_ROUNDS,
  iterations: PBKDF2_ITERATIONS,
  maxIterationsPerCall: MAX_PBKDF2_ITERATIONS,
} as const;

const enc = new TextEncoder();

async function deriveOnce(material: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', material as BufferSource, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEYLEN_BITS,
  );
  return new Uint8Array(bits);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  rounds: number,
): Promise<Uint8Array> {
  let block: Uint8Array = enc.encode(password);
  for (let i = 0; i < rounds; i++) {
    block = await deriveOnce(block, salt, iterations);
  }
  return block;
}

/** Total iterations a stored hash represents. */
function workFactor(rounds: number, iterations: number): number {
  return rounds * iterations;
}

/**
 * Hash a password. The cost parameters are written into the returned string,
 * so raising them later leaves existing credentials verifiable and lets
 * `passwordNeedsRehash` upgrade them on next sign-in.
 */
export async function hashPassword(
  password: string,
  params: { rounds: number; iterations: number } = PASSWORD_HASH_PARAMS,
): Promise<string> {
  const iterations = Math.min(params.iterations, MAX_PBKDF2_ITERATIONS);
  const rounds = Math.max(1, params.rounds);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations, rounds);
  return `pbkdf2-sha256$${rounds}x${iterations}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

interface HashParams { rounds: number; iterations: number }

/**
 * Read the cost parameters out of a stored hash. Accepts both the current
 * `<rounds>x<iterations>` form and the earlier bare iteration count.
 */
function parseParams(field: string): HashParams | null {
  const [roundsPart, iterationsPart] = field.includes('x')
    ? field.split('x')
    : ['1', field];
  const rounds = Number(roundsPart);
  const iterations = Number(iterationsPart);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 64) return null;
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > MAX_PBKDF2_ITERATIONS) return null;
  return { rounds, iterations };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;

  const params = parseParams(parts[1]!);
  if (!params) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[2]!);
    expected = base64Decode(parts[3]!);
  } catch {
    return false;
  }

  // A stored hash is data, and data can be wrong — truncated by a bad
  // migration, or written by a build with different parameters. A bad row
  // must fail the sign-in, never take the sign-in page down with it.
  try {
    const actual = await pbkdf2(password, salt, params.iterations, params.rounds);
    return timingSafeEqual(actual, expected);
  } catch (err) {
    console.error('password verification failed against a stored hash', err);
    return false;
  }
}

/** True when the hash was made with a weaker work factor than we now use. */
export function passwordNeedsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return true;
  const params = parseParams(parts[1]!);
  if (!params) return true;
  return workFactor(params.rounds, params.iterations) < workFactor(PBKDF2_ROUNDS, PBKDF2_ITERATIONS);
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
