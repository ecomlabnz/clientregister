/**
 * Taking the data out.
 *
 * A practice's records are the practice's, and a system that makes them hard to
 * leave with is holding them hostage however good its intentions. Everything
 * here is one link and one file: no queue, no email, no "we will prepare your
 * export".
 *
 * One thing is deliberately not exported: passport numbers. They show on each
 * client's own page, but a spreadsheet in a downloads folder is the copy that
 * actually escapes, so the export says only whether a passport is on file. If
 * the whole set is genuinely needed, that is a deliberate operation and should
 * look like one, rather than riding along inside a routine download.
 *
 * The backup below is that deliberate operation, and it is a different thing
 * from an export. An export is for reading somewhere else; a backup is for
 * putting the register back, so it holds every table and every column,
 * passport numbers included. It is the owner's button alone, it posts rather
 * than links, and taking one is recorded.
 */

import type { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import { requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { all } from '../../core/db';
import { exportFilename, toCsv } from '../../core/csv';
import { backupFilename, makeBackup } from '../../core/backup';
import { backupState } from '../../core/autobackup';
import { dateShort } from '../../ui/format';
import { can } from '../../core/rbac';
import { APP_VERSION } from '../../version';
import { page } from '../../ui/layout';
import { html } from '../../ui/html';
import { card, csrfField, pageHeader, table } from '../../ui/components';
import { adminTabs } from './index';

interface Dataset {
  key: string;
  label: string;
  description: string;
  sql: string;
}

/**
 * What can be taken. Written as explicit column lists rather than `SELECT *`,
 * so a column added later is a decision to export it rather than an accident —
 * which is how a sealed field ends up in a spreadsheet.
 */
export const DATASETS: Dataset[] = [
  {
    key: 'clients', label: 'Clients',
    description: 'Everyone on the register, with contact details, nationality, visa and English. '
      + 'Passport numbers are excluded; the column says only whether one is held.',
    // Nationality goes out as the country's name as well as its code: an
    // export is read by a person, and a spreadsheet column of "VN" answers
    // nothing. The code goes too, because an export is also read by the next
    // system, and that one wants the code. Both are lists — a person may hold
    // more than one nationality — in the order the practice entered them, so
    // the first is the one it would name first.
    sql: `SELECT c.ref, c.kind, c.full_name, c.given_names, c.family_name, c.preferred_name, c.nzbn,
                 c.company_number, c.email, c.phone, c.whatsapp, c.telegram_username,
                 (SELECT GROUP_CONCAT(n.code, ' ') FROM (
                    SELECT code FROM client_nationalities WHERE client_id = c.id
                     ORDER BY position, code) n) AS nationality_code,
                 (SELECT GROUP_CONCAT(n.name, ' · ') FROM (
                    SELECT co.name AS name FROM client_nationalities cn
                      JOIN countries co ON co.code = cn.code
                     WHERE cn.client_id = c.id ORDER BY cn.position, cn.code) n) AS nationality,
                 c.date_of_birth,
                 -- One column again since 0073. This used to collect the
                 -- distinct numbers off the person's matters and join them with
                 -- a space, because that is where the number was stored — and a
                 -- value that has to be reassembled from four rows has the wrong
                 -- owner. It is the person's now.
                 c.inz_client_number,
                 CASE WHEN c.passport_number IS NULL THEN 'no' ELSE 'yes' END AS passport_on_file,
                 c.passport_country, c.passport_expiry, c.current_visa_type, c.current_visa_expiry,
                 c.english_test_type, c.english_test_score, c.english_test_date,
                 c.address, c.status, c.created_at, c.updated_at
            FROM clients c
           ORDER BY c.ref`,
  },
  {
    key: 'cases', label: 'Matters',
    description: 'Every case, its type, status, INZ numbers and dates.',
    sql: `SELECT k.ref, cl.ref AS client_ref, cl.full_name AS client, k.title, k.case_type,
                 k.status, k.priority, u.name AS owner, k.inz_application_number,
                 -- The client's, so a matter export still carries it, but named
                 -- as what it is: one number per person, not per application.
                 cl.inz_client_number,
                 k.lodged_at, k.decision_due_at, k.decided_at, k.outcome,
                 k.next_action, k.next_action_due, k.summary, k.created_at, k.updated_at
            FROM cases k
            LEFT JOIN clients cl ON cl.id = k.client_id
            LEFT JOIN users u ON u.id = k.assigned_to
           ORDER BY k.ref`,
  },
  {
    key: 'parties', label: 'Parties to matters',
    description: 'Who is involved in each matter, and in what role.',
    sql: `SELECT k.ref AS case_ref, cl.ref AS client_ref, cl.full_name AS client, p.role, p.notes,
                 p.created_at
            FROM case_parties p
            JOIN cases k ON k.id = p.case_id
            JOIN clients cl ON cl.id = p.client_id
           ORDER BY k.ref, p.role`,
  },
  {
    key: 'passports', label: 'Passports',
    description: 'Every passport on file, including second and third ones and those replaced. '
      + 'Numbers are excluded; the column says only whether one is held.',
    sql: `SELECT cl.ref AS client_ref, cl.full_name AS client, p.country, p.issued_on,
                 p.expires_on, p.status,
                 CASE WHEN p.is_primary = 1 THEN 'yes' ELSE 'no' END AS is_primary,
                 CASE WHEN p.number IS NULL THEN 'no' ELSE 'yes' END AS number_on_file,
                 p.notes, p.created_at
            FROM client_passports p
            JOIN clients cl ON cl.id = p.client_id
           ORDER BY cl.ref, p.is_primary DESC, p.expires_on`,
  },
  {
    key: 'certificates', label: 'Certificates',
    description: 'Police certificates, medicals and x-rays, including superseded ones.',
    sql: `SELECT cl.ref AS client_ref, cl.full_name AS client, c.kind, c.subtype, c.country,
                 c.reference, c.issued_on, c.expires_on, c.notes, c.created_at
            FROM client_certificates c JOIN clients cl ON cl.id = c.client_id
           ORDER BY cl.ref, c.kind, c.issued_on DESC`,
  },
  {
    key: 'quotes', label: 'Quotes',
    description: 'Quotes with their totals and how they landed.',
    sql: `SELECT q.ref, cl.full_name AS client, k.ref AS case_ref, q.description, q.status,
                 q.amount_cents, q.gst_cents, q.disbursements_cents,
                 printf('%.2f', (q.amount_cents + q.gst_cents + q.disbursements_cents) / 100.0) AS total_dollars,
                 q.issued_on, q.valid_until, q.sent_at, q.responded_at, q.created_at
            FROM quotes q
            LEFT JOIN clients cl ON cl.id = q.client_id
            LEFT JOIN cases k ON k.id = q.case_id
           ORDER BY q.ref`,
  },
  {
    key: 'quote_items', label: 'Quote lines',
    description: 'The itemisation behind each quote.',
    sql: `SELECT q.ref AS quote_ref, i.position, i.description, i.kind, i.unit_label,
                 i.quantity_milli, i.unit_amount_cents, i.gst_treatment,
                 i.net_cents, i.gst_cents, i.gross_cents
            FROM quote_items i JOIN quotes q ON q.id = i.quote_id
           ORDER BY q.ref, i.position`,
  },
  {
    key: 'invoices', label: 'Invoices',
    description: 'Invoices, what they were for, and what has been paid.',
    sql: `SELECT i.ref, cl.full_name AS client, k.ref AS case_ref, q.ref AS quote_ref,
                 i.description, i.status, i.issued_on, i.due_on,
                 i.net_cents, i.gst_cents, i.gross_cents, i.paid_cents,
                 printf('%.2f', i.gross_cents / 100.0) AS total_dollars,
                 printf('%.2f', (i.gross_cents - i.paid_cents) / 100.0) AS owing_dollars,
                 i.xero_invoice_id, i.void_reason, i.created_at
            FROM invoices i
            LEFT JOIN clients cl ON cl.id = i.client_id
            LEFT JOIN cases k ON k.id = i.case_id
            LEFT JOIN quotes q ON q.id = i.quote_id
           ORDER BY i.ref`,
  },
  {
    key: 'invoice_items', label: 'Invoice lines',
    description: 'The itemisation behind each invoice.',
    sql: `SELECT i.ref AS invoice_ref, x.position, x.description, x.kind, x.unit_label,
                 x.quantity_milli, x.unit_amount_cents, x.gst_treatment,
                 x.net_cents, x.gst_cents, x.gross_cents
            FROM invoice_items x JOIN invoices i ON i.id = x.invoice_id
           ORDER BY i.ref, x.position`,
  },
  {
    key: 'payments', label: 'Payments',
    description: 'Money received against invoices.',
    sql: `SELECT i.ref AS invoice_ref, p.paid_on, p.amount_cents,
                 printf('%.2f', p.amount_cents / 100.0) AS amount_dollars,
                 p.method, p.reference, p.note, u.name AS recorded_by, p.created_at
            FROM invoice_payments p
            JOIN invoices i ON i.id = p.invoice_id
            LEFT JOIN users u ON u.id = p.created_by
           ORDER BY i.ref, p.paid_on`,
  },
  {
    key: 'tasks', label: 'Tasks',
    description: 'Every task, open and closed, and who it belongs to.',
    sql: `SELECT t.title, t.status, t.priority, t.due_at, u.name AS assigned_to,
                 t.entity_type, t.entity_id, t.details, t.created_at, t.completed_at
            FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
           ORDER BY t.due_at`,
  },
  {
    key: 'notes', label: 'Notes and timeline',
    description: 'Every file note and system entry, against the record it belongs to.',
    sql: `SELECT e.entity_type, e.entity_id, e.kind, e.occurred_at, u.name AS author, e.body,
                 e.created_at
            FROM entries e LEFT JOIN users u ON u.id = e.created_by
           ORDER BY e.occurred_at DESC`,
  },
  {
    key: 'inquiries', label: 'Inquiries',
    description: 'Enquiries received, and what became of them.',
    sql: `SELECT ref, source, contact_name, contact_email, contact_phone, subject, status,
                 received_at, created_at
            FROM inquiries ORDER BY received_at DESC`,
  },
  {
    key: 'knowledge', label: 'Knowledge base',
    description: 'Articles with their publication and effective dates.',
    sql: `SELECT ref, title, kind, status, published_at, effective_at, review_at, expires_at,
                 source, source_ref, summary, body, created_at, updated_at
            FROM kb_articles ORDER BY ref`,
  },
  {
    key: 'vocabulary', label: 'Dropdown lists',
    description: 'Every list an administrator can edit — case types, visa types, document '
      + 'categories, English tests — as key and label. The intake needs the case-type keys, '
      + 'and they change without a deployment, so they are exported rather than written down.',
    // The lists live in `settings` as one row of `key | Label` lines each,
    // because that is what an administrator edits in a textarea. Splitting them
    // here means the export cannot go stale against the page that edits them.
    // Carriage returns are stripped first: the textarea posts CRLF, and a key
    // with an invisible \r on the end matches nothing.
    sql: `WITH RECURSIVE src(list, rest) AS (
             SELECT substr(key, 7),
                    replace(replace(value, char(13), ''), char(10) || char(10), char(10)) || char(10)
               FROM settings WHERE key LIKE 'vocab.%'
           ), split(list, rest, line) AS (
             SELECT list, rest, NULL FROM src
             UNION ALL
             SELECT list, substr(rest, instr(rest, char(10)) + 1),
                    substr(rest, 1, instr(rest, char(10)) - 1)
               FROM split WHERE instr(rest, char(10)) > 0
           )
           SELECT list,
                  trim(substr(line, 1, instr(line || '|', '|') - 1)) AS key,
                  trim(substr(line, instr(line || '|', '|') + 1)) AS label
             FROM split
            WHERE line IS NOT NULL AND trim(line) <> ''
            ORDER BY list, key`,
  },
  {
    key: 'audit', label: 'Audit log',
    description: 'Every action taken in the register, by whom and when.',
    sql: `SELECT at, actor_label, action, entity_type, entity_id, ip, meta_json
            FROM audit_log ORDER BY at DESC`,
  },
];

/** A cap, so one link cannot try to hold the whole database in memory. */
const MAX_ROWS = 20_000;

export function registerExportRoutes(r: Hono<AppContext>): void {
  r.get('/export', requirePermission('admin:settings'), async (c) => {
    const counts = await countEach(c.env);
    const backup = await backupState(c.env);
    return page(c, { title: 'Export', active: '/admin' }, html`
      ${pageHeader('Export')}
      ${adminTabs('export')}

      ${card('What you can take', html`
        <p class="small">Each is a CSV: comma-separated, UTF-8 with a byte-order mark so Excel
           reads macrons correctly, and quoted to the standard. They open in Excel, Numbers,
           Google Sheets, or anything that reads a text file.</p>
        ${table([
          { label: 'What', width: '22' },
          { label: 'Rows', width: '10', align: 'right' },
          { label: 'Contains', width: '52' },
          { label: '', width: '16' },
        ], DATASETS.map((set) => html`
          <tr>
            <td><strong>${set.label}</strong></td>
            <td class="num">${counts[set.key] ?? 0}</td>
            <td class="small muted">${set.description}</td>
            <td><a class="btn btn-secondary btn-small" href="${`/admin/export/${set.key}.csv`}">Download</a></td>
          </tr>`), { fixed: true })}`)}

      ${'' /* **Whether the nightly backup is actually happening.**
               A backup that stops is worse than none, because it is believed
               in — so this is drawn before the button rather than after it, and
               says the date rather than "enabled". Asked for on 12 September
               2026; see `core/autobackup.ts`. */}
      ${can(c.get('user')!, 'backup:take') ? card('Every night, by itself', html`
        ${!backup.possible ? html`
          <div class="alert alert-warn">
            <p><strong>There is nowhere to write one.</strong> This register has no document
               store, so nothing is being backed up automatically. Everything else works;
               this does not.</p>
          </div>`
          : !backup.enabled ? html`
          <div class="alert alert-warn">
            <p><strong>Nightly backups are switched off.</strong> Turn them on under
               Settings → Nightly backup.</p>
          </div>`
          : backup.stale ? html`
          <div class="alert alert-error">
            <p><strong>${backup.lastAt
              ? `The last backup was ${dateShort(backup.lastAt)}.`
              : 'No backup has been taken yet.'}</strong>
               One is due every night. If this does not clear by tomorrow morning, something
               is wrong and the register is running without a copy.</p>
          </div>`
          : html`
          <div class="alert">
            <p><strong>Last backup: ${dateShort(backup.lastAt!)}.</strong>
               ${backup.lastBytes ? `${Math.max(1, Math.round(backup.lastBytes / 1024))} KB.` : ''}
               Taken automatically, every night.</p>
          </div>`}
        <p class="small">It holds every table and every column, including passport numbers — the
           whole register except the documents themselves, which are already in the same store it
           is written to. It is kept for 30 nights by default, and the newest is never removed.</p>
        <p class="hint">This protects against the database: rows deleted by mistake, a bad change,
           the database itself gone. It does <strong>not</strong> protect against losing the
           Cloudflare account, because it is written inside it. For that, take one of the copies
           below and keep it somewhere else.</p>`) : ''}

      ${can(c.get('user')!, 'backup:take') ? card('A copy of everything', html`
        <p class="small">The exports above are for reading somewhere else. This is the other thing:
           a copy of the <strong>whole register</strong> — every table, every column, every file —
           in one zip, for putting the register back if it is ever lost.</p>
        <p class="small"><strong>It includes passport numbers.</strong> A backup that leaves a
           column out cannot restore the register, and a backup you cannot restore from is a file
           that makes people feel safe without being safe. That is why this button is yours alone
           and nobody else's, and why the file says on the outside what it holds.</p>
        <form method="post" action="/admin/backup">
          ${csrfField(c.get('session')!.csrf)}
          <button class="btn btn-primary" type="submit">Download a full backup</button>
        </form>
        <p class="hint">It takes a few seconds and arrives as one file, dated. Treat it the way you
           would treat the filing cabinet: not something to email, and a copy on a laptop is a copy
           of everything about every client. Taking one is recorded in the audit log.</p>`) : ''}

      ${card('Two things worth knowing', html`
        <p class="small"><strong>Passport numbers are not in any of these.</strong> They stay out of
           the CSVs by the practice's decision of 30 August 2026: a spreadsheet in a downloads
           folder is the copy that actually escapes, and nothing about reading a number on a
           client's page requires making that easier. The client export says only whether a
           passport is held.</p>
        <p class="small"><strong>Every download is recorded</strong> in the audit log — what was
           taken, by whom, and when. An export is a copy of the practice's file leaving the
           building, and that is worth a line.</p>
        <p class="small muted">Reading data back in is a separate job and is not built yet: an
           import has to decide what to do about records that already exist, and getting that
           wrong is worse than not having it.</p>`)}`);
  });

  /**
   * The whole register, in one file.
   *
   * A POST rather than a link, though it only reads: this is the practice's
   * entire client file leaving the building, and the file's own words are that
   * such a thing "should look like one, rather than riding along inside a
   * routine download". A form with a token cannot be triggered by a link
   * somebody was sent.
   *
   * `backup:take` belongs to the owner and to nobody else — not even to an
   * administrator, who can otherwise do everything here. That is the practice's
   * decision of 9 September 2026 and the reason the archive is allowed to carry
   * passport numbers at all.
   *
   * The audit row is written before the bytes go out, so a backup that was
   * started is recorded even if the download is abandoned. What it cannot say
   * is where the file went afterwards; nothing can.
   */
  r.post('/backup', requirePermission('backup:take'), async (c) => {
    const user = c.get('user')!;
    const { zip, summary } = await makeBackup(c.env, {
      version: APP_VERSION,
      takenBy: `${user.name} <${user.email}>`,
    });

    await auditFrom(c, {
      action: 'admin.backup_taken', entityType: 'backup', entityId: summary.takenAt,
      meta: {
        tables: summary.tables.length,
        rows: summary.tables.reduce((n, t) => n + t.rows, 0),
        files: summary.files,
        file_bytes: summary.fileBytes,
        zip_bytes: summary.bytes,
        contains_passport_numbers: true,
      },
    });

    return new Response(zip, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${backupFilename(summary.takenAt)}"`,
        'content-length': String(zip.length),
        'cache-control': 'no-store',
      },
    });
  });

  r.get('/export/:key{.+\\.csv}', requirePermission('admin:settings'), async (c) => {
    const key = (c.req.param('key') ?? '').replace(/\.csv$/, '');
    const set = DATASETS.find((d) => d.key === key);
    if (!set) return c.notFound();

    const rows = await all<Record<string, unknown>>(c.env.DB, `${set.sql} LIMIT ${MAX_ROWS}`);
    const first = rows[0];
    const headers = first ? Object.keys(first) : [];
    const body = toCsv(headers, rows);

    await auditFrom(c, {
      action: 'admin.exported', entityType: 'export', entityId: set.key,
      meta: { rows: rows.length, truncated: rows.length >= MAX_ROWS },
    });

    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${exportFilename(set.key)}"`,
        'cache-control': 'no-store',
      },
    });
  });
}

async function countEach(env: Env): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const set of DATASETS) {
    try {
      const rows = await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM (${set.sql})`);
      out[set.key] = rows[0]?.n ?? 0;
      // A dataset whose table does not exist yet counts as empty rather than
      // taking the page down with it.
    } catch {
      out[set.key] = 0;
    }
  }
  return out;
}
