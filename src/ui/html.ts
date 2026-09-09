/**
 * A very small auto-escaping template layer.
 *
 * `html` escapes every interpolated value by default. The only way to inject
 * markup is to wrap it in `raw()`, which makes every unescaped insertion in the
 * codebase greppable. This is the app's primary XSS control — client notes and
 * forwarded messages are attacker-influenced text.
 */

import { escapeHtml } from '../core/validate';

export class Raw {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): Raw {
  return new Raw(value);
}

function render(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? '');
  }
  return new Raw(out);
}

/** Join an array of fragments without separators. */
export function join(parts: unknown[], separator = ''): Raw {
  return new Raw(parts.map(render).join(separator));
}

/**
 * Text a person wrote, with `**bold**` honoured and nothing else.
 *
 * **Asked for on 9 September 2026**, for the clauses and acknowledgements of a
 * letter of engagement: *"would be good if that field could understand the ** **
 * to embolden the phrase in between"*. A contract leans on emphasis — the verb
 * that says what the client is agreeing to — and typing HTML into a settings box
 * is not something to ask of anybody.
 *
 * **The escaping happens first and is not optional.** The text is escaped
 * exactly as `html` would escape it, and only then are the asterisk pairs
 * turned into tags. So `<script>` is inert before this function decides
 * anything, and the only markup that can come out is the `<strong>` written
 * here. This is the one place in the register that turns a person's text into
 * tags, which is why it is short enough to read in full.
 *
 * `**` and nothing else: no italics, no links, no headings. A contract is not a
 * document anybody should be able to restructure by accident, and every other
 * syntax somebody might type stays visible as the characters they typed.
 */
export function emphasise(text: string): Raw {
  return new Raw(
    escapeHtml(text).replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>'),
  );
}
