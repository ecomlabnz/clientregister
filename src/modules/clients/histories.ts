/**
 * The three history blocks on a client page, and the routes behind them.
 *
 * **Asked for on 11 September 2026.** The shape of the data is migration 0089;
 * how a person works with it is `core/histories.ts`; what a screen looks like
 * is here.
 *
 * ## Why these blocks look like the quotation lines
 *
 * *"be formatted in a fashion that is similar to existing pattern - whatever
 * blocks there are - Quotes, Files, Passports, Certificates ... the user must
 * be able to move the table rows up or down - if possible, and add or delete
 * more lines."*
 *
 * That is the editable table the register already has, on quotation lines and
 * payment stages: every row in one form, a small **#** box that sets the order,
 * a red cross that marks a row to go, and one Save. It needs no script — which
 * the content policy requires — and it is a screen the practice already uses
 * weekly, so there is nothing new to learn.
 *
 * "Up or down" is a typed number rather than a pair of arrows for the same
 * reason it is on a quotation: arrows are one request per row, and moving a row
 * from the bottom to the top is then eight presses and eight page loads.
 *
 * ## The blocks start closed
 *
 * *"each also starts collapsed."* `collapsibleCard`, which is what the money on
 * a matter already uses. They are not mandatory and most clients will have
 * none, so an open block would be three empty headings on every client page.
 */

import type { Hono } from 'hono';
import type { AppContext } from '../../types';
import { html, raw, type Raw } from '../../ui/html';
import {
  collapsibleCard, csrfField, emptyState, field, select, actionButton,
} from '../../ui/components';
import { historyDate } from '../../ui/format';
import { countryOptions, countryName } from '../../core/countries';
import { FormReader } from '../../core/validate';
import { requirePermission } from '../../core/auth';
import { redirectWith } from '../../ui/layout';
import { addEntry } from '../../core/timeline';
import { auditFrom } from '../../core/audit';
import { one } from '../../core/db';
import { labelFor, termOptions, type Term } from '../../core/vocabulary';
import {
  HISTORIES, HISTORY_NOTE_MAX, addHistoryRow, gapsIn, historyByKey, readHistoryRow, saveHistory,
  type HistoryDef, type HistoryKey, type HistoryRow,
} from '../../core/histories';

/** The vocabularies the columns of a history draw on, read once per page. */
export interface HistoryVocab {
  employment_kinds: Term[];
  education_levels: Term[];
  education_outcomes: Term[];
  travel_purposes: Term[];
  travel_modes: Term[];
}

function optionsFor(col: { vocab?: keyof HistoryVocab }, vocab: HistoryVocab) {
  return termOptions(col.vocab ? vocab[col.vocab] : []);
}

/** One cell of the editable table. */
function cell(
  def: HistoryDef, col: HistoryDef['columns'][number], row: HistoryRow, vocab: HistoryVocab,
): Raw {
  const name = `${col.name}_${row.id}`;
  const value = (row[col.name] ?? '') as string;
  if (col.kind === 'vocab') {
    return html`<select name="${name}" aria-label="${col.label}">
      <option value="">—</option>
      ${optionsFor(col, vocab).map((o) => html`
        <option value="${o.value}" ${o.value === value ? raw('selected') : ''}>${o.label}</option>`)}
    </select>`;
  }
  if (col.kind === 'country') {
    return html`<select name="${name}" aria-label="${col.label}">
      <option value="">—</option>
      ${countryOptions().map((o) => html`
        <option value="${o.value}" ${o.value === value ? raw('selected') : ''}>${o.label}</option>`)}
    </select>`;
  }
  if (col.kind === 'date') {
    // A text box rather than `type="date"`, because a date picker cannot offer
    // a month. **Asked for on 12 September 2026:** *"can we allow filling in
    // only the Month and year if the date is not available?"* — and in a
    // history that is the ordinary case, not the exception.
    //
    // `pattern` makes the browser refuse a wrong shape before the form is sent,
    // and the same rule is in `readHistoryRow` and in the database (0091), so
    // the three cannot disagree. These are typed off a document rather than
    // picked out of a calendar, which is why losing the picker costs little
    // here and would cost a great deal on a visa expiry.
    return html`<input name="${name}" value="${value}" size="11" maxlength="10"
                       inputmode="numeric" placeholder="YYYY-MM-DD"
                       pattern="[0-9]{4}-[0-9]{2}(-[0-9]{2})?"
                       title="A day or a month: 2019-03-15, or 2019-03"
                       aria-label="${col.label}">`;
  }
  return html`<input name="${name}" value="${value}" maxlength="${String(col.max ?? 200)}"
                     size="${String(col.size ?? 16)}" aria-label="${col.label}">`;
}

/** One row of the read-only list, for whoever may not write. */
function readOnlyRow(def: HistoryDef, row: HistoryRow, vocab: HistoryVocab): Raw {
  const parts = def.columns
    .filter((c) => (row[c.name] ?? '') !== '')
    .map((c) => {
      const value = row[c.name] as string;
      if (c.kind === 'country') return countryName(value);
      if (c.kind === 'date') return historyDate(value);
      if (c.kind === 'vocab') return labelFor(vocab[c.vocab!], value);
      return value;
    });
  return html`<li class="list-row"><div>${parts.join(' · ')}
    ${row.notes ? html`<div class="small muted">${row.notes}</div>` : ''}</div></li>`;
}

/**
 * One history, as a card that starts closed.
 *
 * The gap markers are drawn between rows rather than as a column, because a gap
 * is not a fact about either period — it is the space between them, which is
 * exactly what the practice asked to see: *"it must leave blank space if there
 * is a gap."*
 */
export function historyPanel(opts: {
  def: HistoryDef;
  rows: HistoryRow[];
  vocab: HistoryVocab;
  clientId: string;
  csrf: string;
  writable: boolean;
}): Raw {
  const { def, rows, vocab, clientId, csrf, writable } = opts;
  const gaps = def.showsGaps ? gapsIn(rows) : new Map<number, number>();
  const note = rows.length === 0 ? '' : `${rows.length} ${rows.length === 1 ? def.noun : `${def.noun}s`}`;

  return collapsibleCard(def.title, html`
    ${rows.length === 0
      ? emptyState(`Nothing recorded.`)
      : writable
        ? html`
          <form method="post" action="/clients/${clientId}/history/${def.key}">
            ${csrfField(csrf)}
            <div class="table-wrap">
              <table class="edit-table">
                <thead><tr>
                  <th>#</th>
                  ${def.columns.map((c) => html`<th>${c.label}</th>`)}
                  <th>Note</th><th></th>
                </tr></thead>
                <tbody>
                  ${rows.map((row, i) => html`
                    ${gaps.has(i) ? html`
                      <tr class="history-gap">
                        <td></td>
                        <td colspan="${String(def.columns.length + 2)}">
                          <span class="muted small">Gap of
                            ${String(Math.round(gaps.get(i)! / 30))} months</span></td>
                      </tr>` : ''}
                    <tr>
                      <td><input name="position_${row.id}" value="${String(i + 1)}" size="2"
                                 inputmode="numeric" aria-label="Order"></td>
                      ${def.columns.map((c) => html`<td>${cell(def, c, row, vocab)}</td>`)}
                      <td><input name="notes_${row.id}" value="${(row.notes ?? '')}"
                                 maxlength="${String(HISTORY_NOTE_MAX)}" size="20"
                                 aria-label="Note"></td>
                      ${'' /* A tick that marks the row to go when you save, drawn as the
                              red cross the rest of the register uses. Nothing happens
                              until Save, so a slip can be untitled. */}
                      <td class="row-action">
                        <label class="tick-remove">
                          <input type="checkbox" name="remove_${row.id}"
                                 aria-label="Remove this ${def.noun} when you save">
                          <span class="tick-remove-mark" aria-hidden="true">×</span>
                        </label>
                      </td>
                    </tr>`)}
                </tbody>
              </table>
            </div>
            <button class="btn btn-secondary btn-small" type="submit">Save the table</button>
          </form>`
        : html`<ul class="list">${rows.map((r) => readOnlyRow(def, r, vocab))}</ul>`}

    ${writable ? html`
      <details class="reveal mt">
        <summary class="btn btn-primary reveal-open">Add a ${def.noun}</summary>
        <form method="post" action="/clients/${clientId}/history/${def.key}/add" class="row-form">
          ${csrfField(csrf)}
          ${def.columns.map((c) => c.kind === 'vocab'
            ? select({ label: c.label, name: c.name, value: '',
                       options: optionsFor(c, vocab), includeBlank: 'Not recorded' })
            : c.kind === 'country'
              ? select({ label: c.label, name: c.name, value: '',
                         options: countryOptions(), includeBlank: 'Not recorded' })
              : c.kind === 'date'
                ? field({ label: c.label, name: c.name, maxlength: 10,
                          placeholder: 'YYYY-MM-DD',
                          hint: 'Or just the month: 2019-03.' })
                : field({ label: c.label, name: c.name, type: 'text',
                          maxlength: c.max ?? 200 }))}
          ${field({ label: 'Note', name: 'notes', maxlength: HISTORY_NOTE_MAX })}
          <button class="btn btn-primary" type="submit">Add it</button>
        </form>
      </details>` : ''}`, note);
}

/**
 * The military records block.
 *
 * **Asked for on 11 September 2026:** *"client must have a dedicated section on
 * military records - create the block but keep it as a placeholder for now."*
 *
 * So it is a heading and a sentence, and nothing else. There is deliberately no
 * table behind it: the shape of a military record is the part nobody has
 * decided — whether it is one period or several, whether a discharge and a rank
 * belong on it, whether it is a history like the three above or a set of facts
 * like the flat ones on a client. Guessing now would mean rebuilding, which is
 * the reason the three histories above waited a day for their shape to be
 * written down first.
 */
export function militaryPlaceholder(): Raw {
  return collapsibleCard('Military records', html`
    ${emptyState('Not built yet.')}`, 'placeholder');
}

/** What the client page needs to draw all four blocks. */
export const HISTORY_KEYS: HistoryKey[] = HISTORIES.map((h) => h.key);

/**
 * The two routes each history has, registered once for all three.
 *
 * Both write a file note. A history is a claim about somebody's life that goes
 * onto an application, and a register that cannot say when a period appeared or
 * who removed it is worse than one that never held it.
 */
export function registerHistoryRoutes(r: Hono<AppContext>): void {
  r.post('/:id/history/:key/add', requirePermission('register:write'), async (c) => {
    const id = c.req.param('id')!;
    const def = historyByKey(c.req.param('key')!);
    if (!def) return c.notFound();
    const client = await one<{ id: string }>(
      c.env.DB, 'SELECT id FROM clients WHERE id = ?', id);
    if (!client) return c.notFound();

    const f = new FormReader(await c.req.formData());
    const values = readHistoryRow(def, f);
    // A date in the wrong shape is refused rather than dropped. Without this
    // the row saved with that box empty, which is a quieter kind of wrong: the
    // period loses one of its ends and nothing says so.
    if (!f.valid) {
      return redirectWith(c, `/clients/${id}?open=history-${def.key}#history-${def.key}`,
        Object.values(f.errors)[0]!, 'err');
    }
    if (Object.values(values).every((v) => v === null)) {
      return redirectWith(c, `/clients/${id}?open=history-${def.key}#history-${def.key}`,
        'Fill in something first.', 'err');
    }

    try {
      await addHistoryRow(c.env, def, id, values, c.get('user')!.id);
    } catch (err) {
      // The refusals are the database's (migration 0089) and are reported in
      // its own words rather than re-stated here, so the two cannot drift.
      return redirectWith(c, `/clients/${id}#history-${def.key}`,
        (err as Error).message || 'That could not be saved.', 'err');
    }

    await addEntry(c.env, {
      entityType: 'client', entityId: id, kind: 'system',
      body: `${def.title}: a ${def.noun} added.`,
      createdBy: c.get('user')!.id,
    });
    await auditFrom(c, { action: 'client.history_added', entityType: 'client', entityId: id,
      meta: { history: def.key } });
    return redirectWith(c, `/clients/${id}#history-${def.key}`, `${def.title} updated.`);
  });

  r.post('/:id/history/:key', requirePermission('register:write'), async (c) => {
    const id = c.req.param('id')!;
    const def = historyByKey(c.req.param('key')!);
    if (!def) return c.notFound();
    const client = await one<{ id: string }>(
      c.env.DB, 'SELECT id FROM clients WHERE id = ?', id);
    if (!client) return c.notFound();

    const f = new FormReader(await c.req.formData());
    let saved;
    try {
      saved = await saveHistory(c.env, def, id, f);
    } catch (err) {
      return redirectWith(c, `/clients/${id}?open=history-${def.key}#history-${def.key}`,
        (err as Error).message || 'That could not be saved.', 'err');
    }
    // Same as the add: a date in the wrong shape is refused rather than
    // silently emptying one end of a period.
    if (!f.valid) {
      return redirectWith(c, `/clients/${id}?open=history-${def.key}#history-${def.key}`,
        Object.values(f.errors)[0]!, 'err');
    }

    if (saved.removed > 0) {
      await addEntry(c.env, {
        entityType: 'client', entityId: id, kind: 'system',
        body: `${def.title}: ${saved.removed} `
          + `${saved.removed === 1 ? def.noun : `${def.noun}s`} removed.`,
        createdBy: c.get('user')!.id,
      });
    }
    await auditFrom(c, { action: 'client.history_saved', entityType: 'client', entityId: id,
      meta: { history: def.key, ...saved } });
    return redirectWith(c, `/clients/${id}#history-${def.key}`,
      saved.removed > 0 ? `${def.title} saved, ${saved.removed} removed.` : `${def.title} saved.`);
  });
}

/** Kept here so the client page does not import from three places. */
export { HISTORIES, actionButton };
