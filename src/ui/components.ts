/** Shared building blocks for the server-rendered UI. */

import { html, join, raw, type Raw } from './html';
import { dateOrDateTime, isDateOnly } from './format';

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
 * A card whose heading folds it away.
 *
 * Open when the page loads — the section is there to be read — but every
 * heading on a matter is a handle, so a long file can be put back to the parts
 * that matter to whoever is looking at it. `<details>` again, for the reason
 * everything here is: the content policy forbids an inline script, and a fold
 * that stops working when script is blocked is a section nobody can reach.
 *
 * The fold is not remembered between page loads. It could be, and deliberately
 * is not: a section that is missing because of something you did on another
 * matter last week is worse than one you close again.
 */
export function foldingCard(title: string, body: Raw, actions?: Raw): Raw {
  return html`
    <section class="card">
      <details class="card-fold" open>
        <summary class="card-head">
          <h2>${title}</h2>
          ${actions ?? ''}
        </summary>
        <div class="card-body">${body}</div>
      </details>
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
 * The warnings standing on a file, at the top of it.
 *
 * Above everything, because that is the whole point: a fact that changes how a
 * matter is handled has to be read before anything is said, not found three
 * screens down after it mattered. The practice asked for this on reading a
 * partnership summary recording an assault reported to Police.
 *
 * Deliberately plain and deliberately loud. No icons, no colour scale, no
 * severity — one band, and if there is nothing to warn about there is no band
 * at all. A warning that appears on every file teaches people to look past it.
 */
export function flagBand(opts: {
  flags: Array<{
    id: string; kind: string; body: string; raised_at: string; expires_on: string | null;
    raised_by_name?: string | null; from_client?: boolean; source_case_id?: string | null; source_case_ref?: string | null;
  }>;
  label: (kind: string) => string;
  /** Null when the reader may not change one. */
  clear: { csrf: string } | null;
  /** Offered alongside the wording, so an edit is one press from reading it. */
  kinds?: Array<{ value: string; label: string }>;
  lives?: Array<{ value: string; label: string }>;
  /** Where a flag on the client is taken down, when this is a matter. */
  clientHref?: string;
}): Raw {
  if (opts.flags.length === 0) return raw('');
  return html`
    <section class="flags" role="note" aria-label="Warnings on this file">
      ${opts.flags.map((f) => html`
        <div class="flag">
          <div class="flag-main">
            <span class="flag-kind">${opts.label(f.kind)}</span>
            <span class="flag-body">${f.body}</span>
          </div>
          <div class="flag-meta">
            ${f.from_client
              ? html`<span>On the client${opts.clientHref
                  ? html` · <a href="${opts.clientHref}">their page</a>` : ''}</span>`
              : ''}
            ${'' /* A warning that cites a matter can be checked against it in one
                     press, which is the difference between a fact and a claim. */}
            ${f.source_case_ref && f.source_case_id
              ? html`<span>From <a href="/cases/${f.source_case_id}"><code>${f.source_case_ref}</code></a></span>`
              : ''}
            ${f.raised_by_name ? html`<span>Raised by ${f.raised_by_name}</span>` : ''}
            ${f.expires_on ? html`<span>Until ${f.expires_on}</span>` : ''}
            ${'' /* A warning on the client is changed on the client's page, not on
                     each matter it appears on — one fact, one place to edit it. */}
            ${opts.clear && !f.from_client ? html`
              <details class="reveal-inline">
                <summary class="small">Change it</summary>
                <form method="post" action="/flags/${f.id}/edit" class="row-form">
                  <input type="hidden" name="_csrf" value="${opts.clear.csrf}">
                  ${opts.kinds
                    ? select({ label: 'What kind', name: 'kind', value: f.kind,
                               includeBlank: false, options: opts.kinds })
                    : raw(`<input type="hidden" name="kind" value="${f.kind}">`)}
                  ${field({ label: 'What it says', name: 'body', value: f.body, required: true,
                            maxlength: 500 })}
                  ${opts.lives
                    ? select({ label: 'How long it stands', name: 'life',
                               value: f.expires_on ? '' : 'standing',
                               includeBlank: 'Leave as it is', options: opts.lives })
                    : ''}
                  <button class="btn btn-primary btn-small" type="submit">Save</button>
                </form>
              </details>
              <details class="reveal-inline">
                <summary class="small">Take it down</summary>
                <form method="post" action="/flags/${f.id}/clear" class="row-form">
                  <input type="hidden" name="_csrf" value="${opts.clear.csrf}">
                  ${field({ label: 'Why', name: 'note', maxlength: 300,
                            placeholder: 'e.g. Conviction disclosed to INZ and accepted' })}
                  <button class="btn btn-secondary btn-small" type="submit">Take it down</button>
                </form>
                ${'' /* Deleting is not taking down and the wording says so: one is
                        "no longer true", the other "never belonged here". */}
                <form method="post" action="/flags/${f.id}/delete" class="row-form">
                  <input type="hidden" name="_csrf" value="${opts.clear.csrf}">
                  <button class="btn btn-danger btn-small" type="submit">Delete it instead</button>
                </form>
                <p class="hint">Take it down when it stops applying — the record keeps it.
                   Delete it only when it should never have been here. Either way the audit
                   log records what it said.</p>
              </details>` : ''}
          </div>
        </div>`)}
    </section>`;
}

/**
 * Raising a warning, and the ones already taken down.
 *
 * The raiser is a reveal rather than an open form: raising a warning is an
 * occasional act and an empty form sitting on every client page competes with
 * the record itself. The history below it is there because a warning that stood
 * on a file for six months is part of how that file was handled, and why it came
 * down is the useful half.
 */
/**
 * Choosing the matter or client to file something on.
 *
 * This was one `<select>` holding every matter and client in the register. That
 * was workable at sixty and unusable at four hundred: a list nobody can scan is
 * a list people file into wrongly, and on a phone it is a scrolling wall.
 *
 * So it searches. Type a name, a reference, or an INZ application number, press
 * Find, and pick from what comes back. Two forms rather than one, because they
 * do different things: finding is a GET, so the results can be linked to and
 * the back button behaves; filing is a POST, because it writes.
 *
 * It works with scripting switched off — that is the rule, and it is also why
 * the search is a button rather than a keystroke. `app.js` narrows the list as
 * you type where scripting is there, which changes how fast it feels and
 * nothing about whether it works.
 */
export function filingPicker(opts: {
  /** Where the POST goes. */
  action: string;
  /** Where the GET goes — usually this same page. */
  findAction: string;
  csrf: string;
  query: string;
  hits: Array<{ value: string; ref: string; title: string; detail: string; closed: boolean }>;
  hint: Raw;
}): Raw {
  return html`
    ${'' /* data-live-search is the enhancement the search page already uses:
             app.js re-fetches this same page as you type and swaps the region
             below. Same URL, same markup, same server rendering — scripting
             only removes the press. */}
    <form method="get" action="${opts.findAction}" class="row-form filing-find" data-live-search>
      ${field({ label: 'Find the matter or client', name: 'find', value: opts.query,
                placeholder: 'Name, CASE-26-014, CL-0082, or an INZ application number' })}
      <button class="btn btn-secondary" type="submit">Find</button>
    </form>
    <div data-live-results>
    ${opts.query.trim().length > 0 && opts.hits.length === 0
      ? html`<p class="hint">Nothing matches “${opts.query}”. Try a family name, a reference,
                or the INZ application number from the letter.</p>`
      : ''}
    ${opts.hits.length > 0
      ? html`
        <form method="post" action="${opts.action}" class="filing-choose">
          <input type="hidden" name="_csrf" value="${opts.csrf}">
          <ul class="pick-list">
            ${opts.hits.map((hit, i) => html`
              <li class="pick">
                <label>
                  <input type="radio" name="onto" value="${hit.value}" ${i === 0 ? raw('checked') : ''}>
                  <span class="pick-ref"><code>${hit.ref}</code></span>
                  <span class="pick-title">${hit.title}</span>
                  ${hit.detail ? html`<span class="pick-detail">${hit.detail}</span>` : ''}
                  ${'' /* Said plainly rather than hidden: a decision letter on a
                          matter closed last week is exactly the thing you file. */}
                  ${hit.closed ? html`<span class="pick-closed">closed</span>` : ''}
                </label>
              </li>`)}
          </ul>
          <button class="btn btn-primary" type="submit">File it</button>
        </form>`
      : ''}
    </div>
    ${opts.hint}`;
}

export function flagRaiser(opts: {
  entityType: 'client' | 'case';
  entityId: string;
  csrf: string;
  kinds: Array<{ value: string; label: string }>;
  lives: Array<{ value: string; label: string }>;
}): Raw {
  return html`
    <details class="reveal mt">
      <summary class="btn btn-secondary reveal-open">Raise a warning</summary>
      <section class="card"><div class="card-body">
        <form method="post" action="/flags" class="row-form">
          <input type="hidden" name="_csrf" value="${opts.csrf}">
          <input type="hidden" name="entity_type" value="${opts.entityType}">
          <input type="hidden" name="entity_id" value="${opts.entityId}">
          ${select({ label: 'What kind', name: 'kind', value: '', required: true,
                     includeBlank: '— choose —', options: opts.kinds })}
          ${field({ label: 'What somebody needs to know', name: 'body', required: true,
                    maxlength: 500,
                    placeholder: 'e.g. Assaulted by a former husband, reported to Police' })}
          ${select({ label: 'How long it stands', name: 'life', value: 'standing',
                     includeBlank: false, options: opts.lives })}
          <button class="btn btn-primary" type="submit">Raise it</button>
        </form>
        <p class="hint">It shows at the top of this record until it is taken down, or until the
           date you choose. A warning on a client also shows on all of their matters, because the
           fact is about the person.</p>
      </div></section>
    </details>`;
}

/** Warnings no longer showing — taken down, or past their date. */
export function flagHistory(opts: {
  flags: Array<{
    id: string; kind: string; body: string; expires_on: string | null;
    cleared_at: string | null; cleared_note: string | null;
  }>;
  label: (kind: string) => string;
  csrf: string | null;
}): Raw {
  if (opts.flags.length === 0) return raw('');
  return html`
    <ul class="list">
      ${opts.flags.map((f) => html`
        <li class="list-row">
          <div>
            <strong>${opts.label(f.kind)}</strong>
            <div class="small">${f.body}</div>
            <div class="small muted">
              ${f.cleared_at
                ? html`Taken down${f.cleared_note ? html` — ${f.cleared_note}` : ''}`
                : html`Lapsed on ${f.expires_on ?? ''}`}
            </div>
          </div>
          ${opts.csrf ? html`
            <form method="post" action="/flags/${f.id}/raise-again" class="inline-form">
              <input type="hidden" name="_csrf" value="${opts.csrf}">
              <button class="btn btn-secondary btn-small" type="submit">Put it back</button>
            </form>` : ''}
        </li>`)}
    </ul>`;
}

/**
 * A moment the register recorded, as date and time.
 *
 * The practice's decision, 1 September 2026: wherever the register shows when
 * something happened, it shows the time as well as the date. A file with two
 * notes written the same afternoon has to be able to say which came first, and
 * "01 Sept 2026" cannot.
 *
 * Set smaller than the text around it — a step or two down, in `em`, so it
 * stays in proportion wherever it is used. A timestamp is a thing you check,
 * not a thing you read, and at the same size as the sentence beside it it
 * competes with the sentence.
 *
 * Only for instants. A date somebody typed — a birthday, a visa expiry, the day
 * a matter was lodged — has no time and must not be given a made-up one, so
 * `dateShort` still renders those.
 */
export function stamp(value: string | null | undefined): Raw {
  const formatted = dateOrDateTime(value);
  if (!formatted) return html`<span class="muted">—</span>`;
  // "01 Sept 2026, 1:32 pm" — the comma is where the two parts divide.
  const at = formatted.lastIndexOf(', ');
  if (isDateOnly(value) || at < 0) return html`<span class="stamp">${formatted}</span>`;
  return html`<span class="stamp">${formatted.slice(0, at)}<span
    class="stamp-time">${formatted.slice(at)}</span></span>`;
}

/**
 * One item on a timeline, with the correction form when there is still time.
 *
 * The same on a client, a matter and an inquiry, because a note means the same
 * thing on each. Written once here rather than three times in three modules,
 * which is how the three drifted apart before.
 *
 * The correction form is a `<details>`, so it costs nothing until it is opened
 * and needs no script — and it is only rendered while the note may actually be
 * corrected. A button that fails when pressed teaches people not to trust
 * buttons.
 */
export function timelineItem(opts: {
  entry: {
    id: string; kind: string; body: string; occurred_at: string; created_at: string;
    edited_at?: string | null; author_name?: string | null;
    document_id?: string | null; document_name?: string | null;
  };
  kindLabel: string;
  /** Rendered by `stamp`, so a timeline reads like the rest of the page. */
  happened: Raw;
  written: Raw;
  /** Null when this note can no longer be corrected, which is the usual case. */
  correction: { csrf: string; kindOptions: Array<{ value: string; label: string }>; minutes: number } | null;
}): Raw {
  const { entry } = opts;
  return html`
    <li class="timeline-item">
      <div class="timeline-meta">
        <span class="badge badge-${raw(entry.kind === 'system' ? 'grey' : 'neutral')}">${opts.kindLabel}</span>
        <span class="muted small">${opts.happened}${entry.author_name ? ` · ${entry.author_name}` : ''}</span>
        ${'' /* When it was written, always — not only when it differs from the
                 day it happened. "Which of these two notes did I write first"
                 is asked of a file often enough that the answer belongs on the
                 page rather than in the database. */}
        <span class="muted small">written ${opts.written}</span>
        ${entry.edited_at ? html`<span class="badge badge-amber">corrected</span>` : ''}
      </div>
      <div class="timeline-body">${entry.body}</div>
      ${entry.document_id
        ? html`<p class="small mt">
                 <a href="/documents/${entry.document_id}">${entry.document_name ?? 'Attached file'}</a>
               </p>`
        : ''}
      ${opts.correction ? html`
        <details class="reveal-inline">
          <summary class="small">Correct this note</summary>
          <form method="post" action="/entries/${entry.id}/correct" class="entry-form">
            <input type="hidden" name="_csrf" value="${opts.correction.csrf}">
            ${field({ label: 'Note', name: 'body', type: 'textarea', rows: 4, required: true,
                      maxlength: 20000, value: entry.body })}
            <div class="row-form">
              ${select({ label: 'Kind', name: 'kind', value: entry.kind, includeBlank: false,
                         options: opts.correction.kindOptions })}
              ${field({ label: 'It happened on', name: 'occurred_at', type: 'date',
                        value: entry.occurred_at.slice(0, 10) })}
            </div>
            <button class="btn btn-secondary btn-small" type="submit">Save the correction</button>
            <p class="hint">Only for ${String(opts.correction.minutes)} minutes after a note is
               written, and only once. After that the note stands and a correction goes in as a new
               note — that is what makes the file worth something later. What it said before is
               kept in the audit log either way.</p>
          </form>
        </details>` : ''}
    </li>`;
}

/**
 * A form that stays out of the way until it is wanted.
 *
 * A list page ends with the list, not with a form. An always-open "New task"
 * box pushed the rows people came to read up the page and put an empty form
 * between them and the pager — the occasional errand competing with the
 * constant one.
 *
 * Built on `<details>` for the same reason everything else here is: the
 * content policy forbids an inline script, and a disclosure that stops
 * working when script is blocked is a form nobody can reach. The `<summary>`
 * wears the button classes, so it reads and focuses as the button it is,
 * while keeping the native disclosure semantics a screen reader announces.
 */
export function revealForm(label: string, body: Raw): Raw {
  return html`
    <details class="reveal">
      <summary class="btn btn-primary reveal-open">${label}</summary>
      <section class="card"><div class="card-body">${body}</div></section>
    </details>`;
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

/**
 * The subtitle takes markup as well as text, because what belongs there is
 * usually a date — and `stamp()` returns markup. Passed as a plain string it
 * came out as escaped tags on the page, which is what it was doing on three
 * pages before this was widened.
 */
export function pageHeader(title: string, subtitle?: string | Raw | null, actions?: Raw): Raw {
  return html`
    <div class="page-head">
      <div>
        <h1>${title}</h1>
        ${subtitle ? html`<p class="muted">${subtitle}</p>` : ''}
      </div>
      <div class="page-actions">${actions ?? ''}</div>
    </div>`;
}

/**
 * The named views of a list, with a count on each.
 *
 * Every list page in the register wears the same top: a heading, whatever
 * summary figures it has, then this row of views, then one filter bar. Seven
 * pages had written that row out by hand, which is exactly how a fault gets
 * onto seven pages at once — the search bug did, and had to be found six times
 * over. One helper, and a test that every list page uses it.
 *
 * A view is a different *errand*, not a different filter. "Open matters" and
 * "mine" are errands and belong here; "type is a work visa" is a filter and
 * belongs in the bar below. The count is what makes a tab worth the width: it
 * answers the question before the reader clicks.
 */
export interface ListView {
  id: string;
  label: string;
  count?: number;
  href: string;
  current: boolean;
}

export function viewTabs(views: ListView[]): Raw {
  return html`
    <nav class="tabs">
      ${views.map((v) => html`
        <a class="${v.current ? 'tab current' : 'tab'}" href="${v.href}">${v.label}${
          v.count === undefined ? '' : html` <span class="muted">${String(v.count)}</span>`}</a>`)}
    </nav>`;
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
    case 'declined': case 'lost': case 'urgent': case 'ppi': case 'failed':
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
