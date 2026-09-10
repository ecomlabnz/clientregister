/**
 * Filling a letter the practice wrote with the facts of one matter.
 *
 * **Asked for on 11 September 2026:** *"where do i change my email template when
 * quotation is going out to client?"* Nowhere — the letter was written in
 * TypeScript, and the only way to change a word was to retype it in the compose
 * box for every client, where it was forgotten again by the next quotation.
 *
 * That is the standing rule broken: *anything that differs between practices
 * belongs in settings or a vocabulary, not in the code.* A covering letter is
 * about as practice-specific as a thing can be.
 *
 * ## What a placeholder is
 *
 * `{client_name}`. Braces, lower case, underscores. Nothing else is syntax:
 * there are no conditionals, no loops, no expressions. A template language
 * grows until somebody needs a debugger to see why a client got a blank
 * paragraph, and this is a letter, not a program.
 *
 * ## An unknown placeholder prints as written
 *
 * The practice chose this, and it is the right choice: *"as printed - but good
 * point - must have PREVIEW page before it goes out"*. `{clietn_name}` comes out
 * as the literal text `{clietn_name}`, which is glaring on the preview screen.
 * The alternative — dropping it — produces a letter that reads almost right and
 * has a hole in it, and the hole is exactly the sort of thing an eye slides
 * over.
 *
 * A known placeholder whose value is genuinely empty is a different thing and
 * does disappear: a quotation with no closing date should not print the word
 * "undefined", and the sentence around it is written to survive its absence.
 */

/** `{name}` — lower case, digits and underscores only. */
const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    (Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : whole));
}

/**
 * The names a template used but the register cannot fill.
 *
 * Shown on the preview screen so a typo is named rather than merely visible —
 * the difference between "why does my letter say {clietn_name}" and being told
 * which word is wrong and what the real ones are.
 */
export function unknownPlaceholders(template: string, values: Record<string, string>): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!Object.prototype.hasOwnProperty.call(values, name)) seen.add(name);
  }
  return [...seen].sort();
}

/**
 * Tidy the blank lines a filled template leaves behind.
 *
 * A placeholder that stands alone on its line and fills to nothing leaves the
 * line empty, and two of those in a row leave a gap where a paragraph was. The
 * letter is written with blank lines between paragraphs, so runs of three or
 * more collapse to two — one blank line, which is one paragraph break.
 *
 * Deliberately not cleverer than that. Trailing spaces go, because they are
 * invisible and a mail client will keep them; nothing else is touched.
 */
export function tidyBlankLines(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trimEnd();
}
