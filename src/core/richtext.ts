/**
 * A small, safe rich-text renderer.
 *
 * Deliberately not Markdown-the-library. A parser that emits HTML would sit in
 * the path of everything a stranger can put in front of the practice through an
 * inbound channel, and in the path of every email that leaves it. This handles
 * the six things people actually type — paragraphs, headings, bullet and
 * numbered lists, bold, italic and links — and every fragment goes through the
 * escaping templates, so text can contain angle brackets and they arrive as
 * angle brackets.
 *
 * The source of truth stays plain text. That matters beyond safety: what is
 * stored is what a person wrote and can read back in the audit log, and the
 * formatted version is derived from it rather than the other way round.
 */

import { html, join, raw, type Raw } from '../ui/html';

/** Bold, italic and links, applied to one line of already-split text. */
function inline(text: string): Raw {
  const parts: Raw[] = [];
  // One pass, longest markers first, so `**bold**` is not read as two italics.
  const pattern = /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(https?:\/\/[^\s<>"')\]]+)/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(html`${text.slice(last, at)}`);
    const [whole, bold, star, underscore, link] = match;

    if (bold) parts.push(html`<strong>${bold.slice(2, -2)}</strong>`);
    else if (star) parts.push(html`<em>${star.slice(1, -1)}</em>`);
    else if (underscore) parts.push(html`<em>${underscore.slice(1, -1)}</em>`);
    else if (link) parts.push(html`<a href="${link}" rel="noopener nofollow">${link}</a>`);

    last = at + whole.length;
  }
  if (last < text.length) parts.push(html`${text.slice(last)}`);
  return join(parts);
}

export function renderRichText(body: string): Raw {
  const blocks: Raw[] = [];

  for (const block of (body ?? '').replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;

    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      blocks.push(html`<ul>${lines.map((l) => html`<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`)}</ul>`);
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      blocks.push(html`<ol>${lines.map((l) => html`<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`)}</ol>`);
      continue;
    }
    if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0]!)) {
      const level = lines[0]!.match(/^#+/)![0].length;
      const text = lines[0]!.replace(/^#{1,3}\s+/, '');
      blocks.push(level === 1 ? html`<h2>${inline(text)}</h2>`
        : level === 2 ? html`<h3>${inline(text)}</h3>`
        : html`<h4>${inline(text)}</h4>`);
      continue;
    }
    blocks.push(html`<p>${join(lines.map((l, i) => (i === 0 ? inline(l) : html`${raw('<br>')}${inline(l)}`)))}</p>`);
  }

  return join(blocks);
}

/**
 * A complete HTML email body.
 *
 * Styles are inline attributes rather than a stylesheet, because that is the
 * only thing mail clients reliably honour — Gmail strips a <style> block in
 * many contexts, and Outlook has its own opinions. Kept to a system font stack
 * and one accent, so it reads as a letter rather than a marketing email.
 *
 * The content still comes from `renderRichText`, so nothing typed into the box
 * can introduce markup of its own.
 */
export function renderEmailHtml(body: string, opts: { accent?: string } = {}): string {
  const accent = /^#[0-9a-f]{6}$/i.test(opts.accent ?? '') ? opts.accent! : '#1d4f76';
  const content = renderRichText(body).value
    .replace(/<p>/g, '<p style="margin:0 0 14px;">')
    .replace(/<h2>/g, `<h2 style="margin:24px 0 8px;font-size:19px;font-weight:600;color:${accent};">`)
    .replace(/<h3>/g, `<h3 style="margin:20px 0 8px;font-size:16px;font-weight:600;color:${accent};">`)
    .replace(/<h4>/g, '<h4 style="margin:18px 0 6px;font-size:15px;font-weight:600;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:20px;">')
    .replace(/<ol>/g, '<ol style="margin:0 0 14px;padding-left:20px;">')
    .replace(/<li>/g, '<li style="margin-bottom:5px;">')
    .replace(/<a /g, `<a style="color:${accent};" `);

  return `<!doctype html>
<html lang="en-NZ"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7f9;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="max-width:640px;background:#ffffff;border:1px solid #d8dee6;border-radius:8px;">
<tr><td style="padding:28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#16202b;">
${content}
</td></tr></table>
</td></tr></table>
</body></html>`;
}
