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

export function table(headers: string[], rows: Raw[]): Raw {
  if (rows.length === 0) return emptyState('Nothing here yet.');
  return html`
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
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
}

export function field(opts: FieldOpts): Raw {
  const id = `f_${opts.name}`;
  const value = opts.value === null || opts.value === undefined ? '' : String(opts.value);
  const control =
    opts.type === 'textarea'
      ? html`<textarea id="${id}" name="${opts.name}" rows="${opts.rows ?? 4}"
               ${opts.required ? raw('required') : ''}
               ${opts.disabled ? raw('disabled') : ''}
               ${opts.maxlength ? raw(`maxlength="${opts.maxlength}"`) : ''}
               placeholder="${opts.placeholder ?? ''}">${value}</textarea>`
      : html`<input id="${id}" name="${opts.name}" type="${opts.type ?? 'text'}" value="${value}"
               ${opts.required ? raw('required') : ''}
               ${opts.disabled ? raw('disabled') : ''}
               ${opts.step ? raw(`step="${opts.step}"`) : ''}
               ${opts.maxlength ? raw(`maxlength="${opts.maxlength}"`) : ''}
               ${opts.autocomplete ? raw(`autocomplete="${opts.autocomplete}"`) : ''}
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
