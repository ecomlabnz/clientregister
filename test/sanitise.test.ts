import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeUrl, sanitiseHtml } from '../src/core/sanitise';

/**
 * The most hostile text this application renders.
 *
 * An inbound email body comes from outside, is HTML by intent, and is shown to
 * somebody who is signed in. The sanitiser does not clean it — it rebuilds it
 * from an allow-list — so the test that matters is not "is this payload
 * stripped" but "is anything at all emitted that was not deliberately allowed".
 *
 * The payloads below are the standard shapes plus the ones that break naive
 * sanitisers: nesting, malformed tags, entity-encoded schemes, unclosed
 * comments, and content that parses under different rules (SVG, MathML).
 */

const clean = (input: string) => sanitiseHtml(input).html.value;

describe('what survives', () => {
  it('keeps the structure that makes a letter readable', () => {
    const out = clean('<p>Dear <strong>Ms Kaa</strong>,</p><ul><li>One</li><li>Two</li></ul>');
    expect(out).toBe('<p>Dear <strong>Ms Kaa</strong>,</p><ul><li>One</li><li>Two</li></ul>');
  });

  it('keeps a table, which is half of what INZ sends', () => {
    const out = clean('<table><tr><th colspan="2">Dates</th></tr><tr><td>Lodged</td><td>1 May</td></tr></table>');
    expect(out).toContain('<th colspan="2">Dates</th>');
    expect(out).toContain('<td>Lodged</td>');
  });

  it('keeps a link, and sends nothing about where it was clicked from', () => {
    const out = clean('<a href="https://immigration.govt.nz/x">here</a>');
    expect(out).toBe('<a href="https://immigration.govt.nz/x" target="_blank" '
      + 'rel="noopener noreferrer nofollow">here</a>');
  });

  it('escapes text rather than trusting it', () => {
    expect(clean('5 < 6 & 7 > 2')).toBe('5 &lt; 6 &amp; 7 &gt; 2');
  });

  it('shows a bare angle bracket as one', () => {
    expect(clean('a < b')).toContain('a &lt; b');
  });
});

describe('what never does', () => {
  const payloads: Array<[string, string]> = [
    ['a script', '<script>alert(1)</script>'],
    ['a script with attributes', '<script type="text/javascript" src="//evil/x.js"></script>'],
    ['an unclosed script', '<p>hi</p><script>alert(1)'],
    ['an event handler', '<p onclick="alert(1)">text</p>'],
    ['an image with onerror', '<img src=x onerror=alert(1)>'],
    ['a body onload', '<body onload=alert(1)>'],
    ['an svg payload', '<svg><script>alert(1)</script></svg>'],
    ['an svg onload', '<svg/onload=alert(1)>'],
    ['mathml', '<math><mtext><script>alert(1)</script></mtext></math>'],
    ['an iframe', '<iframe src="https://evil"></iframe>'],
    ['an object', '<object data="x"></object>'],
    ['an embed', '<embed src="x">'],
    ['a form', '<form action="/x"><input name="a"></form>'],
    ['a base tag', '<base href="https://evil/">'],
    ['a meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil">'],
    ['a link element', '<link rel="stylesheet" href="https://evil/x.css">'],
    ['a style block', '<style>body{display:none}</style>'],
    ['a style attribute', '<p style="position:fixed;top:0">x</p>'],
    ['a class', '<p class="btn btn-primary">x</p>'],
    ['an id', '<p id="f_password">x</p>'],
    ['a template', '<template><script>alert(1)</script></template>'],
    ['a noscript wrapper', '<noscript><p>x</p></noscript>'],
    ['a textarea holding markup', '<textarea><script>alert(1)</script></textarea>'],
  ];

  for (const [what, payload] of payloads) {
    it(`drops ${what}`, () => {
      const out = clean(payload);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/<(svg|math|iframe|object|embed|form|input|base|meta|link|style|template|body|img)\b/i);
      expect(out).not.toMatch(/\son[a-z]+\s*=/i);
      expect(out).not.toMatch(/\s(style|class|id)\s*=/i);
      expect(out).not.toContain('alert(1)');
    });
  }

  it('drops the contents of a script, not just its tags', () => {
    // Keeping the contents would put the source on the page as text — harmless
    // but noise, and a sign the tag was handled by stripping rather than by
    // being skipped whole.
    expect(clean('<script>var x = 1;</script>')).toBe('');
  });

  it('keeps the prose around something it drops', () => {
    expect(clean('<p>Before</p><script>x</script><p>After</p>'))
      .toBe('<p>Before</p><p>After</p>');
  });

  it('drops a comment, including one that is never closed', () => {
    expect(clean('<p>a</p><!-- <script>alert(1)</script> --><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(clean('<p>a</p><!-- never closed <p>b</p>')).toBe('<p>a</p>');
  });

  it('drops a doctype', () => {
    expect(clean('<!DOCTYPE html><p>a</p>')).toBe('<p>a</p>');
  });
});

describe('links that are not links', () => {
  const bad = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java&#115;cript:alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6a;avascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/clients/cli_1',
    '../admin',
    '#',
  ];

  for (const href of bad) {
    it(`refuses ${JSON.stringify(href)}`, () => {
      expect(safeUrl(href)).toBeNull();
      const out = clean(`<a href="${href.replace(/"/g, '&quot;')}">x</a>`);
      expect(out).not.toContain('href=');
      // And with no href there is nothing to open away from the register.
      expect(out).not.toContain('target=');
      // The anchor goes with it. Blue underlined text that does nothing reads
      // as a broken page rather than as a link that was removed.
      expect(out).toBe('x');
    });
  }

  for (const href of ['https://x.test/a', 'http://x.test', 'mailto:a@b.test', 'tel:+6421234567']) {
    it(`allows ${href}`, () => {
      expect(safeUrl(href)).toBe(href);
    });
  }

  it('does not let an unquoted href smuggle another attribute', () => {
    const out = clean('<a href=https://x.test onclick=alert(1)>x</a>');
    expect(out).toContain('href="https://x.test"');
    expect(out).not.toContain('onclick');
  });

  it('escapes a quote inside a value it keeps', () => {
    // An unescaped double quote would end the attribute early and let whatever
    // follows it become an attribute of its own.
    const out = clean('<a href=\'https://x.test/?a="b\'>x</a>');
    expect(out).toContain('href="https://x.test/?a=&quot;b"');
  });
});

describe('markup that does not close properly', () => {
  it('closes what the message left open, so the page is not swallowed', () => {
    expect(clean('<div><p>hanging')).toBe('<div><p>hanging</p></div>');
  });

  it('ignores a closing tag for something that was never open', () => {
    // Otherwise a stray </div> from a mail client closes the register's own
    // markup and the rest of the page lands inside the message.
    expect(clean('</div></body></html><p>a</p>')).toBe('<p>a</p>');
  });

  it('closes the inner tags when an outer one closes', () => {
    expect(clean('<div><strong>a</div>b')).toBe('<div><strong>a</strong></div>b');
  });

  it('treats a self-closed allowed tag as needing no close', () => {
    expect(clean('<p>a<br/>b</p>')).toBe('<p>a<br>b</p>');
  });
});

describe('size', () => {
  it('stops at the output limit rather than rendering a megabyte', () => {
    const out = clean('<p>' + 'x'.repeat(50_000) + '</p>');
    expect(out.length).toBeLessThan(60_000);
    const capped = sanitiseHtml('<p>' + 'x'.repeat(50_000) + '</p>', 1_000).html.value;
    expect(capped.length).toBeLessThan(1_200);
    // And still closes what it opened.
    expect(capped.endsWith('</p>')).toBe(true);
  });

  it('handles an empty or absent body', () => {
    expect(clean('')).toBe('');
    expect(sanitiseHtml(null).html.value).toBe('');
    expect(sanitiseHtml(undefined).html.value).toBe('');
  });
});

describe('images', () => {
  it('are dropped, and the reader is told', () => {
    // A remote image in a client's email is a tracking pixel as often as it is
    // a logo. The policy blocks it loading; this means the page does not show a
    // row of broken frames either.
    const result = sanitiseHtml('<p>See below</p><img src="https://track/pixel.gif">');
    expect(result.hadImages).toBe(true);
    expect(result.html.value).toBe('<p>See below</p>');
  });

  it('says nothing when there were none', () => {
    expect(sanitiseHtml('<p>plain</p>').hadImages).toBe(false);
  });
});

describe('how it reaches the page', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
  const security = readFileSync('src/core/security.ts', 'utf8');

  it('is the only way a stored body is rendered as markup', () => {
    // `raw()` is the one unescaped insertion in the codebase, and the point of
    // grepping for it is that this stays true.
    expect(inbox).toContain('sanitiseHtml(msg.body_html)');
    expect(inbox).toContain('sanitiseHtml(entry.bodyHtml).html');
    expect(inbox).not.toMatch(/raw\(\s*(msg|entry)\.body/);
  });

  it('leaves the plain text one click away, and always available', () => {
    expect(inbox).toContain('href="?plain=1"');
    expect(inbox).toContain("c.req.query('plain') === '1'");
  });

  it('sits under a policy that runs no script and loads no remote image', () => {
    // Not what makes this safe — the rebuild above is — but the second layer,
    // and the reason a tracking pixel cannot report that a letter was read.
    expect(security).toContain("script-src 'self'");
    expect(security).toContain("style-src 'self'");
    expect(security).toContain("img-src 'self' data:");
    expect(security).toContain("default-src 'none'");
  });
});
