/** Identifier helpers. IDs are time-sortable so listings order naturally. */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChars(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** e.g. newId('case') -> "case_m1x8k2p0_7fq3n9zt4b" */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomChars(10)}`;
}

/** URL-safe random token, `bytes` bytes of entropy, base64url encoded. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlEncode(buf);
}

export function base64UrlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64Encode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64Decode(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
