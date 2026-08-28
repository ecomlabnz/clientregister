import { describe, expect, it } from 'vitest';
import { renderEmailHtml, renderRichText } from '../src/core/richtext';

const out = (s: string) => renderRichText(s).value;

describe('what a message may contain', () => {
  it('escapes markup rather than rendering it', () => {
    expect(out('<script>alert(1)</script>')).not.toContain('<script>');
    expect(out('<b>not bold</b>')).toContain('&lt;b&gt;');
    expect(out('**<img onerror=x>**')).toContain('&lt;img');
  });

  it('escapes inside every construct, not just paragraphs', () => {
    expect(out('- <b>x</b>')).toContain('&lt;b&gt;');
    expect(out('## <b>x</b>')).toContain('&lt;b&gt;');
    expect(out('1. <b>x</b>')).toContain('&lt;b&gt;');
    expect(out('*<b>x</b>*')).toContain('&lt;b&gt;');
  });

  it('links http and https only', () => {
    expect(out('see https://immigration.govt.nz')).toContain('<a href="https://immigration.govt.nz"');
    expect(out('javascript:alert(1)')).not.toContain('<a ');
    expect(out('data:text/html,<script>')).not.toContain('<a ');
  });
});

describe('formatting people actually type', () => {
  it('reads bold before italic, so ** is not two *', () => {
    expect(out('**important**')).toBe('<p><strong>important</strong></p>');
    expect(out('*aside*')).toBe('<p><em>aside</em></p>');
    expect(out('_aside_')).toBe('<p><em>aside</em></p>');
  });

  it('makes paragraphs, headings and both kinds of list', () => {
    expect(out('One.\n\nTwo.')).toBe('<p>One.</p><p>Two.</p>');
    expect(out('# Title')).toBe('<h2>Title</h2>');
    expect(out('## Section')).toBe('<h3>Section</h3>');
    expect(out('### Sub')).toBe('<h4>Sub</h4>');
    expect(out('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(out('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('keeps a single newline as a line break', () => {
    expect(out('Dear Sir,\nThank you.')).toBe('<p>Dear Sir,<br>Thank you.</p>');
  });

  it('renders nothing for nothing', () => {
    expect(out('')).toBe('');
    expect(out('\n\n  \n')).toBe('');
  });
});

describe('the HTML email wrapper', () => {
  const email = renderEmailHtml('Dear Sir,\n\n**Total payable:** $1,000.00\n\n- One\n- Two');

  it('is a complete document a mail client will accept', () => {
    expect(email.startsWith('<!doctype html>')).toBe(true);
    expect(email).toContain('<meta charset="utf-8">');
  });

  it('styles inline, because that is what mail clients honour', () => {
    expect(email).toContain('<p style="margin:0 0 14px;">');
    expect(email).toContain('<li style="margin-bottom:5px;">');
    expect(email).not.toContain('<style');
  });

  it('carries the content through the safe renderer', () => {
    expect(email).toContain('<strong>Total payable:</strong>');
    expect(renderEmailHtml('<script>x</script>')).not.toContain('<script>x</script>');
  });

  it('refuses an accent colour that is not a colour', () => {
    expect(renderEmailHtml('x', { accent: 'red;}</style><script>' })).not.toContain('<script>');
    expect(renderEmailHtml('# T', { accent: '#9a5133' })).toContain('#9a5133');
  });
});
