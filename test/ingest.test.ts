import { describe, expect, it } from 'vitest';
import { allowList, digitsOnly, isAllowed } from '../src/ingest/pipeline';
import { parseInboundEmail, stripHtml } from '../src/ingest/email';
import { safeReturn } from '../src/modules/tasks';
import { safeFilename } from '../src/modules/documents';
import { normaliseTriage, parseTriageJson } from '../src/ai/provider';

describe('channel allow-lists', () => {
  it('matches case-insensitively and ignores surrounding space', () => {
    const list = allowList(' Me@Example.com , other@example.com ');
    expect(list).toEqual(['me@example.com', 'other@example.com']);
    expect(isAllowed(list, 'ME@EXAMPLE.COM')).toBe(true);
    expect(isAllowed(list, 'stranger@example.com')).toBe(false);
  });

  it('treats an unset or empty list as allowing nobody', () => {
    expect(allowList(undefined)).toEqual([]);
    expect(allowList('')).toEqual([]);
    expect(allowList(' , , ')).toEqual([]);
    expect(isAllowed([], 'anyone@example.com')).toBe(false);
  });

  it('never trusts a null or empty sender', () => {
    const list = allowList('me@example.com');
    expect(isAllowed(list, null)).toBe(false);
    expect(isAllowed(list, '')).toBe(false);
  });

  it('compares phone numbers by digits only', () => {
    const list = allowList('+64 21 234 5678, 6499999999', digitsOnly);
    expect(list).toEqual(['64212345678', '6499999999']);
    expect(isAllowed(list, '+64-21-234-5678', digitsOnly)).toBe(true);
    expect(isAllowed(list, '64212345679', digitsOnly)).toBe(false);
  });
});

describe('email parsing', () => {
  it('extracts sender, subject and body from a raw message', async () => {
    const raw = [
      'From: Ana Silva <ana@example.com>',
      'To: cases@practice.example',
      'Subject: Work visa question',
      'Message-ID: <abc123@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hi, my visa expires on 3 March. Can you help?',
      '',
    ].join('\r\n');

    const parsed = await parseInboundEmail(new TextEncoder().encode(raw).buffer as ArrayBuffer);
    expect(parsed.fromAddress).toBe('ana@example.com');
    expect(parsed.fromName).toBe('Ana Silva');
    expect(parsed.subject).toBe('Work visa question');
    expect(parsed.text).toContain('my visa expires on 3 March');
    expect(parsed.messageId).toContain('abc123');
  });

  it('falls back to the HTML part when there is no text part', async () => {
    const raw = [
      'From: b@example.com',
      'Subject: HTML only',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>Hello</p><p>World</p></body></html>',
      '',
    ].join('\r\n');
    const parsed = await parseInboundEmail(new TextEncoder().encode(raw).buffer as ArrayBuffer);
    expect(parsed.text).toContain('Hello');
    expect(parsed.text).toContain('World');
    expect(parsed.text).not.toContain('<p>');
  });

  it('strips scripts and styles rather than carrying them into the register', () => {
    const out = stripHtml('<style>b{}</style><script>alert(1)</script><p>Safe &amp; sound</p>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('b{}');
    expect(out).toContain('Safe & sound');
  });
});

describe('redirect and filename safety', () => {
  it('only allows same-site paths in return_to', () => {
    expect(safeReturn('/cases/abc')).toBe('/cases/abc');
    expect(safeReturn('https://evil.example/x')).toBe('/tasks');
    expect(safeReturn('//evil.example/x')).toBe('/tasks');
    expect(safeReturn('')).toBe('/tasks');
    expect(safeReturn(null)).toBe('/tasks');
    expect(safeReturn(undefined, '/documents')).toBe('/documents');
  });

  it('reduces uploaded filenames to safe characters', () => {
    expect(safeFilename('passport scan.pdf')).toBe('passport_scan.pdf');
    expect(safeFilename('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFilename('..')).toBe('file');
    expect(safeFilename('')).toBe('file');
    expect(safeFilename('a'.repeat(300)).length).toBe(200);
  });
});

describe('AI triage output handling', () => {
  it('parses JSON out of a fenced or chatty response', () => {
    const result = parseTriageJson('Sure!\n```json\n{"summary":"Visa query","urgency":"high"}\n```\nHope that helps.');
    expect(result.summary).toBe('Visa query');
    expect(result.urgency).toBe('high');
  });

  it('rejects a response with no JSON at all', () => {
    expect(() => parseTriageJson('I cannot help with that.')).toThrow(/no JSON/);
  });

  it('normalises missing, oversized and unexpected fields', () => {
    const result = normaliseTriage({
      contact_name: '  Ana  ',
      summary: 'x'.repeat(1000),
      urgency: 'catastrophic' as never,
      key_dates: ['2026-03-01', 42 as never],
      is_spam: 'yes' as never,
    });
    expect(result.contact_name).toBe('Ana');
    expect(result.summary.length).toBe(300);
    expect(result.urgency).toBe('normal');
    expect(result.key_dates).toEqual(['2026-03-01']);
    expect(result.is_spam).toBe(false);
    expect(result.contact_email).toBeNull();
  });
});
