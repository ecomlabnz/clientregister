/**
 * The email sanitiser, attacked as an adversary would.
 *
 * `sanitise.test.ts` pins specific behaviours by example. This is the other
 * half: a corpus of hostile inputs run through one invariant — the output is
 * *inert*. Nothing an email can contain may come out as a script, an event
 * handler, a dangerous URL scheme, or one of the elements whose content the
 * browser parses by different rules (svg, math, style, template, …).
 *
 * The value is in the list. When a new class of attack is learned, add the
 * payload to PAYLOADS; the invariant already knows how to judge it. A payload
 * that ever produces non-inert output is either a real hole or a gap in
 * `assertInert`, and both are worth a failing test.
 */

import { describe, expect, it } from 'vitest';
import { sanitiseHtml, safeUrl } from '../src/core/sanitise';

/** Tags that must never appear in output, whatever the input did. */
const FORBIDDEN_TAGS = [
  'script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'template',
  'noscript', 'base', 'link', 'meta', 'form', 'input', 'button', 'textarea',
  'xmp', 'title', 'frame', 'frameset', 'applet', 'audio', 'video', 'img',
];

const ALLOWED_SCHEME = /^(https?:|mailto:|tel:)/i;
const TAB = '\t';
const NL = '\n';
const NUL = '\x00';

/** Throw if the sanitised HTML carries anything a browser could act on. */
function assertInert(out: string): void {
  const lower = out.toLowerCase();
  for (const tag of FORBIDDEN_TAGS) {
    expect(lower.includes('<' + tag), `emitted <${tag}>: ${out}`).toBe(false);
  }
  // Attribute *values* are checked separately below; blank them out first so a
  // handler-shaped or scheme-shaped substring sitting harmlessly inside a
  // quoted value (e.g. an escaped `&quot; onclick=` inside an href) is not
  // mistaken for a real attribute. A browser would not read it as one.
  const skeleton = out.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  // No inline event handlers (onclick, onerror, onmouseover, …) as real attributes.
  expect(/\son[a-z]+\s*=/i.test(skeleton), `event handler attribute: ${out}`).toBe(false);
  // No style/class/id ever ride along (layout belongs to the page).
  expect(/\s(style|class|id)\s*=/i.test(skeleton), `layout attribute leaked: ${out}`).toBe(false);
  // Every href that survives points at an allowed scheme — no javascript:,
  // vbscript:, data:, or a bare relative link back into the register. Entities
  // and control/space characters are removed first, as a browser removes them
  // before reading the scheme.
  for (const m of out.matchAll(/href="([^"]*)"/gi)) {
    const value = m[1]!.replace(/&#x?[0-9a-f]+;?/gi, '').replace(/[\x00-\x20]+/g, '');
    expect(ALLOWED_SCHEME.test(value), `href not an allowed scheme: ${m[1]}`).toBe(true);
  }
}

const PAYLOADS: Array<[label: string, input: string]> = [
  ['plain script', '<script>alert(1)</script>'],
  ['img onerror', '<img src=x onerror=alert(1)>'],
  ['svg onload', '<svg onload=alert(1)>'],
  ['svg script', '<svg><script>alert(1)</script></svg>'],
  ['svg foreignObject', '<svg><foreignObject><body onload=alert(1)></foreignObject></svg>'],
  ['math mtext', '<math><mtext><script>alert(1)</script></mtext></math>'],
  ['mglyph mutation', '<math><mtext><mglyph><style><img src=x onerror=alert(1)></style>'],
  ['style import', "<style>@import 'evil.css';</style>"],
  ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['object data', '<object data="javascript:alert(1)"></object>'],
  ['a javascript', '<a href="javascript:alert(1)">x</a>'],
  ['a JavaScript case', '<a href="JaVaScRiPt:alert(1)">x</a>'],
  ['a js entity colon', '<a href="javascript&colon;alert(1)">x</a>'],
  ['a js numeric entity', '<a href="&#106;avascript:alert(1)">x</a>'],
  ['a js hex entity', '<a href="&#x6a;avascript:alert(1)">x</a>'],
  ['a js tab', '<a href="java' + TAB + 'script:alert(1)">x</a>'],
  ['a js newline', '<a href="java' + NL + 'script:alert(1)">x</a>'],
  ['a js nul', '<a href="java' + NUL + 'script:alert(1)">x</a>'],
  ['a vbscript', '<a href="vbscript:msgbox(1)">x</a>'],
  ['a data html', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['a relative', '<a href="/inquiries/secret">x</a>'],
  ['a protocol-relative', '<a href="//evil.test/x">x</a>'],
  ['single-quote breakout', "<a href='https://ok/\" onmouseover=alert(1)'>x</a>"],
  ['p onclick', '<p onclick="alert(1)">x</p>'],
  ['p style', '<p style="position:fixed">x</p>'],
  ['div class id', '<div class="page-owned" id="x">y</div>'],
  ['comment abrupt close', '<!--><img src=x onerror=alert(1)>'],
  ['conditional comment', '<!--[if IE]><script>alert(1)</script><![endif]-->'],
  ['svg comment close', '<svg><!-- </svg> --><img src=x onerror=alert(1)>'],
  ['slash in tag', '<img/src=x onerror=alert(1)>'],
  ['unclosed tag', '<a href="javascript:alert(1)"'],
  ['spaced scheme', 'java script:alert(1)'],
  ['nested anchors', '<a href="javascript:alert(1)"><a href="https://ok">x</a></a>'],
  ['base tag', '<base href="javascript:alert(1)//">'],
  ['form action', '<form action="javascript:alert(1)"><input></form>'],
  ['textarea escape', '<textarea></textarea><img src=x onerror=alert(1)>'],
  ['noscript escape', '<noscript><p>x</p></noscript><img src=x onerror=alert(1)>'],
  ['xmp escape', '<xmp></xmp><img src=x onerror=alert(1)>'],
  ['bare gt lt prose', '1 < 2 and 3 > 2 and <notarealtag foo=bar>'],
  ['uppercase SCRIPT', '<SCRIPT>alert(1)</SCRIPT>'],
  ['mixed case ImG', '<ImG SrC=x OnErRoR=alert(1)>'],
  ['entity-encoded tag', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['deep nesting', '<div>'.repeat(500) + '<img src=x onerror=alert(1)>' + '</div>'.repeat(500)],
];

describe('the sanitiser output is inert for every hostile input', () => {
  for (const [label, input] of PAYLOADS) {
    it(label, () => {
      assertInert(String(sanitiseHtml(input).html));
    });
  }

  it('leaves a legitimate letter recognisable', () => {
    const out = String(sanitiseHtml(
      '<p>Dear practice,</p><p>Please see the <a href="https://immigration.govt.nz">schedule</a>:</p>'
      + '<ul><li>Passport</li><li>Photos</li></ul>',
    ).html);
    expect(out).toContain('<p>');
    expect(out).toContain('<ul>');
    expect(out).toContain('href="https://immigration.govt.nz"');
    assertInert(out);
  });
});

describe('the output budget never leaves a partial tag', () => {
  // Finding 4 of the 2026-08-30 audit: `push` charged the budget with what it
  // was offered rather than what it emitted, and would slice a rebuilt tag
  // mid-token — leaving live markup like `<a href="…` open at the cut. A tag
  // now goes out whole or not at all.
  const letter = 'Dear practice, <strong>please</strong> see the '
    + '<a href="https://immigration.govt.nz/forms">form</a> attached.';

  it('every cut point drops tags whole and stays inert', () => {
    for (let limit = 1; limit <= letter.length + 60; limit++) {
      const out = String(sanitiseHtml(letter, limit).html);
      // Once every complete tag is removed, no raw "<" may remain: a leftover
      // one is a tag the budget cut in half.
      const stripped = out.replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/gi, '');
      expect(stripped.includes('<'), `partial tag under limit ${limit}: ${out}`).toBe(false);
      assertInert(out);
    }
  });
});

describe('safeUrl accepts only navigable schemes', () => {
  const ACCEPT = ['https://x', 'HTTP://X', 'https://a?b=c#d', 'mailto:a@b.test', 'tel:+64211234567'];
  const REJECT = [
    'javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)',
    'vbscript:x', 'data:text/html,<script>', '//evil.test', '/relative',
    'jav&#x61;script:x', 'file:///etc/passwd',
  ];
  for (const u of ACCEPT) it('accepts ' + JSON.stringify(u), () => expect(safeUrl(u)).not.toBeNull());
  for (const u of REJECT) it('rejects ' + JSON.stringify(u), () => expect(safeUrl(u)).toBeNull());
});
