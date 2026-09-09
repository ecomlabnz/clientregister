/**
 * Removing a record that should never have existed.
 *
 * **Asked for on 9 September 2026:** *"owner must be able to delete a case - i
 * have just created one - a duplicate!"*, then *"the same for clients"*. An
 * intake that ran twice had left a duplicate matter and three empty people.
 *
 * Two things live here rather than in either module, because there are two
 * delete buttons and the register's own history says the second one is where
 * the rule gets forgotten. Everything about *whether* a record may go is in
 * migration 0076, in the database; this is only how a person is asked, and how
 * the database's answer is read back to them.
 */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import { one } from './db';
import { html, type Raw } from '../ui/html';
import { card, csrfField, field } from '../ui/components';
import { can } from './rbac';

/**
 * The database's own words when it refuses a delete.
 *
 * Every refusal in 0076 is already a sentence a person can act on — "This
 * matter has an invoice against it. An invoice has to say what it was for, so
 * void or move the invoice first." — so this lifts it out of whatever D1
 * wrapped it in, rather than keeping a second copy of the rule in TypeScript to
 * go stale against the first.
 */
export function deleteRefusal(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  const message = text
    .replace(/^.*?D1_ERROR:\s*/is, '')
    .replace(/:\s*SQLITE_[A-Z_]+\s*$/i, '')
    .trim();

  // **The full stop is the test, and it is not a stylistic one.** D1 wraps a
  // refusal as `D1_ERROR: <message>: SQLITE_CONSTRAINT_TRIGGER`; `node:sqlite`,
  // which the tests run on, throws the message bare. Matching on the wrapper
  // therefore worked in production and silently fell back to "That could not be
  // deleted" under test — found by the tests failing, which is the only reason
  // this comment exists.
  //
  // So the wrapper is stripped if present and the sentence is recognised by
  // being one. Every refusal this register writes is a sentence ending in a
  // full stop; every message SQLite writes itself — "FOREIGN KEY constraint
  // failed", "UNIQUE constraint failed: cases.ref" — is a fragment that does
  // not. A person gets our words or a plain fallback, never SQLite's.
  const ours = message.includes(' ') && message.endsWith('.') && message.length < 400;
  return ours ? message : null;
}

/** One reason a record cannot go yet, in words, with what to do instead. */
export interface Obstacle { count: number; says: Raw }

/**
 * The card at the foot of an edit page.
 *
 * It always says what deleting would take with it, in numbers. The duplicate
 * that prompted this carried a file note written four minutes earlier and
 * nothing on the screen said so — a confirmation that only asks "are you sure"
 * is asking about the wrong thing.
 */
export function deleteCard(opts: {
  csrf: string;
  ref: string;
  what: string;
  action: string;
  intro: Raw;
  obstacles: Obstacle[];
  toll: Raw;
}): Raw {
  const blocking = opts.obstacles.filter((o) => o.count > 0);
  return card(`Delete this ${opts.what}`, html`
    <p class="small">${opts.intro}</p>
    ${blocking.length > 0 ? html`
      <p class="small"><strong>This one cannot be deleted yet.</strong></p>
      <ul class="small">${blocking.map((o) => html`<li>${o.says}</li>`)}</ul>` : html`
      <p class="small">${opts.toll} <strong>This cannot be undone.</strong> It is recorded in
         the audit log, and the reference is retired rather than reissued.</p>
      <form method="post" action="${opts.action}"
            data-confirm="${`Delete ${opts.ref}? This cannot be undone.`}">
        ${csrfField(opts.csrf)}
        ${field({ label: `Type ${opts.ref} to confirm`, name: 'confirm_ref', required: true,
                  maxlength: 20,
                  hint: 'Deliberately awkward. It is the last step before a record stops existing.' })}
        <button class="btn btn-danger" type="submit">Delete this ${opts.what}</button>
      </form>`}`);
}

/** What deleting a client would take with it, and what stops it. */
export async function clientDeleteCard(
  c: Context<AppContext>, client: { id: string; ref: string },
): Promise<Raw> {
  if (!can(c.get('user')!, 'register:delete')) return html``;
  const t = await one<{
    matters: number; parties: number; notes: number; docs: number;
    live_quotes: number; invoices: number; draft_quotes: number; system_notes: number;
  }>(c.env.DB, `SELECT
      (SELECT COUNT(*) FROM cases WHERE client_id = ?1) AS matters,
      (SELECT COUNT(*) FROM case_parties WHERE client_id = ?1) AS parties,
      (SELECT COUNT(*) FROM entries WHERE entity_type='client' AND entity_id = ?1 AND kind <> 'system') AS notes,
      (SELECT COUNT(*) FROM entries WHERE entity_type='client' AND entity_id = ?1 AND kind = 'system') AS system_notes,
      (SELECT COUNT(*) FROM documents WHERE entity_type='client' AND entity_id = ?1) AS docs,
      (SELECT COUNT(*) FROM quotes WHERE client_id = ?1 AND status IN ('sent','accepted')) AS live_quotes,
      (SELECT COUNT(*) FROM quotes WHERE client_id = ?1 AND status NOT IN ('sent','accepted')) AS draft_quotes,
      (SELECT COUNT(*) FROM invoices WHERE client_id = ?1) AS invoices`, client.id);
  if (!t) return html``;

  return deleteCard({
    csrf: c.get('session')!.csrf,
    ref: client.ref, what: 'client', action: `/clients/${client.id}/delete`,
    intro: html`For a record created by mistake — a duplicate, or an empty one an intake left
      behind. It is <strong>not</strong> how somebody who is no longer a client is put away:
      for that, archive them, which keeps the file and stops the alerts.`,
    obstacles: [
      { count: t.matters, says: html`<strong>${t.matters}</strong> matter(s) on their file.
        Delete or move those first — each one is its own decision.` },
      { count: t.invoices, says: html`<strong>${t.invoices}</strong> invoice(s). An invoice has
        to say who it was for. Void or move it first.` },
      { count: t.live_quotes, says: html`<strong>${t.live_quotes}</strong> quotation(s) already
        sent or accepted. The letter of engagement is a contract.` },
      { count: t.docs, says: html`<strong>${t.docs}</strong> document(s) held. Remove them one at
        a time first, or the files are left stored with nothing pointing at them.` },
      { count: t.notes, says: html`<strong>${t.notes}</strong> note(s) on their file. A note
        cannot be deleted and there is nowhere to move it to — archive them instead.` },
      { count: t.parties, says: html`Named on <strong>${t.parties}</strong> other matter(s).
        Take them off those first.` },
    ],
    toll: html`Deleting <strong>${client.ref}</strong> removes their details, their
      nationalities and passports, and <strong>${t.system_notes}</strong> entr${t.system_notes === 1 ? 'y' : 'ies'}
      the register wrote about them.
      ${t.draft_quotes > 0 ? html`<strong>${t.draft_quotes}</strong> draft quotation(s) stay, no
        longer attached to anybody.` : ''}`,
  });
}

/** What deleting a matter would take with it, and what stops it. */
export async function caseDeleteCard(
  c: Context<AppContext>, kase: { id: string; ref: string },
): Promise<Raw> {
  if (!can(c.get('user')!, 'register:delete')) return html``;
  const t = await one<{
    entries: number; tasks: number; parties: number; documents: number;
    invoices: number; live_quotes: number; draft_quotes: number;
  }>(c.env.DB, `SELECT
      (SELECT COUNT(*) FROM entries WHERE entity_type='case' AND entity_id = ?1) AS entries,
      (SELECT COUNT(*) FROM tasks WHERE entity_type='case' AND entity_id = ?1) AS tasks,
      (SELECT COUNT(*) FROM case_parties WHERE case_id = ?1) AS parties,
      (SELECT COUNT(*) FROM documents WHERE entity_type='case' AND entity_id = ?1) AS documents,
      (SELECT COUNT(*) FROM invoices WHERE case_id = ?1) AS invoices,
      (SELECT COUNT(*) FROM quotes WHERE case_id = ?1 AND status IN ('sent','accepted')) AS live_quotes,
      (SELECT COUNT(*) FROM quotes WHERE case_id = ?1 AND status NOT IN ('sent','accepted')) AS draft_quotes`,
    kase.id);
  if (!t) return html``;

  return deleteCard({
    csrf: c.get('session')!.csrf,
    ref: kase.ref, what: 'matter', action: `/cases/${kase.id}/delete`,
    intro: html`For a matter opened by mistake — a duplicate, or one against the wrong person.
      It is <strong>not</strong> how a matter that came to nothing is closed: for that, set the
      status to <strong>Withdrawn</strong> or <strong>Closed</strong>, which keeps the file.`,
    obstacles: [
      { count: t.invoices, says: html`<strong>${t.invoices}</strong> invoice(s) against it. An
        invoice has to say what it was for. Void or move it first.` },
      { count: t.live_quotes, says: html`<strong>${t.live_quotes}</strong> quotation(s) already
        sent or accepted. Withdraw it, or take the matter off it.` },
      { count: t.documents, says: html`<strong>${t.documents}</strong> document(s) held. Remove
        them one at a time first, or the files are left stored with nothing pointing at them.` },
    ],
    toll: html`<strong>${t.entries}</strong> timeline
      ${t.entries === 1 ? 'entry moves' : 'entries move'} onto the client's own file —
      a note cannot be destroyed, so nothing written here is lost.
      <strong>${t.tasks}</strong> task(s) and <strong>${t.parties}</strong> named
      ${t.parties === 1 ? 'person goes' : 'people go'} with the matter.
      ${t.draft_quotes > 0 ? html`<strong>${t.draft_quotes}</strong> draft quotation(s) stay, no
        longer attached to a matter.` : ''}`,
  });
}
