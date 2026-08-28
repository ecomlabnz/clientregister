import { describe, expect, it } from 'vitest';
import { base64Url, buildMimeMessage } from '../src/mail/gmail';

const basic = { to: 'client@example.nz', subject: 'Your quote', text: 'Attached.' };

describe('building a Gmail message', () => {
  it('writes the headers Gmail needs', () => {
    const mime = buildMimeMessage(basic, 'Practice <practice@example.nz>');
    expect(mime).toContain('From: Practice <practice@example.nz>');
    expect(mime).toContain('To: client@example.nz');
    expect(mime).toContain('Subject: Your quote');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime.split('\r\n\r\n').at(-1)).toBe('Attached.');
  });

  it('includes Cc only when there is one', () => {
    expect(buildMimeMessage(basic, 'a@b.nz')).not.toContain('Cc:');
    expect(buildMimeMessage({ ...basic, cc: 'other@example.nz' }, 'a@b.nz')).toContain('Cc: other@example.nz');
  });

  it('refuses to let a newline in a header start another one', () => {
    const mime = buildMimeMessage(
      { ...basic, subject: 'Quote\r\nBcc: attacker@evil.example', to: 'ok@example.nz\nBcc: also@evil.example' },
      'a@b.nz',
    );
    const headers = mime.split('\r\n\r\n')[0]!;
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers.split('\r\n').filter((l) => l.startsWith('To:'))).toHaveLength(1);
  });

  it('encodes a subject that is not plain ASCII', () => {
    const mime = buildMimeMessage({ ...basic, subject: 'Tēnā koe — your visa' }, 'a@b.nz');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(mime).not.toContain('Tēnā koe');
  });

  it('sends both parts when there is HTML, with a boundary that closes', () => {
    const mime = buildMimeMessage({ ...basic, html: '<p>Attached.</p>' }, 'a@b.nz');
    const boundary = mime.match(/boundary="([^"]+)"/)?.[1];
    expect(boundary).toBeTruthy();
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime).toContain(`--${boundary}--`);
  });
});

describe('base64url for the Gmail API', () => {
  it('uses the URL alphabet and drops padding', () => {
    expect(base64Url('subjects?>>')).not.toMatch(/[+/=]/);
  });

  it('round-trips through the standard decoder', () => {
    const text = 'Subject: Tēnā koe\r\n\r\nBody';
    const standard = base64Url(text).replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
    expect(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))).toBe(text);
  });
});
