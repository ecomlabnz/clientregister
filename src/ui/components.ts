/** Shared building blocks for the server-rendered UI. */

import { html, join, raw, type Raw } from './html';

export function badge(text: string, tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'grey' = 'neutral'): Raw {
  return html`<span class="badge badge-${raw(tone)}">${text}</span>`;
}

export function card(title: string, body: Raw, actions?: Raw): Raw {
  return html`
    <section class="card">
      <header class="card-head">
        <h2>${title}</h2>
        ${actions ?? ''}
      </header>
      <div class="card-body">${body}</div>
    </section>`;
}

/**
 * A card that starts closed.
 *
 * Used where the contents are worth having on the page but not worth showing to
 * whoever is standing behind you — money, in practice. Built on `<details>`, so
 * it needs no script and keeps working with one blocked.
 *
 * Worth being clear about what this is and is not: it is a screen somebody has
 * to click past, not access control. The figures are still in the page for
 * anyone who may open the record at all. Deciding *who* may see money is a
 * question of roles, not of a fold.
 */
export function collapsibleCard(title: string, body: Raw, note?: string): Raw {
  return html`
    <section class="card">
      <details class="card-fold">
        <summary class="card-head">
          <h2>${title}</h2>
          ${note ? html`<span class="small muted">${note}</span>` : ''}
        </summary>
        <div class="card-body">${body}</div>
      </details>
    </section>`;
}

/**
 * A twelve-month trend, as one shape.
 *
 * The only place on the dashboard where a picture beats a figure: a count tells
 * you where you are, and this tells you which way you are going. Drawn as an
 * SVG polyline with presentation attributes rather than inline styles, because
 * the content policy forbids the latter.
 *
 * Deliberately unlabelled inside the plot. Axes and gridlines on a strip
 * forty pixels tall are decoration; the range is written underneath in words.
 */
export function sparkline(values: number[], opts: { label: string } = { label: '' }): Raw {
  if (values.length < 2) return html`<p class="small muted">Not enough history to show a trend yet.</p>`;

  const width = 300;
  const height = 40;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  // The y axis starts at zero rather than at the lowest value: a chart that
  // crops the bottom makes an ordinary month look like a collapse.
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`);
  const area = `0,${height} ${points.join(' ')} ${width},${height}`;

  return html`
    <svg class="sparkline" viewBox="${`0 0 ${width} ${height}`}" preserveAspectRatio="none"
         role="img" aria-label="${opts.label}">
      <polygon class="sparkline-area" points="${area}"></polygon>
      <polyline class="sparkline-line" points="${points.join(' ')}"></polyline>
    </svg>`;
}

/**
 * The line under a case title in a list.
 *
 * A matter has a name — "AEWV. TAGATA, Sione" — and a thing it is about —
 * "Orchard worker, Kiwi Orchards". The name goes in the link; this is the rest.
 *
 * The reference joins the same line rather than taking one of its own. A third
 * line would make every row in every list taller for a value nobody reads twice,
 * and row height on these tables has already had to be fixed once.
 */
export function caseSubline(descriptor: string | null | undefined, ref?: string | null): Raw {
  if (!descriptor && !ref) return raw('');
  return html`<div class="muted small clamp-1">${descriptor ?? ''}${
    descriptor && ref ? ' · ' : ''}${ref ? html`<code>${ref}</code>` : ''}</div>`;
}

export function pageHeader(title: string, subtitle?: string | null, actions?: Raw): Raw {
  return html`
    <div class="page-head">
      <div>
        <h1>${title}</h1>
        ${subtitle ? html`<p class="muted">${subtitle}</p>` : ''}
      </div>
      <div class="page-actions">${actions ?? ''}</div>
    </div>`;
}

export function emptyState(message: string, actionHtml?: Raw): Raw {
  return html`<div class="empty"><p>${message}</p>${actionHtml ?? ''}</div>`;
}

export interface Column {
  label: string;
  /**
   * Makes the heading a sort control. The value is a key the page understands,
   * never SQL — the page maps it through an allow-list, because a sort key
   * arrives in the address bar and anything reaching ORDER BY from there would
   * be an injection.
   */
  sort?: string;
  /** Share of the table width. With `fixed`, this is what stops one column
   *  taking the space three others needed. */
  width?: string;
  /** Dropped on a narrow screen. The caller marks the matching cells with the
   *  same class, because a pre-rendered row cannot be told its own index. */
  hideOn?: 'sm';
  align?: 'right';
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
  /** The address this table is at, with a different sort applied. */
  href: (key: string, dir: 'asc' | 'desc') => string;
}

export interface TableOpts {
  /**
   * Column headings stay put while the rows scroll under them.
   *
   * This only works when the table does not need horizontal scrolling: a
   * sticky element positions against its nearest scrolling ancestor, so inside
   * an `overflow-x: auto` wrapper the heading sticks to the wrapper and scrolls
   * away with the page. Verified in a browser, not assumed. Use it on lists
   * whose columns are sized to fit; leave it off for genuinely wide tables,
   * which keep their horizontal scroll instead.
   */
  sticky?: boolean;
  /**
   * Column widths are obeyed rather than treated as suggestions. Without this
   * the browser sizes columns by content, which on a phone hands most of the
   * width to whichever cell holds the longest word and squeezes the rest.
   */
  fixed?: boolean;
  /** Shown instead of the table when there are no rows. */
  empty?: string;
  /**
   * How the table is sorted now, and how to ask for it differently.
   *
   * Headings become ordinary links. Sorting a list is navigation — a different
   * view of the same thing, with an address you can keep — so it needs no
   * script and survives a reload.
   */
  sort?: SortState;
}

export function table(columns: Array<string | Column>, rows: Raw[], opts: TableOpts = {}): Raw {
  if (rows.length === 0) return emptyState(opts.empty ?? 'Nothing here yet.');
  const cols: Column[] = columns.map((c) => (typeof c === 'string' ? { label: c } : c));
  const sized = cols.some((c) => c.width);

  const wrapClass = opts.sticky ? 'table-wrap table-sticky' : 'table-wrap';
  const tableClass = opts.fixed ? 'table-fixed' : '';

  return html`
    <div class="${wrapClass}">
      <table class="${tableClass}">
        ${sized
          ? html`<colgroup>${cols.map((c) => html`<col ${c.width ? raw(`class="w-${c.width}"`) : ''}>`)}</colgroup>`
          : ''}
        <thead><tr>${cols.map((c) => {
          const cls = [
            c.hideOn === 'sm' ? 'col-sm-hide' : '',
            c.align === 'right' ? 'num' : '',
          ].filter(Boolean).join(' ');
          if (!c.sort || !opts.sort) return html`<th class="${cls}">${c.label}</th>`;
          const current = opts.sort.key === c.sort;
          // Clicking the column you are already sorted by reverses it; clicking
          // another starts it ascending, which is what a person means by
          // "sort by name".
          const next = current && opts.sort.dir === 'asc' ? 'desc' : 'asc';
          return html`<th class="${cls}" ${current ? raw(`aria-sort="${opts.sort.dir === 'asc' ? 'ascending' : 'descending'}"`) : ''}>
            <a class="${current ? 'th-sort th-sort-on' : 'th-sort'}"
               href="${opts.sort.href(c.sort, next)}">${c.label}<span class="th-arrow" aria-hidden="true">${
                 current ? (opts.sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span></a>
          </th>`;
        })}</tr></thead>
        <tbody>${join(rows)}</tbody>
      </table>
    </div>`;
}

export function errorList(errors: Record<string, string> | undefined): Raw {
  const values = Object.values(errors ?? {});
  if (values.length === 0) return raw('');
  return html`<div class="alert alert-error"><ul>${values.map((e) => html`<li>${e}</li>`)}</ul></div>`;
}

export function csrfField(token: string): Raw {
  return html`<input type="hidden" name="_csrf" value="${token}">`;
}

export interface FieldOpts {
  label: string;
  name: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  autocomplete?: string;
  rows?: number;
  maxlength?: number;
  disabled?: boolean;
  step?: string;
  /**
   * Put the cursor here on load. Use it only where the whole point of the page
   * is this one box — a page that steals focus from somebody halfway through
   * reading it is worse than one that does nothing.
   */
  autofocus?: boolean;
}

export function field(opts: FieldOpts): Raw {
  const id = `f_${opts.name}`;
  const value = opts.value === null || opts.value === undefined ? '' : String(opts.value);
  const control =
    opts.type === 'textarea'
      ? html`<textarea id="${id}" name="${opts.name}" rows="${opts.rows ?? 4}"
               ${opts.required ? raw('required') : ''}
               ${opts.disabled ? raw('disabled') : ''}
               ${opts.autofocus ? raw('autofocus') : ''}
               ${opts.maxlength ? raw(`maxlength="${opts.maxlength}"`) : ''}
               placeholder="${opts.placeholder ?? ''}">${value}</textarea>`
      : html`<input id="${id}" name="${opts.name}" type="${opts.type ?? 'text'}" value="${value}"
               ${opts.required ? raw('required') : ''}
               ${opts.disabled ? raw('disabled') : ''}
               ${opts.step ? raw(`step="${opts.step}"`) : ''}
               ${opts.maxlength ? raw(`maxlength="${opts.maxlength}"`) : ''}
               ${opts.autocomplete ? raw(`autocomplete="${opts.autocomplete}"`) : ''}
               ${opts.autofocus ? raw('autofocus') : ''}
               placeholder="${opts.placeholder ?? ''}">`;
  return html`
    <div class="field">
      <label for="${id}">${opts.label}${opts.required ? html`<span class="req"> *</span>` : ''}</label>
      ${control}
      ${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}
    </div>`;
}

export interface SelectOpts {
  label: string;
  name: string;
  value?: string | null;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  required?: boolean;
  hint?: string;
  includeBlank?: string | false;
}

export function select(opts: SelectOpts): Raw {
  const id = `f_${opts.name}`;
  return html`
    <div class="field">
      <label for="${id}">${opts.label}${opts.required ? html`<span class="req"> *</span>` : ''}</label>
      <select id="${id}" name="${opts.name}" ${opts.required ? raw('required') : ''}>
        ${opts.includeBlank !== false
          ? html`<option value="">${opts.includeBlank || '—'}</option>`
          : ''}
        ${opts.options.map(
          (o) => html`<option value="${o.value}" ${o.value === opts.value ? raw('selected') : ''}
                        ${o.disabled ? raw('disabled') : ''}>${o.label}</option>`,
        )}
      </select>
      ${opts.hint ? html`<p class="hint">${opts.hint}</p>` : ''}
    </div>`;
}

export function optionsFrom<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): Array<{ value: string; label: string }> {
  return values.map((v) => ({ value: v, label: labels[v] }));
}

/** A POST form reduced to a single button — used for state changes. */
export function actionButton(
  action: string,
  csrf: string,
  label: string,
  opts: { className?: string; confirm?: string; fields?: Record<string, string> } = {},
): Raw {
  return html`
    <form method="post" action="${action}" class="inline-form"
          ${opts.confirm ? raw(`data-confirm="${opts.confirm.replace(/"/g, '&quot;')}"`) : ''}>
      ${csrfField(csrf)}
      ${Object.entries(opts.fields ?? {}).map(
        ([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`,
      )}
      <button type="submit" class="${opts.className ?? 'btn btn-secondary'}">${label}</button>
    </form>`;
}

export function statusTone(status: string): 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'grey' {
  switch (status) {
    case 'approved': case 'accepted': case 'active': case 'converted': case 'done':
      return 'green';
    case 'declined': case 'lost': case 'urgent': case 'ppi': case 'inz_rfi': case 'failed':
      return 'red';
    case 'lodged': case 'decision_pending': case 'interim_visa': case 'sent': case 'in_progress':
      return 'blue';
    case 'on_hold': case 'blocked': case 'gathering_documents': case 'pending': case 'new':
      return 'amber';
    case 'closed': case 'withdrawn': case 'archived': case 'cancelled': case 'inactive': case 'spam':
      return 'grey';
    default:
      return 'neutral';
  }
}
