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
