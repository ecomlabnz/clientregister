/**
 * The quotation email is the practice's letter, and nothing goes out unseen.
 *
 * **Asked for on 11 September 2026:** *"where do i change my email template when
 * quotation is going out to client?"* Nowhere — it was written in TypeScript,
 * and the only way to change a word was to retype it in the compose box for
 * every client, where it was forgotten again by the next quotation.
 *
 * And then, on what a misspelled placeholder should do: *"as printed - but good
 * point - must have PREVIEW page before it goes out with an additional send
 * button, so PREVIEW button and on the preview screen - send button or go back
 * to edit"*.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fillTemplate, tidyBlankLines, unknownPlaceholders } from '../src/core/template';

describe('filling a letter', () => {
  const values = { client_name: 'A Person', total: '$1,000.00' };

  it('replaces what it knows', () => {
    expect(fillTemplate('Dear {client_name},', values)).toBe('Dear A Person,');
  });

  it('replaces every occurrence, not only the first', () => {
    expect(fillTemplate('{client_name} and {client_name}', values)).toBe('A Person and A Person');
  });

  it('prints an unknown placeholder exactly as written', () => {
    // The practice's decision, and the right one: a hole in a letter reads as
    // finished prose, and the eye slides over it. `{clietn_name}` does not.
    expect(fillTemplate('Dear {clietn_name},', values)).toBe('Dear {clietn_name},');
  });

  it('leaves a known placeholder out when its value is genuinely empty', () => {
    // A quotation with no closing date must not print the word "undefined",
    // and the sentence around it is written to survive the absence.
    expect(fillTemplate('{closing_date} {capacity}', { closing_date: '', capacity: 'Subject to capacity.' }))
      .toBe(' Subject to capacity.');
  });

  it('is not a programming language', () => {
    // No expressions, no conditionals, no capitals, no spaces. Anything that is
    // not a bare lower-case name in braces is text.
    for (const odd of ['{Client_Name}', '{client name}', '{ client_name }', '{}']) {
      expect(fillTemplate(odd, values), odd).toBe(odd);
    }
  });

  it('has no escape, and double braces are not one', () => {
    // Worth pinning rather than leaving to be discovered: `{{client_name}}`
    // fills the inner pair and leaves the outer braces, so it comes out as
    // `{A Person}`. There is nowhere in this letter that needs a literal brace,
    // and inventing an escape would be the first step towards a language.
    expect(fillTemplate('{{client_name}}', values)).toBe('{A Person}');
  });

  it('does not fill a value that happens to contain a placeholder', () => {
    // Otherwise a client called "{total}" would rewrite the letter.
    expect(fillTemplate('{client_name}', { client_name: '{total}', total: 'x' })).toBe('{total}');
  });
});

describe('naming what could not be filled', () => {
  const values = { client_name: 'A Person' };

  it('lists the misspelling', () => {
    expect(unknownPlaceholders('Dear {clietn_name}, {client_name}', values)).toEqual(['clietn_name']);
  });

  it('lists each one once, in order', () => {
    expect(unknownPlaceholders('{b} {a} {b}', values)).toEqual(['a', 'b']);
  });

  it('says nothing when the letter is right', () => {
    expect(unknownPlaceholders('Dear {client_name},', values)).toEqual([]);
  });
});

describe('the blank lines a filled letter leaves behind', () => {
  it('collapses a gap where an empty paragraph was', () => {
    expect(tidyBlankLines('One\n\n\n\nTwo')).toBe('One\n\nTwo');
  });

  it('keeps a single blank line, because that is a paragraph break', () => {
    expect(tidyBlankLines('One\n\nTwo')).toBe('One\n\nTwo');
  });

  it('removes trailing spaces, which a mail client would keep', () => {
    expect(tidyBlankLines('One   \nTwo\t')).toBe('One\nTwo');
  });

  it('does not leave the letter starting or ending on blank lines', () => {
    expect(tidyBlankLines('\n\nDear,\n\n\n')).toBe('Dear,');
  });
});

/**
 * The screen, and the rule that nothing leaves it unseen.
 */
describe('the compose and preview screens', () => {
  const source = readFileSync('src/modules/quotes/index.ts', 'utf8');

  it('sends nobody anywhere from the compose form', () => {
    // The compose form posts to the preview, never to the send route. A
    // preview somebody can skip is decoration.
    const tag = source.split('\n').find((l) => l.includes('class="compose js-compose"'))!;
    expect(tag, 'the compose form is gone').toBeTruthy();
    expect(tag).toContain('/email/preview');
  });

  it('offers Preview rather than a send button', () => {
    expect(source).toContain('>Preview</button>');
  });

  it('carries the edited words back when the practice goes to edit again', () => {
    // Otherwise "Back to edit" throws away what was written and hands back the
    // template, which is the fastest way to make a preview screen hated.
    expect(source).toContain('const draft = c.req.query(\'body\');');
    expect(source).toContain('const draftSubject = c.req.query(\'subject\');');
    expect(source).toContain('body=${encodeURIComponent(body)}');
  });

  it('writes nothing on the way through the preview', () => {
    const preview = source.slice(
      source.indexOf("r.post('/:id/email/preview'"),
      source.indexOf("r.post('/:id/email',"));
    expect(preview).not.toContain('queueEmail');
    expect(preview).not.toContain('INSERT');
    expect(preview).not.toContain('UPDATE');
  });

  it('names a placeholder it could not fill', () => {
    const preview = source.slice(source.indexOf("r.post('/:id/email/preview'"));
    expect(preview).toContain('unknownPlaceholders');
  });
});

describe('the letter is the practice’s, not the code’s', () => {
  const source = readFileSync('src/modules/quotes/index.ts', 'utf8');

  it('is a setting, with the built-in wording as its default', () => {
    expect(source).toContain("key: 'quotes.email_body'");
    expect(source).toContain('default: DEFAULT_EMAIL_BODY');
  });

  it('lets the subject be changed too, which was asked for by name', () => {
    expect(source).toContain("key: 'quotes.email_subject'");
  });

  it('falls back to the built-in letter rather than sending an empty one', () => {
    // `||` not `??`: emptying the box means "give me the letter back".
    expect(source).toContain("values['quotes.email_body'] || DEFAULT_EMAIL_BODY");
  });
});
