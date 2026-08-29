/**
 * Searching the whole register from one box.
 *
 * Nine tables, one query each, run together. Not a search *engine*: no index,
 * no ranking model, no stemming. At the size a practice like this reaches —
 * thousands of records, not millions — a LIKE across nine small tables answers
 * in under a millisecond, and the register's standing preference is a fast
 * plain thing over a slow clever one. If that stops being true the answer is
 * FTS5, and it goes here.
 *
 * What matters more than speed is *what* is searched. A person looking for
 * "Kiwi Orchards" may be after the client, the matter, the invoice or a note
 * somebody left, and a search that only knew about clients would be the sort
 * that gets abandoned after a fortnight.
 */

import type { Env } from '../types';
import { all } from './db';

export type ResultKind =
  | 'client' | 'case' | 'quote' | 'invoice' | 'inquiry' | 'task' | 'article' | 'note' | 'document';

export interface SearchHit {
  kind: ResultKind;
  id: string;
  href: string;
  /** The line that names it. */
  title: string;
  /** What it belongs to, or what it is about. */
  detail: string | null;
  /** Sorted on: a reference typed in full beats a word found in a note. */
  weight: number;
}

export const KIND_LABELS: Record<ResultKind, string> = {
  client: 'Clients',
  case: 'Matters',
  quote: 'Quotes',
  invoice: 'Invoices',
  inquiry: 'Inquiries',
  task: 'Tasks',
  article: 'Knowledge base',
  note: 'File notes',
  document: 'Documents',
};

/** The order the groups are shown in — most often wanted first. */
export const KIND_ORDER: ResultKind[] = [
  'client', 'case', 'task', 'quote', 'invoice', 'inquiry', 'note', 'document', 'article',
];

/**
 * Fold a query into something a LIKE can use.
 *
 * Accents are stripped from the *query* only, which is deliberately half the
 * job: it means "Rawiri" is not yet found by typing "Rāwiri". Folding both
 * sides needs the stored side folded too, and that is a derived column with an
 * owner, not a change to a WHERE clause. Written down here so the limit is
 * known rather than discovered.
 */
export function normaliseQuery(raw: string): string {
  return raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

/** SQLite's LIKE treats these as wildcards; a person typing them means them. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function searchEverything(
  env: Env,
  rawQuery: string,
  opts: { perKind?: number; canSeeMoney?: boolean } = {},
): Promise<SearchHit[]> {
  const q = normaliseQuery(rawQuery);
  // One character matches most of the register and answers nothing.
  if (q.length < 2) return [];
  const like = likeTerm(q);
  const limit = opts.perKind ?? 8;

  const queries: Array<Promise<SearchHit[]>> = [
    all<any>(env.DB,
      `SELECT id, ref, full_name, email, phone, status FROM clients
        WHERE full_name LIKE ?1 ESCAPE '\\' OR ref LIKE ?1 ESCAPE '\\'
           OR email LIKE ?1 ESCAPE '\\' OR phone LIKE ?1 ESCAPE '\\'
           OR family_name LIKE ?1 ESCAPE '\\' OR given_names LIKE ?1 ESCAPE '\\'
           OR preferred_name LIKE ?1 ESCAPE '\\' OR nzbn LIKE ?1 ESCAPE '\\'
        ORDER BY CASE WHEN ref = ?2 THEN 0 ELSE 1 END, full_name LIMIT ?3`,
      like, q.toUpperCase(), limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'client' as const, id: r.id, href: `/clients/${r.id}`,
      title: r.full_name, detail: [r.ref, r.email].filter(Boolean).join(' · '),
      weight: r.ref?.toUpperCase() === q.toUpperCase() ? 0 : 1,
    }))),

    all<any>(env.DB,
      `SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name
         FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id
        WHERE k.title LIKE ?1 ESCAPE '\\' OR k.ref LIKE ?1 ESCAPE '\\'
           OR k.descriptor LIKE ?1 ESCAPE '\\' OR k.summary LIKE ?1 ESCAPE '\\'
           OR k.inz_application_number LIKE ?1 ESCAPE '\\'
           OR k.inz_client_number LIKE ?1 ESCAPE '\\'
           OR cl.full_name LIKE ?1 ESCAPE '\\'
        ORDER BY k.updated_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'case' as const, id: r.id, href: `/cases/${r.id}`,
      title: r.title,
      detail: [r.descriptor, r.ref, r.client_name].filter(Boolean).join(' · '),
      weight: r.ref?.toUpperCase() === q.toUpperCase() ? 0 : 1,
    }))),

    all<any>(env.DB,
      `SELECT t.id, t.title, t.details, t.status, t.completion_note, u.name AS owner
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.title LIKE ?1 ESCAPE '\\' OR t.details LIKE ?1 ESCAPE '\\'
           OR t.completion_note LIKE ?1 ESCAPE '\\'
        ORDER BY CASE WHEN t.status IN ('open','in_progress','blocked') THEN 0 ELSE 1 END,
                 t.due_at LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'task' as const, id: r.id, href: `/tasks#${r.id}`,
      title: r.title, detail: [r.status, r.owner].filter(Boolean).join(' · '),
      weight: 2,
    }))),

    all<any>(env.DB,
      `SELECT q.id, q.ref, q.description, q.status, cl.full_name AS client_name
         FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id
        WHERE q.ref LIKE ?1 ESCAPE '\\' OR q.description LIKE ?1 ESCAPE '\\'
           OR q.notes LIKE ?1 ESCAPE '\\' OR cl.full_name LIKE ?1 ESCAPE '\\'
        ORDER BY q.created_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'quote' as const, id: r.id, href: `/quotes/${r.id}`,
      title: r.description || r.ref,
      detail: [r.ref, r.client_name, r.status].filter(Boolean).join(' · '),
      weight: 2,
    }))),

    all<any>(env.DB,
      `SELECT i.id, i.ref, i.description, i.status, cl.full_name AS client_name
         FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
        WHERE i.ref LIKE ?1 ESCAPE '\\' OR i.description LIKE ?1 ESCAPE '\\'
           OR i.notes LIKE ?1 ESCAPE '\\' OR cl.full_name LIKE ?1 ESCAPE '\\'
        ORDER BY i.created_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'invoice' as const, id: r.id, href: `/invoices/${r.id}`,
      title: r.description || r.ref,
      detail: [r.ref, r.client_name, r.status].filter(Boolean).join(' · '),
      weight: 2,
    }))),

    all<any>(env.DB,
      `SELECT id, ref, subject, contact_name, contact_email, status FROM inquiries
        WHERE ref LIKE ?1 ESCAPE '\\' OR subject LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\'
           OR contact_name LIKE ?1 ESCAPE '\\' OR contact_email LIKE ?1 ESCAPE '\\'
        ORDER BY received_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'inquiry' as const, id: r.id, href: `/inquiries/${r.id}`,
      title: r.subject || r.contact_name || r.ref,
      detail: [r.ref, r.contact_name, r.status].filter(Boolean).join(' · '),
      weight: 3,
    }))),

    // File notes are where the answer often actually is — what was advised, and
    // when. Only the body is searched; the entry's own kind is shown so a
    // system line is not mistaken for something a person wrote.
    all<any>(env.DB,
      `SELECT id, entity_type, entity_id, kind, body, occurred_at FROM entries
        WHERE body LIKE ?1 ESCAPE '\\'
        ORDER BY occurred_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'note' as const, id: r.id,
      href: r.entity_type === 'case' ? `/cases/${r.entity_id}`
        : r.entity_type === 'client' ? `/clients/${r.entity_id}`
        : `/${r.entity_type}s/${r.entity_id}`,
      title: r.body,
      detail: [r.kind, r.occurred_at?.slice(0, 10)].filter(Boolean).join(' · '),
      weight: 4,
    }))),

    all<any>(env.DB,
      `SELECT id, entity_type, entity_id, filename, description FROM documents
        WHERE filename LIKE ?1 ESCAPE '\\' OR description LIKE ?1 ESCAPE '\\'
        ORDER BY uploaded_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'document' as const, id: r.id,
      href: r.entity_type === 'case' ? `/cases/${r.entity_id}` : `/clients/${r.entity_id}`,
      title: r.filename, detail: r.description,
      weight: 4,
    }))),

    all<any>(env.DB,
      `SELECT id, ref, title, summary, status FROM kb_articles
        WHERE title LIKE ?1 ESCAPE '\\' OR summary LIKE ?1 ESCAPE '\\'
           OR body LIKE ?1 ESCAPE '\\' OR ref LIKE ?1 ESCAPE '\\'
        ORDER BY updated_at DESC LIMIT ?2`,
      like, limit,
    ).then((rows) => rows.map((r) => ({
      kind: 'article' as const, id: r.id, href: `/knowledge/${r.id}`,
      title: r.title, detail: [r.ref, r.status].filter(Boolean).join(' · '),
      weight: 3,
    }))),
  ];

  const groups = await Promise.all(queries);
  return groups.flat().sort((a, b) => a.weight - b.weight);
}
