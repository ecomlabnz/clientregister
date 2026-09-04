/**
 * The knowledge base: kinds, follow-ups, and how an article's body is rendered.
 *
 * Two design decisions worth stating, because both are about being able to
 * change the system later without a deployment:
 *
 *  - **Kinds are configuration, not an enumeration.** Visa packs, circulars,
 *    legal material and announcements are what the practice needs today; the
 *    next one is not knowable from here. The list lives in settings and is
 *    validated on write, so a new kind is a line in a text box, while nothing
 *    unrecognised can ever reach the database.
 *
 *  - **Follow-ups are reconciled, not fired.** An article with a date that
 *    matters gets a task, due a configurable number of days before it. That is
 *    recomputed from the article every time it is saved and again every night,
 *    so changing the lead time — or the date — corrects every existing task
 *    instead of leaving a trail of stale ones nobody trusts.
 */

import type { Env } from '../types';
import { all, allByIds, nowIso, one, run } from './db';
import { newId } from './ids';
import { readSettings, asBoolean, asInteger, type SettingsGroup } from './settings';
import type { Raw } from '../ui/html';
import { renderRichText } from './richtext';

export const KB_STATUSES = ['draft', 'published', 'superseded', 'archived'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const KB_STATUS_LABELS: Record<KbStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  superseded: 'Superseded',
  archived: 'Archived',
};

export const KB_SOURCES = ['manual', 'email', 'telegram', 'whatsapp', 'web', 'other'] as const;
export type KbSource = (typeof KB_SOURCES)[number];

/** The dates an article can carry that someone may need reminding about. */
export const FOLLOWUP_KINDS = ['effective', 'review', 'expiry'] as const;
export type FollowUpKind = (typeof FOLLOWUP_KINDS)[number];

const FOLLOWUP_WORDING: Record<FollowUpKind, { column: 'effective_at' | 'review_at' | 'expires_at'; verb: string }> = {
  effective: { column: 'effective_at', verb: 'takes effect' },
  review: { column: 'review_at', verb: 'is due for review' },
  expiry: { column: 'expires_at', verb: 'stops applying' },
};

const DEFAULT_KINDS = [
  'visa_pack | Visa pack',
  'circular | Internal circular',
  'legal | Legal material',
  'announcement | Announcement',
  'instructions | Immigration instructions',
  'policy | Policy and procedure',
  'template | Template or precedent',
  'guide | How-to guide',
  // Asked for on 4 September 2026. The catch-all the practice actually reaches
  // for: what we do about a thing, written down, that is not an instruction
  // from anybody outside.
  'practice_note | General practice note',
].join('\n');

export const KNOWLEDGE_SETTINGS: SettingsGroup = {
  id: 'knowledge',
  title: 'Knowledge base',
  description:
    'What the knowledge base holds, and when it reminds you. Kinds take one per line, ' +
    'written as “key | Label”. The key is what is stored and cannot contain spaces; ' +
    'renaming a label is free, but changing a key leaves existing articles on the old one.',
  order: 40,
  settings: [
    { key: 'kb.kinds', type: 'text', label: 'Kinds of article', default: DEFAULT_KINDS, maxLength: 2000 },
    { key: 'kb.followups_enabled', type: 'boolean', label: 'Create follow-up tasks automatically', default: 'true',
      help: 'When an article carries a date that matters, raise a task against it.' },
    { key: 'kb.followup_lead_days', type: 'integer', label: 'How many days ahead', default: '7', min: 0, max: 180,
      help: '7 gives you a week’s warning. 0 raises the task on the day itself. Changing this corrects every existing follow-up overnight.' },
    { key: 'kb.followup_priority', type: 'enum', label: 'Priority of those tasks', default: 'normal',
      options: [
        { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
        { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
      ] },
    { key: 'kb.review_after_months', type: 'integer', label: 'Suggest a review after (months)', default: '12', min: 0, max: 60,
      help: 'Used to fill in the review date when an article is created. 0 leaves it blank.' },
  ],
};

export interface KbKind { key: string; label: string }

/** The configured kinds. Malformed lines are dropped rather than shown broken. */
export function parseKinds(configured: string | undefined): KbKind[] {
  const seen = new Set<string>();
  const kinds: KbKind[] = [];
  for (const line of (configured ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf('|');
    const key = (at === -1 ? trimmed : trimmed.slice(0, at)).trim().toLowerCase().replace(/\s+/g, '_');
    const label = at === -1 ? trimmed : trimmed.slice(at + 1).trim();
    if (!key || !label || !/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    kinds.push({ key, label });
  }
  return kinds;
}

export async function kbKinds(env: Env): Promise<KbKind[]> {
  const values = await readSettings(env, KNOWLEDGE_SETTINGS.settings);
  const kinds = parseKinds(values['kb.kinds']);
  // Never leave the practice with nothing to choose from, however the box was
  // edited: an empty list would make the article form unusable.
  return kinds.length ? kinds : parseKinds(DEFAULT_KINDS);
}

export function labelForKind(kinds: KbKind[], key: string): string {
  return kinds.find((k) => k.key === key)?.label ?? key;
}

export interface FollowUpPolicy {
  enabled: boolean;
  leadDays: number;
  priority: string;
  reviewAfterMonths: number;
}

export async function followUpPolicy(env: Env): Promise<FollowUpPolicy> {
  const values = await readSettings(env, KNOWLEDGE_SETTINGS.settings);
  return {
    enabled: asBoolean(values['kb.followups_enabled'], true),
    leadDays: asInteger(values['kb.followup_lead_days'], 7),
    priority: values['kb.followup_priority'] || 'normal',
    reviewAfterMonths: asInteger(values['kb.review_after_months'], 12),
  };
}

/** `date` less `days`, as a plain YYYY-MM-DD. */
export function subtractDays(date: string, days: number): string {
  const at = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const at = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + months);
  return at.toISOString().slice(0, 10);
}

export interface KbArticleDates {
  id: string;
  ref: string;
  title: string;
  status: string;
  effective_at: string | null;
  review_at: string | null;
  expires_at: string | null;
  /** Who filed it — the first candidate to own the follow-up work. */
  created_by?: string | null;
  updated_by?: string | null;
}

/**
 * Who a task belongs to.
 *
 * Every task has an owner, so a follow-up raised by the system still has to
 * name one. Preference goes to the person who is actually involved — whoever
 * filed or last edited the article — and falls back to the owner account,
 * which is the one account that always exists. A suspended person is skipped:
 * assigning work to someone who cannot sign in is the same as not assigning it.
 */
export async function resolveAssignee(env: Env, ...preferred: Array<string | null | undefined>): Promise<string | null> {
  for (const candidate of preferred) {
    if (!candidate) continue;
    const row = await one<{ id: string }>(env.DB, `SELECT id FROM users WHERE id = ? AND status = 'active'`, candidate);
    if (row) return row.id;
  }
  const owner = await one<{ id: string }>(
    env.DB,
    `SELECT id FROM users WHERE status = 'active'
      ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1`,
  );
  return owner?.id ?? null;
}

/**
 * Make the follow-up tasks for one article match its dates and the current
 * policy: create what is missing, move what has shifted, and cancel what no
 * longer has a date behind it.
 *
 * Returns what it changed, so the caller can say so and the nightly run can be
 * audited rather than silent.
 */
export async function syncFollowUps(
  env: Env,
  article: KbArticleDates,
  actorId: string | null,
  policy?: FollowUpPolicy,
): Promise<{ created: number; moved: number; cancelled: number }> {
  const rules = policy ?? (await followUpPolicy(env));
  const now = nowIso();
  // Resolved once per article rather than per date: three follow-ups on one
  // article are three tasks, not three lookups.
  const assignee = await resolveAssignee(env, actorId, article.updated_by, article.created_by);
  const today = now.slice(0, 10);
  let created = 0, moved = 0, cancelled = 0;

  const existing = new Map<string, { task_id: string; due_at: string; task_status: string }>(
    (await all<{ kind: string; task_id: string; due_at: string; task_status: string }>(
      env.DB,
      `SELECT f.kind, f.task_id, f.due_at, t.status AS task_status
         FROM kb_followups f JOIN tasks t ON t.id = f.task_id
        WHERE f.article_id = ?`,
      article.id,
    )).map((row) => [row.kind, row]),
  );

  // Only a published article raises work. A draft is somebody's thinking, and
  // an archived or superseded one has stopped applying.
  const live = rules.enabled && article.status === 'published';

  for (const kind of FOLLOWUP_KINDS) {
    const wording = FOLLOWUP_WORDING[kind];
    const date = article[wording.column];
    const current = existing.get(kind);

    if (!live || !date) {
      if (current && (current.task_status === 'open' || current.task_status === 'in_progress')) {
        await run(env.DB, `UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?`, now, current.task_id);
        cancelled += 1;
      }
      if (current) await run(env.DB, 'DELETE FROM kb_followups WHERE article_id = ? AND kind = ?', article.id, kind);
      continue;
    }

    // A lead time that lands in the past means the warning is already overdue;
    // due it today rather than silently backdating it out of sight.
    const wanted = subtractDays(date, rules.leadDays) < today ? today : subtractDays(date, rules.leadDays);
    const title = `${article.ref} ${wording.verb} on ${date}`;

    if (!current) {
      // Without anybody to own it there is no task to raise. That only happens
      // when no account is active, in which case there is nobody to do it.
      if (!assignee) continue;
      const taskId = newId('tsk');
      await run(
        env.DB,
        `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to,
                            entity_type, entity_id, created_at, updated_at, created_by)
         VALUES (?, ?, ?, 'open', ?, ?, ?, 'kb_article', ?, ?, ?, ?)`,
        taskId, title,
        `Raised automatically from the knowledge base: “${article.title}”.`,
        rules.priority, wanted, assignee, article.id, now, now, actorId,
      );
      await run(
        env.DB,
        'INSERT INTO kb_followups (article_id, kind, task_id, due_at, created_at) VALUES (?, ?, ?, ?, ?)',
        article.id, kind, taskId, wanted, now,
      );
      created += 1;
      continue;
    }

    // Someone who has finished or cancelled a follow-up has answered it; do not
    // reopen their decision on the next nightly run.
    if (current.task_status === 'done' || current.task_status === 'cancelled') continue;

    if (current.due_at !== wanted) {
      await run(env.DB, 'UPDATE tasks SET title = ?, due_at = ?, updated_at = ? WHERE id = ?',
        title, wanted, now, current.task_id);
      await run(env.DB, 'UPDATE kb_followups SET due_at = ? WHERE article_id = ? AND kind = ?',
        wanted, article.id, kind);
      moved += 1;
    }
  }

  return { created, moved, cancelled };
}

/**
 * Reconcile every article. Run nightly, so that changing the lead time in
 * settings corrects the whole knowledge base rather than only what is edited
 * afterwards.
 */
export async function syncAllFollowUps(env: Env): Promise<{ created: number; moved: number; cancelled: number }> {
  const policy = await followUpPolicy(env);
  const articles = await all<KbArticleDates>(
    env.DB,
    `SELECT id, ref, title, status, effective_at, review_at, expires_at, created_by, updated_by
       FROM kb_articles
      WHERE effective_at IS NOT NULL OR review_at IS NOT NULL OR expires_at IS NOT NULL`,
  );
  const total = { created: 0, moved: 0, cancelled: 0 };
  for (const article of articles) {
    const result = await syncFollowUps(env, article, null, policy);
    total.created += result.created;
    total.moved += result.moved;
    total.cancelled += result.cancelled;
  }
  return total;
}

/** An article's status by its dates, for a reader who wants it at a glance. */
export function effectiveState(
  article: { status: string; effective_at: string | null; expires_at: string | null },
  today = new Date().toISOString().slice(0, 10),
): { label: string; tone: 'green' | 'amber' | 'blue' | 'grey' | 'red' } {
  if (article.status === 'draft') return { label: 'Draft', tone: 'grey' };
  if (article.status === 'archived') return { label: 'Archived', tone: 'grey' };
  if (article.status === 'superseded') return { label: 'Superseded', tone: 'grey' };
  if (article.expires_at && article.expires_at < today) return { label: 'No longer applies', tone: 'red' };
  if (article.effective_at && article.effective_at > today) return { label: `From ${article.effective_at}`, tone: 'amber' };
  return { label: 'In force', tone: 'green' };
}

/**
 * Render an article body.
 *
 * Shared with outgoing email (src/core/richtext.ts) rather than duplicated:
 * one renderer means one place where escaping can be got wrong, and one set of
 * tests covering it.
 */
export function renderBody(body: string): Raw {
  return renderRichText(body);
}

/** Tags on one article. Shares the vocabulary cases use — one set of words. */
export async function tagsForArticle(env: Env, articleId: string) {
  return all<{ id: string; name: string; colour: string }>(
    env.DB,
    `SELECT t.id, t.name, t.colour FROM tags t
       JOIN kb_article_tags at ON at.tag_id = t.id
      WHERE at.article_id = ? ORDER BY t.name`,
    articleId,
  );
}

export async function tagsForArticles(env: Env, ids: string[]): Promise<Map<string, Array<{ id: string; name: string; colour: string }>>> {
  const byArticle = new Map<string, Array<{ id: string; name: string; colour: string }>>();
  if (ids.length === 0) return byArticle;
  const rows = await allByIds<{ id: string; name: string; colour: string; article_id: string }>(
    env.DB, ids, (placeholders) =>
      `SELECT t.id, t.name, t.colour, at.article_id FROM tags t
         JOIN kb_article_tags at ON at.tag_id = t.id
        WHERE at.article_id IN (${placeholders}) ORDER BY t.name`);
  for (const row of rows) {
    const list = byArticle.get(row.article_id) ?? [];
    list.push({ id: row.id, name: row.name, colour: row.colour });
    byArticle.set(row.article_id, list);
  }
  return byArticle;
}

export async function tagArticle(env: Env, articleId: string, tagId: string, userId: string | null): Promise<void> {
  await run(
    env.DB,
    'INSERT OR IGNORE INTO kb_article_tags (article_id, tag_id, created_at, created_by) VALUES (?, ?, ?, ?)',
    articleId, tagId, nowIso(), userId,
  );
}

export async function untagArticle(env: Env, articleId: string, tagId: string): Promise<void> {
  await run(env.DB, 'DELETE FROM kb_article_tags WHERE article_id = ? AND tag_id = ?', articleId, tagId);
}

/** The fields kept in history — everything a reader might need to reconstruct. */
export interface VersionedArticle {
  id: string; version: number; kind: string; title: string; summary: string | null;
  body: string; status: string; published_at: string | null; effective_at: string | null;
  expires_at: string | null; review_at: string | null; source_ref: string | null;
}

/** Record what an article said before this edit, so the change is recoverable. */
export async function recordVersion(
  env: Env,
  article: VersionedArticle,
  changeNote: string | null,
  editorId: string | null,
): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO kb_article_versions
       (id, article_id, version, kind, title, summary, body, status, published_at,
        effective_at, expires_at, review_at, source_ref, change_note, edited_at, edited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('kbv'), article.id, article.version, article.kind, article.title, article.summary,
    article.body, article.status, article.published_at, article.effective_at, article.expires_at,
    article.review_at, article.source_ref, changeNote, nowIso(), editorId,
  );
}

export async function articleById(env: Env, id: string) {
  return one<any>(env.DB, 'SELECT * FROM kb_articles WHERE id = ?', id);
}
