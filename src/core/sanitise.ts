/**
 * Rendering an email the way it was written, without letting it write the page.
 *
 * The body of an inbound message is the most hostile text this application
 * touches: it comes from outside, it is HTML by intent, and it is displayed to
 * somebody who is signed in. Everything here exists to make showing it as safe
 * as showing plain text.
 *
 * Two layers, because one is never enough.
 *
 *  1. This file. Nothing is "cleaned"; the output is *rebuilt* from a
 *     token-by-token read of the input. A tag survives only if its name is on
 *     the list below, an attribute only if it is on the list for that tag and
 *     its value passes the check for it. Anything unrecognised — a tag, a
 *     comment, a stray `<` — becomes escaped text. There is no path by which a
 *     construct nobody thought of is emitted verbatim, which is the failure
 *     mode every regex-based sanitiser has.
 *
 *  2. The content security policy, which this does not rely on but is glad of:
 *     `default-src 'none'` with `script-src 'self'` and `style-src 'self'`
 *     means an inline script never runs, an inline style never applies, and a
 *     frame never loads, even if something got through here. `img-src 'self'
 *     data:` means a remote image cannot load — so a tracking pixel in a
 *     client's email cannot report back that it was read. Images are dropped
 *     here as well, and the reader is told, rather than left with a page of
 *     broken frames.
 *
 * What this is not: a renderer. Layout, colour and typography are the page's,
 * not the sender's. `style`, `class` and `id` never survive. An email is shown
 * with its structure — paragraphs, lists, tables, links, emphasis — in the
 * register's own type.
 */

import { Raw, raw } from '../ui/html';
import { escapeHtml } from './validate';

/** Structure worth keeping. Everything else is dropped. */
const ALLOWED = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'a',
  'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'pre', 'code', 'hr', 'small', 'sub', 'sup', 'dl', 'dt', 'dd',
]);

/** Tags with no closing half, so nothing is pushed on the stack for them. */
const VOID = new Set(['br', 'hr']);

/**
 * Elements whose *content* is not markup and must go with them.
 *
 * Dropping `<script>` while keeping what is inside it would put the script's
 * source on the page as text — harmless, but noise — and for `<style>` it would
 * put a stylesheet in the middle of the letter. `svg` and `math` are here
 * because their content follows different parsing rules from HTML, which is
 * where sanitisers are usually broken.
 */
const OPAQUE = new Set(['script', 'style', 'svg', 'math', 'template', 'iframe',
  'object', 'embed', 'noscript', 'head', 'title', 'textarea', 'xmp']);

/** What may survive on which tag, and what its value has to look like. */
const ATTRIBUTES: Record<string, Record<string, (value: string) => string | null>> = {
  a: { href: safeUrl },
  td: { colspan: digits, rowspan: digits },
  th: { colspan: digits, rowspan: digits },
};

function digits(value: string): string | null {
  return /^\d{1,3}$/.test(value.trim()) ? value.trim() : null;
}

/**
 * A link that goes where it says.
 *
 * The scheme is checked after entities and control characters are removed,
 * because `java&#115;cript:` and `java<tab>script:` are both read as
 * `javascript:` by a browser. Anything not plainly http, https, mailto or tel
 * is dropped — including a relative link, which in an email means nothing and
 * in this application would point at the register.
 */
export function safeUrl(value: string): string | null {
  const collapsed = value
    .replace(/&#[xX]?[0-9a-fA-F]+;?/g, (m) => decodeEntity(m))
    .replace(/[\u0000-\u0020\u00a0\u2000-\u200f\ufeff]+/g, '')
    .toLowerCase();
  if (!/^(https?:|mailto:|tel:)/.test(collapsed)) return null;
  return value.trim();
}

function decodeEntity(entity: string): string {
  const hex = /^&#[xX]([0-9a-fA-F]+);?$/.exec(entity);
  const dec = /^&#(\d+);?$/.exec(entity);
  const code = hex ? parseInt(hex[1]!, 16) : dec ? parseInt(dec[1]!, 10) : NaN;
  return Number.isFinite(code) ? String.fromCodePoint(code) : '';
}

export interface SanitisedHtml {
  html: Raw;
  /** True when the original carried images, so the reader can be told they are not shown. */
  hadImages: boolean;
}

/**
 * Rebuild a fragment of HTML from what is allowed in it.
 *
 * `limit` caps the *output*, not the input: a message can be as long as it
 * likes and the page still ends where the page ends.
 */
export function sanitiseHtml(input: string | null | undefined, limit = 200_000): SanitisedHtml {
  const source = input ?? '';
  const out: string[] = [];
  const open: string[] = [];
  let hadImages = false;
  let i = 0;
  let size = 0;

  // The budget is spent per push, not merely checked between them: one run of
  // text can be the whole message, and a limit that only applies at the top of
  // the loop is a limit that never applies to the case it exists for.
  const push = (text: string) => {
    const room = limit - size;
    if (room <= 0) return;
    out.push(text.length > room ? text.slice(0, room) : text);
    size += text.length;
  };

  while (i < source.length && size < limit) {
    const lt = source.indexOf('<', i);
    if (lt === -1) { push(escapeHtml(source.slice(i))); break; }
    if (lt > i) push(escapeHtml(source.slice(i, lt)));

    // A comment, a doctype or a processing instruction: skipped whole. An
    // unterminated one swallows the rest, which is the safe direction.
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', lt) || source.startsWith('<?', lt)) {
      const end = source.indexOf('>', lt + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const tag = readTag(source, lt);
    if (!tag) {
      // Not a tag at all — a bare "<" in the prose. Shown as one.
      push('&lt;');
      i = lt + 1;
      continue;
    }

    if (tag.name === 'img') hadImages = true;

    if (OPAQUE.has(tag.name)) {
      i = tag.closing ? tag.end : skipOpaque(source, tag);
      continue;
    }

    if (!ALLOWED.has(tag.name)) { i = tag.end; continue; }

    if (tag.closing) {
      // Only closes something actually open, so a stray "</div>" from a mail
      // client cannot close the page's own markup around it.
      const at = open.lastIndexOf(tag.name);
      if (at !== -1) {
        // Straight onto the output, not through the budget. A closing tag is
        // not content: dropping one because the message has run out of room
        // leaves the page holding an element the message opened.
        for (let k = open.length - 1; k >= at; k--) out.push(`</${open[k]}>`);
        open.length = at;
      }
      i = tag.end;
      continue;
    }

    const attrs = attributesFor(tag);
    // A link whose address was refused is not a link. Emitting the anchor
    // anyway would give the reader blue underlined text that does nothing —
    // which reads as a broken page rather than as a link that was removed. The
    // words stay; a stray closing tag is already ignored.
    if (tag.name === 'a' && attrs === '') { i = tag.end; continue; }

    push(`<${tag.name}${attrs}>`);
    if (!VOID.has(tag.name) && !tag.selfClosing) open.push(tag.name);
    i = tag.end;
  }

  for (let k = open.length - 1; k >= 0; k--) out.push(`</${open[k]}>`);
  return { html: raw(out.join('')), hadImages };
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
  end: number;
}

/** Read one tag starting at `<`, or null when this is not one. */
function readTag(source: string, at: number): Tag | null {
  const rest = source.slice(at);
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(rest);
  if (!match) return null;
  const attrs = match[3] ?? '';
  return {
    name: match[2]!.toLowerCase(),
    closing: match[1] === '/',
    selfClosing: /\/\s*$/.test(attrs),
    attrs,
    end: at + match[0].length,
  };
}

/** Everything up to the matching close tag, or the end of the input. */
function skipOpaque(source: string, tag: Tag): number {
  if (tag.selfClosing) return tag.end;
  const close = new RegExp(`</${tag.name}\\s*>`, 'i');
  const found = close.exec(source.slice(tag.end));
  return found ? tag.end + found.index + found[0].length : source.length;
}

/** The attributes this tag is allowed to keep, rewritten from their values. */
function attributesFor(tag: Tag): string {
  const allowed = ATTRIBUTES[tag.name];
  const kept: string[] = [];
  if (allowed) {
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(tag.attrs)) !== null) {
      const name = m[1]!.toLowerCase();
      const check = allowed[name];
      if (!check) continue;
      const value = m[3] ?? m[4] ?? m[5] ?? '';
      const safe = check(value);
      if (safe !== null) kept.push(` ${name}="${escapeHtml(safe)}"`);
    }
  }
  // A link opens away from the register and tells the other end nothing about
  // where it was clicked from.
  if (tag.name === 'a' && kept.some((a) => a.startsWith(' href='))) {
    kept.push(' target="_blank" rel="noopener noreferrer nofollow"');
  }
  return kept.join('');
}
