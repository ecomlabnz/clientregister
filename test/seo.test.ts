import { describe, expect, it } from 'vitest';
import { __internal } from '../src/modules/landing';

const { jsonLdSafe, escapeXml, canonicalBaseFrom } = __internal;

describe('JSON-LD cannot break out of its script element', () => {
  it('escapes the characters that could close the tag', () => {
    const evil = JSON.stringify({ name: '</script><script>alert(1)</script>' });
    const safe = jsonLdSafe(evil);
    expect(safe).not.toContain('</script>');
    expect(safe).not.toContain('<');
    expect(safe).toContain('\\u003c');
  });

  it('leaves the JSON parseable, with the value intact', () => {
    const safe = jsonLdSafe(JSON.stringify({ name: 'Smith & Co <NZ>' }));
    expect(JSON.parse(safe)).toEqual({ name: 'Smith & Co <NZ>' });
  });
});

describe('XML escaping for the sitemap', () => {
  it('escapes the five entities', () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
  });
});

describe('choosing the address to publish', () => {
  it('prefers a configured origin over the one the request arrived on', () => {
    expect(canonicalBaseFrom('https://immigration.kiwi', 'https://x.workers.dev'))
      .toBe('https://immigration.kiwi');
  });

  it('drops a trailing slash so links are not doubled', () => {
    expect(canonicalBaseFrom('https://immigration.kiwi/', 'https://x.workers.dev'))
      .toBe('https://immigration.kiwi');
  });

  it('falls back when the setting is blank or not an origin', () => {
    for (const junk of ['', '   ', 'immigration.kiwi', 'https://a.nz/path', 'javascript:alert(1)']) {
      expect(canonicalBaseFrom(junk, 'https://x.workers.dev')).toBe('https://x.workers.dev');
    }
  });
});
