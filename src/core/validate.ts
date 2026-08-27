/**
 * Form reading and validation.
 *
 * Deliberately dependency-free and explicit: every field a route accepts is
 * named here, so nothing reaches SQL that a route did not ask for. Unknown
 * form fields are ignored rather than mass-assigned.
 */

export class FormError extends Error {
  constructor(public fields: Record<string, string>) {
    super('Validation failed');
    this.name = 'FormError';
  }
}

export interface TextOpts {
  required?: boolean;
  min?: number;
  max?: number;
  label?: string;
  pattern?: RegExp;
  patternMessage?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class FormReader {
  readonly errors: Record<string, string> = {};

  constructor(private readonly data: FormData | URLSearchParams) {}

  private get(name: string): string {
    const v = this.data.get(name);
    return typeof v === 'string' ? v.trim() : '';
  }

  private fail(name: string, message: string): void {
    if (!(name in this.errors)) this.errors[name] = message;
  }

  text(name: string, opts: TextOpts = {}): string {
    const label = opts.label ?? name;
    const value = this.get(name);
    if (!value) {
      if (opts.required) this.fail(name, `${label} is required.`);
      return '';
    }
    if (opts.min && value.length < opts.min) this.fail(name, `${label} must be at least ${opts.min} characters.`);
    const max = opts.max ?? 2000;
    if (value.length > max) this.fail(name, `${label} must be ${max} characters or fewer.`);
    if (opts.pattern && !opts.pattern.test(value)) {
      this.fail(name, opts.patternMessage ?? `${label} is not in the expected format.`);
    }
    return value;
  }

  /** Like `text`, but empty becomes null so the column stays NULL. */
  optional(name: string, opts: TextOpts = {}): string | null {
    const value = this.text(name, { ...opts, required: false });
    return value === '' ? null : value;
  }

  email(name: string, opts: TextOpts = {}): string | null {
    const value = this.text(name, { ...opts, max: opts.max ?? 320 });
    if (!value) return null;
    if (!EMAIL_RE.test(value)) {
      this.fail(name, `${opts.label ?? name} must be a valid email address.`);
      return null;
    }
    return value.toLowerCase();
  }

  enum<T extends string>(name: string, allowed: readonly T[], opts: { required?: boolean; label?: string; fallback?: T } = {}): T | null {
    const value = this.get(name);
    if (!value) {
      if (opts.fallback !== undefined) return opts.fallback;
      if (opts.required) this.fail(name, `${opts.label ?? name} is required.`);
      return null;
    }
    if (!(allowed as readonly string[]).includes(value)) {
      this.fail(name, `${opts.label ?? name} is not a recognised value.`);
      return null;
    }
    return value as T;
  }

  /** ISO date (YYYY-MM-DD) from a `<input type="date">`. */
  date(name: string, opts: { required?: boolean; label?: string } = {}): string | null {
    const value = this.get(name);
    if (!value) {
      if (opts.required) this.fail(name, `${opts.label ?? name} is required.`);
      return null;
    }
    if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      this.fail(name, `${opts.label ?? name} must be a valid date.`);
      return null;
    }
    return value;
  }

  /** Money in, integer cents out. Accepts "1,500", "1500.50", "$1,500.50". */
  money(name: string, opts: { required?: boolean; label?: string } = {}): number | null {
    const raw = this.get(name).replace(/[$,\s]/g, '');
    if (!raw) {
      if (opts.required) this.fail(name, `${opts.label ?? name} is required.`);
      return null;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      this.fail(name, `${opts.label ?? name} must be an amount such as 1500 or 1500.00.`);
      return null;
    }
    return Math.round(Number(raw) * 100);
  }

  int(name: string, opts: { required?: boolean; label?: string; min?: number; max?: number } = {}): number | null {
    const raw = this.get(name);
    if (!raw) {
      if (opts.required) this.fail(name, `${opts.label ?? name} is required.`);
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      this.fail(name, `${opts.label ?? name} must be a whole number.`);
      return null;
    }
    if (opts.min !== undefined && n < opts.min) this.fail(name, `${opts.label ?? name} must be at least ${opts.min}.`);
    if (opts.max !== undefined && n > opts.max) this.fail(name, `${opts.label ?? name} must be at most ${opts.max}.`);
    return n;
  }

  bool(name: string): number {
    const v = this.get(name);
    return v === 'on' || v === 'true' || v === '1' ? 1 : 0;
  }

  get valid(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  /** Throws a FormError carrying every field message at once. */
  check(): void {
    if (!this.valid) throw new FormError(this.errors);
  }
}

/** Escape untrusted text for interpolation into HTML. */
export function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
