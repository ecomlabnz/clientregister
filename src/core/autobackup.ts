/**
 * The backup that happens whether anybody remembers it or not.
 *
 * **Asked for on 12 September 2026:** *"lets build auto back up on the main and
 * see how it is going to be deployed on the trial."* It had been the standing
 * answer to "what is left before another practice's files are held here" since
 * 3 September, and it is the last of those five still open.
 *
 * ## What was already there, and what was missing
 *
 * `core/backup.ts` has built a complete archive since 9 September — every
 * table, every column, the documents, passport numbers and all — behind an
 * owner-only button. Nothing about the archive needed building.
 *
 * What was missing is the only part that matters: **somebody pressing it.** A
 * backup that depends on a person remembering is a backup that exists until the
 * week they are busy, which is the week they need it.
 *
 * ## What this protects against, and what it does not
 *
 * Said plainly, because a backup nobody has reasoned about is a comfort rather
 * than a control.
 *
 *  * **It protects against the database.** Rows deleted by a mistake, a bad
 *    migration, a table dropped, the database itself gone. That is the likely
 *    bad day and this answers it.
 *  * **It does not protect against losing the Cloudflare account**, because it
 *    is written to a bucket in that account. That failure needs a copy
 *    somewhere else entirely, and this is deliberately not pretending to be
 *    one. See `docs/operations.md` for what that step would be.
 *  * **Cloudflare's own Time Travel** can rewind a D1 database to a point in
 *    time, and is a real safety net. It is *their* copy, in *their* account,
 *    restorable only while both still exist. This is the practice's own copy,
 *    which is a different thing and is why it is worth having as well.
 *
 * ## The documents are not in it, and that is deliberate
 *
 * See the note on `includeFiles` in `core/backup.ts`. The short of it: the
 * documents already live in the bucket this is written to, and an archive that
 * grows with every upload is one that works every night until it silently stops.
 *
 * ## On a register with no bucket
 *
 * The trial has no R2 bucket yet — R2 pins a name's location on first creation,
 * so it is made by hand from a browser in New Zealand. So this has to have an
 * answer for "there is nowhere to write", and the answer is to say so and do
 * nothing, not to throw. A register without document storage still runs.
 */

import type { Env } from '../types';
import { getSetting, nowIso, setSetting } from './db';
import { audit } from './audit';
import { backupFilename, makeBackup } from './backup';

/** Where the nightly archives live, inside the documents bucket. */
export const BACKUP_PREFIX = 'backups/';

/** The setting that says the register may not have one at all. */
export const BACKUP_ENABLED = 'backup.nightly';

/** How many nightly archives to keep. */
export const BACKUP_KEEP = 'backup.keep';

/** When the last one was written, so a screen can say whether it is working. */
export const BACKUP_LAST_AT = 'backup.last_taken_at';
export const BACKUP_LAST_KEY = 'backup.last_key';
export const BACKUP_LAST_BYTES = 'backup.last_bytes';

/**
 * A backup older than this is reported as stale.
 *
 * Two nights rather than one: a single missed run is a deploy that happened at
 * the wrong minute, and crying about that teaches everybody to ignore it.
 */
export const STALE_AFTER_HOURS = 48;

export interface BackupOutcome {
  taken: boolean;
  /** Why not, in words, when it was not. */
  reason?: string;
  key?: string;
  bytes?: number;
  rows?: number;
  tables?: number;
  /** Whether the bytes were read back out of the store afterwards. */
  verified?: boolean;
  /** How many old archives were removed. */
  pruned?: number;
}

function keyFor(at: string): string {
  return `${BACKUP_PREFIX}${backupFilename(at)}`;
}

/**
 * Take tonight's backup.
 *
 * Returns rather than throws, always: this runs inside the nightly pass beside
 * the mail queue and the reminders, and a register that stops expiring quotes
 * because a bucket was full would be a worse fault than the one being guarded.
 * The outcome goes into the housekeeping audit row either way, so a run that
 * did nothing says why.
 */
export async function nightlyBackup(
  env: Env, opts: { version: string },
): Promise<BackupOutcome> {
  if (!env.DOCS) {
    return { taken: false, reason: 'There is no document store to write a backup to.' };
  }
  // `getSetting` returns the fallback for a key nobody has set, not null, so
  // the default lives in the call rather than in a `??` that would never fire.
  const enabled = await getSetting(env, BACKUP_ENABLED, '1');
  if (enabled !== '1') {
    return { taken: false, reason: 'Nightly backups are switched off in settings.' };
  }

  try {
    const key = keyFor(nowIso());

    // Already done tonight. The nightly pass can run twice — a redeploy, a
    // retried schedule — and a second archive for the same day is the same
    // archive, so the day is the key and writing it again is a no-op rather
    // than a second file.
    const already = await env.DOCS.head(key);
    if (already) {
      return { taken: false, reason: 'Tonight’s backup was already written.', key };
    }

    const { zip, summary } = await makeBackup(env, {
      version: opts.version,
      takenBy: 'the nightly run',
      includeFiles: false,
    });

    await env.DOCS.put(key, zip, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: {
        takenAt: summary.takenAt,
        rows: String(summary.tables.reduce((n, t) => n + t.rows, 0)),
        register: opts.version,
      },
    });

    // **Read it back.** A write that returned without error and stored nothing
    // is the failure mode a backup cannot afford, and it is the one nobody
    // notices for months. This is not a restore — that is a person's job, and
    // it is in the runbook — but it is the difference between "we wrote it" and
    // "it is there".
    const stored = await env.DOCS.head(key);
    const verified = Boolean(stored && stored.size === zip.length);

    const pruned = await prune(env, await keepCount(env));

    const rows = summary.tables.reduce((n, t) => n + t.rows, 0);
    // Through `setSetting`, which is the one place a setting is written — it
    // also records who changed it, and "nobody, it was the nightly run" is a
    // true and useful answer to that.
    await setSetting(env, BACKUP_LAST_AT, summary.takenAt);
    await setSetting(env, BACKUP_LAST_KEY, key);
    await setSetting(env, BACKUP_LAST_BYTES, String(zip.length));

    // Its own audit row rather than only a field in the housekeeping one, so
    // "when were we last backed up, and how big was it" is a question the audit
    // log answers on its own.
    await audit(env, {
      action: 'backup.nightly',
      actorLabel: 'system',
      entityType: 'backup',
      entityId: summary.takenAt,
      meta: { key, bytes: zip.length, rows, tables: summary.tables.length, verified, pruned },
    });

    return { taken: true, key, bytes: zip.length, rows, tables: summary.tables.length,
             verified, pruned };
  } catch (err) {
    // Recorded rather than swallowed. A backup that fails silently is worse
    // than none, because it is believed in.
    await audit(env, {
      action: 'backup.nightly_failed',
      actorLabel: 'system',
      meta: { error: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    return { taken: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function keepCount(env: Env): Promise<number> {
  const raw = Number(await getSetting(env, BACKUP_KEEP, '30'));
  if (!Number.isFinite(raw)) return 30;
  return Math.min(365, Math.max(1, Math.trunc(raw)));
}

/**
 * Remove all but the newest `keep` archives.
 *
 * Sorted by key, which sorts by date because the name carries an ISO date —
 * the same reason the histories can compare their dates as text. Never removes
 * the newest, whatever `keep` is set to, so a mistyped setting cannot leave a
 * register with no backup at all.
 */
export async function prune(env: Env, keep: number): Promise<number> {
  if (!env.DOCS) return 0;
  const listed = await env.DOCS.list({ prefix: BACKUP_PREFIX, limit: 1000 });
  const keys = listed.objects.map((o) => o.key).sort();
  const doomed = keys.slice(0, Math.max(0, keys.length - Math.max(1, keep)));
  for (const key of doomed) await env.DOCS.delete(key);
  return doomed.length;
}

/** What a screen needs to say whether backups are actually happening. */
export interface BackupState {
  lastAt: string | null;
  lastKey: string | null;
  lastBytes: number | null;
  stale: boolean;
  /** False where there is nowhere to write one — a register without a bucket. */
  possible: boolean;
  enabled: boolean;
}

export async function backupState(env: Env, now = new Date()): Promise<BackupState> {
  const [lastAt, lastKey, lastBytes, enabled] = await Promise.all([
    getSetting(env, BACKUP_LAST_AT),
    getSetting(env, BACKUP_LAST_KEY),
    getSetting(env, BACKUP_LAST_BYTES),
    getSetting(env, BACKUP_ENABLED, '1'),
  ]);
  const at = lastAt ? Date.parse(lastAt) : NaN;
  return {
    lastAt: lastAt || null,
    lastKey: lastKey || null,
    lastBytes: lastBytes ? Number(lastBytes) : null,
    // Never taken counts as stale. "No backup yet" and "the backup stopped
    // three weeks ago" need the same red band, because they are the same
    // position to be in.
    stale: !Number.isFinite(at) || (now.getTime() - at) > STALE_AFTER_HOURS * 3600_000,
    possible: Boolean(env.DOCS),
    enabled: enabled === '1',
  };
}
