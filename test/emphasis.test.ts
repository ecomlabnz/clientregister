/**
 * `**bold**` in the practice's own wording.
 *
 * **Asked for on 9 September 2026**, for the clauses and acknowledgements of a
 * letter of engagement: *"would be good if that field could understand the
 * ** ** to embolden the phrase in between"*. A contract leans on emphasis — the
 * verb that says what the client is agreeing to — and typing HTML into a
 * settings box is not something to ask of anybody.
 *
 * This is the one place in the register that turns a person's text into tags,
 * so it is tested as such: the escaping happens first, the only tag it can
 * produce is `<strong>`, and every other syntax somebody might type survives as
 * the characters they typed.
 */

import { describe, expect, it } from 'vitest';
import { emphasise } from '../src/ui/html';

const out = (text: string) => emphasise(text).value;

describe('what it emboldens', () => {
  it('turns a marked phrase into strong text', () => {
    expect(out('**acknowledges** that the Lawyer retains responsibility'))
      .toBe('<strong>acknowledges</strong> that the Lawyer retains responsibility');
  });

  it('takes more than one in a sentence', () => {
    expect(out('the **Client** agrees with the **Lawyer**'))
      .toBe('the <strong>Client</strong> agrees with the <strong>Lawyer</strong>');
  });

  it('emboldens a phrase, not only a word', () => {
    expect(out('**no outcome can be guaranteed** in any application'))
      .toBe('<strong>no outcome can be guaranteed</strong> in any application');
  });
});

describe('what it leaves alone', () => {
  it('escapes before it decides anything, so markup in the text is inert', () => {
    // The order is the whole safety property: `<script>` is already harmless
    // by the time the asterisks are looked at.
    expect(out('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out('**<script>alert(1)</script>**'))
      .toBe('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>');
  });

  it('produces no tag but strong, whatever else is typed', () => {
    for (const text of ['*italic*', '_underscore_', '# Heading', '[link](http://example.test)',
                        '> quote', '`code`', '<b>bold</b>', '<img src=x onerror=1>']) {
      const rendered = out(text);
      const tags = [...rendered.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1]!.toLowerCase());
      expect(tags.filter((t) => t !== 'strong'), text).toEqual([]);
    }
  });

  it('leaves an unmatched or empty pair as the characters they are', () => {
    // Somebody mid-sentence, or writing about a footnote marker.
    expect(out('a rate of 15%** on the balance')).toBe('a rate of 15%** on the balance');
    expect(out('****')).toBe('****');
    expect(out('** **')).toBe('** **');
  });

  it('does not reach across a gap to embolden two separate marks', () => {
    // "**a** and **b**" is two phrases, not one running from the first mark to
    // the last — a greedy match would swallow the words between them.
    expect(out('**a** and **b**')).toBe('<strong>a</strong> and <strong>b</strong>');
  });

  it('keeps an apostrophe and an ampersand as themselves', () => {
    expect(out("the **Lawyer's** fees & disbursements"))
      .toBe('the <strong>Lawyer&#39;s</strong> fees &amp; disbursements');
  });
});
