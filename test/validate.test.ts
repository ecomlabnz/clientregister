import { describe, expect, it } from 'vitest';
import { escapeHtml, FormReader } from '../src/core/validate';
import { html, raw } from '../src/ui/html';

function form(values: Record<string, string>): FormReader {
  return new FormReader(new URLSearchParams(values));
}

describe('FormReader', () => {
  it('trims text and enforces required, min and max', () => {
    const f = form({ name: '  Ana Silva  ', empty: '   ', long: 'x'.repeat(30) });
    expect(f.text('name', { required: true })).toBe('Ana Silva');
    f.text('empty', { required: true, label: 'Empty' });
    f.text('long', { max: 10, label: 'Long' });
    f.text('missing', { required: true, label: 'Missing' });
    expect(f.valid).toBe(false);
    expect(Object.keys(f.errors).sort()).toEqual(['empty', 'long', 'missing']);
    expect(f.errors['missing']).toBe('Missing is required.');
  });

  it('turns a blank optional field into null', () => {
    const f = form({ a: '', b: 'value' });
    expect(f.optional('a')).toBeNull();
    expect(f.optional('b')).toBe('value');
  });

  it('normalises and validates email addresses', () => {
    const ok = form({ e: ' Person@Example.COM ' });
    expect(ok.email('e')).toBe('person@example.com');
    const bad = form({ e: 'not-an-email' });
    expect(bad.email('e', { label: 'Email' })).toBeNull();
    expect(bad.valid).toBe(false);
  });

  it('accepts only listed enum values, with a fallback', () => {
    const f = form({ status: 'active', bogus: 'nope' });
    expect(f.enum('status', ['active', 'archived'] as const)).toBe('active');
    expect(f.enum('missing', ['active'] as const, { fallback: 'active' })).toBe('active');
    expect(f.enum('bogus', ['active'] as const, { label: 'Bogus' })).toBeNull();
    expect(f.valid).toBe(false);
  });

  it('parses money into integer cents, forgiving formatting', () => {
    const f = form({ a: '2500', b: '$1,500.50', c: '0.05', d: 'free' });
    expect(f.money('a')).toBe(250000);
    expect(f.money('b')).toBe(150050);
    expect(f.money('c')).toBe(5);
    expect(f.money('d', { label: 'D' })).toBeNull();
    expect(f.valid).toBe(false);
  });

  it('rejects fractions of a cent', () => {
    const f = form({ a: '10.123' });
    expect(f.money('a')).toBeNull();
    expect(f.valid).toBe(false);
  });

  it('accepts ISO dates only', () => {
    const good = form({ d: '2026-03-01' });
    expect(good.date('d')).toBe('2026-03-01');
    const bad = form({ d: '01/03/2026' });
    expect(bad.date('d', { label: 'Date' })).toBeNull();
    expect(bad.valid).toBe(false);
  });

  it('reads checkboxes', () => {
    const f = form({ on: 'on', off: '' });
    expect(f.bool('on')).toBe(1);
    expect(f.bool('off')).toBe(0);
    expect(f.bool('absent')).toBe(0);
  });

  it('ignores fields a route did not ask for', () => {
    const f = form({ name: 'Ana', role: 'owner' });
    expect(f.text('name')).toBe('Ana');
    // `role` is never read, so it can never reach SQL.
    expect(f.valid).toBe(true);
  });
});

describe('html templating', () => {
  it('escapes interpolated values', () => {
    const evil = '<script>alert(1)</script>';
    expect(html`<p>${evil}</p>`.value)
      .toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes quotes so attributes cannot be broken out of', () => {
    const evil = '" onmouseover="alert(1)';
    const out = html`<a title="${evil}">x</a>`.value;
    expect(out).toBe('<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
  });

  it('renders arrays and skips null, undefined and false', () => {
    expect(html`${[1, 2, 3]}`.value).toBe('123');
    expect(html`${null}${undefined}${false}`.value).toBe('');
  });

  it('passes raw() through unescaped, and nests fragments', () => {
    expect(html`${raw('<b>bold</b>')}`.value).toBe('<b>bold</b>');
    const inner = html`<em>${'<x>'}</em>`;
    expect(html`<p>${inner}</p>`.value).toBe('<p><em>&lt;x&gt;</em></p>');
  });

  it('escapes the five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});
