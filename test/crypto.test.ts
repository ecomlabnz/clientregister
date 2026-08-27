import { describe, expect, it } from 'vitest';
import {
  base32Decode, base32Encode, generateTotpSecret, hashPassword, hmacSha256Hex,
  passwordNeedsRehash, sealField, sha256Hex, timingSafeEqualStr, unsealField,
  totpCode, verifyPassword, verifyTotp,
} from '../src/core/crypto';
import { base64Encode } from '../src/core/ids';
import { validatePassword } from '../src/core/auth';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('pbkdf2-sha256$600000$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts each hash, so identical passwords differ on disk', async () => {
    const a = await hashPassword('same password here');
    const b = await hashPassword('same password here');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password here', b)).toBe(true);
  });

  it('rejects malformed or hostile stored hashes rather than throwing', async () => {
    for (const bad of ['', 'nonsense', 'pbkdf2-sha256$abc$x$y', 'pbkdf2-sha256$1$x$y',
                       'pbkdf2-sha256$999999999$x$y', 'argon2$1$x$y', 'pbkdf2-sha256$600000$!!!$!!!']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    expect(passwordNeedsRehash(await hashPassword('x'.repeat(12)))).toBe(false);
    expect(passwordNeedsRehash('pbkdf2-sha256$1000$AAAA$BBBB')).toBe(true);
    expect(passwordNeedsRehash('garbage')).toBe(true);
  });

  it('enforces a length-first password policy', () => {
    expect(validatePassword('short')).toMatch(/at least 12/);
    expect(validatePassword('aaaaaaaaaaaaaa')).toMatch(/repeated/);
    expect(validatePassword('a reasonable passphrase')).toBeNull();
    expect(validatePassword('x'.repeat(300))).toMatch(/256/);
  });
});

describe('constant-time comparison', () => {
  it('compares equal and unequal strings correctly', () => {
    expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualStr('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});

describe('sealed fields', () => {
  const key = base64Encode(new Uint8Array(32).fill(7));

  it('round-trips a value', async () => {
    const sealed = await sealField('LM123456', key);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('LM123456');
    expect(await unsealField(sealed, key)).toBe('LM123456');
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    expect(await sealField('LM123456', key)).not.toBe(await sealField('LM123456', key));
  });

  it('returns null for a wrong key, a tampered value or a bad format', async () => {
    const otherKey = base64Encode(new Uint8Array(32).fill(9));
    const sealed = await sealField('LM123456', key);
    expect(await unsealField(sealed, otherKey)).toBeNull();
    expect(await unsealField(`${sealed}AA`, key)).toBeNull();
    expect(await unsealField('not-sealed', key)).toBeNull();
    expect(await unsealField('v1.AAAA', key)).toBeNull();
  });

  it('refuses a key that is not 32 bytes', async () => {
    await expect(sealField('x', base64Encode(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
  });
});

describe('TOTP', () => {
  it('round-trips base32', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('accepts the RFC 6238 reference vector', async () => {
    // RFC 6238 test key "12345678901234567890" at T=59 gives 94287082 (SHA-1, 8 digits);
    // truncated to the 6 digits authenticator apps use, that is 287082.
    const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
    expect(await verifyTotp(secret, '287082', 59_000)).toBe(true);
  });

  it('accepts one step of drift either way and rejects more', async () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    // Generate the code for this instant, then check the neighbouring windows.
    const codeNow = await totpCode(secret, now);
    expect(await verifyTotp(secret, codeNow, now)).toBe(true);
    expect(await verifyTotp(secret, codeNow, now + 30_000)).toBe(true);
    expect(await verifyTotp(secret, codeNow, now - 30_000)).toBe(true);
    expect(await verifyTotp(secret, codeNow, now + 120_000)).toBe(false);
  });

  it('rejects malformed codes and secrets without throwing', async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotp(secret, '12345')).toBe(false);
    expect(await verifyTotp(secret, 'abcdef')).toBe(false);
    expect(await verifyTotp('not base32 !!!', '123456')).toBe(false);
  });
});

describe('digests', () => {
  it('hashes deterministically', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('computes the HMAC Meta uses to sign WhatsApp webhooks', async () => {
    // RFC 4231 test case 1, SHA-256.
    const key = 'Jefe';
    expect(await hmacSha256Hex(key, 'what do ya want for nothing?'))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
});
