import { describe, expect, it } from 'vitest';
import {
  base32Decode, base32Encode, generateTotpSecret, hashPassword, hmacSha256Hex,
  passwordNeedsRehash, sha256Hex, timingSafeEqualStr,
  PASSWORD_HASH_PARAMS, totpCode, verifyPassword, verifyTotp,
} from '../src/core/crypto';
import { base64Encode } from '../src/core/ids';
import { validatePassword } from '../src/core/auth';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('pbkdf2-sha256$1x100000$')).toBe(true);
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

  it('never asks the platform for more iterations than it will do', async () => {
    // Cloudflare Workers throws NotSupportedError above 100,000 iterations in a
    // single deriveBits call. Local development does not enforce this, so the
    // only thing standing between a working sign-in and a 500 is this check.
    expect(PASSWORD_HASH_PARAMS.maxIterationsPerCall).toBe(100_000);
    expect(PASSWORD_HASH_PARAMS.iterations).toBeLessThanOrEqual(PASSWORD_HASH_PARAMS.maxIterationsPerCall);

    const hash = await hashPassword('a reasonable passphrase');
    const perCall = Number(hash.split('$')[1]!.split('x')[1]);
    expect(perCall).toBeLessThanOrEqual(PASSWORD_HASH_PARAMS.maxIterationsPerCall);
  });

  it('clamps a caller who asks for more iterations than the platform allows', async () => {
    const hash = await hashPassword('a reasonable passphrase', { rounds: 1, iterations: 600_000 });
    expect(hash).toContain('$1x100000$');
    expect(await verifyPassword('a reasonable passphrase', hash)).toBe(true);
  });

  it('reaches a higher work factor by chaining rounds', async () => {
    const hash = await hashPassword('a reasonable passphrase', { rounds: 3, iterations: 20_000 });
    expect(hash).toContain('$3x20000$');
    expect(await verifyPassword('a reasonable passphrase', hash)).toBe(true);
    expect(await verifyPassword('a different passphrase', hash)).toBe(false);
  });

  it('still verifies hashes written in the older single-count format', async () => {
    // Same derivation as one round, so a bare count must remain readable.
    const chained = await hashPassword('a reasonable passphrase', { rounds: 1, iterations: 50_000 });
    const [, , salt, digest] = chained.split('$');
    const legacy = `pbkdf2-sha256$50000$${salt}$${digest}`;
    expect(await verifyPassword('a reasonable passphrase', legacy)).toBe(true);
  });

  it('rejects a stored hash whose parameters the platform could not run', async () => {
    // Rather than throwing and turning the sign-in page into a 500.
    const impossible = 'pbkdf2-sha256$1x600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    expect(await verifyPassword('anything', impossible)).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2-sha256$0x50000$AA==$AA==')).toBe(false);
    expect(await verifyPassword('anything', 'pbkdf2-sha256$999x50000$AA==$AA==')).toBe(false);
  });

  it('flags hashes made with weaker parameters for rehashing', async () => {
    expect(passwordNeedsRehash(await hashPassword('x'.repeat(12)))).toBe(false);
    expect(passwordNeedsRehash('pbkdf2-sha256$1x1000$AAAA$BBBB')).toBe(true);
    expect(passwordNeedsRehash('garbage')).toBe(true);
    // A higher work factor than we currently use does not need redoing.
    expect(passwordNeedsRehash('pbkdf2-sha256$6x100000$AAAA$BBBB')).toBe(false);
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
