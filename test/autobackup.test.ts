/**
 * The backup that happens whether anybody remembers it or not.
 *
 * **Asked for on 12 September 2026:** *"lets build auto back up on the main and
 * see how it is going to be deployed on the trial."* It had been the standing
 * answer to *"what is left before another practice's files are held here"*
 * since 3 September, and was the last of those five still open.
 *
 * The archive itself was already built and already tested — `backup.test.ts`
 * takes one apart the way a stranger's zip tool would. What is new is that
 * nobody presses the button, and that is what is held here:
 *
 *  * it writes, once a night, under a key named for the day;
 *  * it **reads the bytes back**, because a write that returned without error
 *    and stored nothing is the failure a backup cannot afford;
 *  * it removes old archives but **never the newest**, whatever the setting
 *    says;
 *  * and on a register with nowhere to write — the trial, which has no bucket
 *    yet — it says so and does nothing, rather than throwing and taking the
 *    rest of the nightly run down with it.
 */

import { describe, expect, it } from 'vitest';
import { backupState, nightlyBackup, prune, BACKUP_PREFIX } from '../src/core/autobackup';
import { getSetting, setSetting } from '../src/core/db';
import { fakeD1, migratedSqlite } from './support/d1';
import type { Env } from '../src/types';

const AT = '2026-09-12T19:00:00Z';

/** Enough of an R2 bucket for the three things a backup does to one. */
function fakeBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, body: Uint8Array) { objects.set(key, body); },
    async head(key: string) {
      const body = objects.get(key);
      return body ? { key, size: body.length } : null;
    },
    async get(key: string) {
      const body = objects.get(key);
      return body ? { arrayBuffer: async () => body.buffer } : null;
    },
    async delete(key: string) { objects.delete(key); },
    async list({ prefix }: { prefix: string; limit?: number }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

function register(withBucket = true) {
  const db = migratedSqlite();
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
              VALUES ('u1','a@example.test','A User','x','owner','active',?,?)`).run(AT, AT);
  db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
           VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
  const bucket = withBucket ? fakeBucket() : undefined;
  const env = { DB: fakeD1(db), DOCS: bucket } as unknown as Env;
  return { db, env, bucket };
}

describe('a register with somewhere to write', () => {
  it('writes one archive, named for the day', async () => {
    const { env, bucket } = register();
    const out = await nightlyBackup(env, { version: '1.0.0' });
    expect(out.taken).toBe(true);
    expect([...bucket!.objects.keys()]).toHaveLength(1);
    expect(out.key).toMatch(new RegExp(`^${BACKUP_PREFIX}client-register-backup-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
  });

  it('reads the bytes back out of the store', async () => {
    // The failure this catches: a put that resolves and stores nothing. Nobody
    // notices for months, and the month they notice is the month it mattered.
    const { env } = register();
    const out = await nightlyBackup(env, { version: '1.0.0' });
    expect(out.verified).toBe(true);
    expect(out.bytes).toBeGreaterThan(0);
  });

  it('holds the register’s rows', async () => {
    const { env, bucket } = register();
    const out = await nightlyBackup(env, { version: '1.0.0' });
    expect(out.rows).toBeGreaterThan(0);
    expect(out.tables).toBeGreaterThan(10);
    expect(bucket!.objects.get(out.key!)!.length).toBe(out.bytes);
  });

  it('does not write a second archive for the same night', async () => {
    const { env, bucket } = register();
    await nightlyBackup(env, { version: '1.0.0' });
    const again = await nightlyBackup(env, { version: '1.0.0' });
    expect(again.taken).toBe(false);
    expect(again.reason).toContain('already');
    expect([...bucket!.objects.keys()]).toHaveLength(1);
  });

  it('records when it last happened, so a screen can say', async () => {
    const { env } = register();
    await nightlyBackup(env, { version: '1.0.0' });
    expect(await getSetting(env, 'backup.last_taken_at')).not.toBe('');
    const state = await backupState(env);
    expect(state.stale).toBe(false);
    expect(state.lastKey).toContain(BACKUP_PREFIX);
  });
});

describe('what it will not do', () => {
  it('says so and does nothing where there is no store — the trial, today', async () => {
    // The trial has no bucket: R2 pins a name's location on first creation, so
    // it is made by hand from a browser in New Zealand. The nightly run must
    // survive that rather than throwing and taking the mail queue with it.
    const { env } = register(false);
    const out = await nightlyBackup(env, { version: '1.0.0' });
    expect(out.taken).toBe(false);
    expect(out.reason).toContain('no document store');
  });

  it('reports that register as having no backup, rather than as fine', async () => {
    const { env } = register(false);
    const state = await backupState(env);
    expect(state.possible).toBe(false);
    expect(state.stale).toBe(true);
  });

  it('stops when it is switched off', async () => {
    const { env, bucket } = register();
    await setSetting(env, 'backup.nightly', '0');
    const out = await nightlyBackup(env, { version: '1.0.0' });
    expect(out.taken).toBe(false);
    expect(out.reason).toContain('switched off');
    expect([...bucket!.objects.keys()]).toHaveLength(0);
  });

  it('is on for a register nobody has configured', async () => {
    const { env } = register();
    expect((await backupState(env)).enabled).toBe(true);
  });
});

describe('clearing out the old ones', () => {
  async function withArchives(count: number) {
    const { env, bucket } = register();
    for (let i = 1; i <= count; i++) {
      bucket!.objects.set(`${BACKUP_PREFIX}client-register-backup-2026-09-${String(i).padStart(2, '0')}.zip`,
        new Uint8Array([1]));
    }
    return { env, bucket };
  }

  it('keeps the newest ones and removes the rest', async () => {
    const { env, bucket } = await withArchives(10);
    const removed = await prune(env, 3);
    expect(removed).toBe(7);
    expect([...bucket!.objects.keys()].sort()).toEqual([
      `${BACKUP_PREFIX}client-register-backup-2026-09-08.zip`,
      `${BACKUP_PREFIX}client-register-backup-2026-09-09.zip`,
      `${BACKUP_PREFIX}client-register-backup-2026-09-10.zip`,
    ]);
  });

  it('never removes the newest, whatever the setting says', async () => {
    // A mistyped setting must not be able to leave a register with no backup
    // at all. Zero here means "keep one", not "keep none".
    const { env, bucket } = await withArchives(4);
    await prune(env, 0);
    expect([...bucket!.objects.keys()]).toEqual([
      `${BACKUP_PREFIX}client-register-backup-2026-09-04.zip`,
    ]);
  });

  it('leaves everything alone when there is less than it keeps', async () => {
    const { env, bucket } = await withArchives(2);
    expect(await prune(env, 30)).toBe(0);
    expect([...bucket!.objects.keys()]).toHaveLength(2);
  });

  it('touches nothing that is not a backup', async () => {
    const { env, bucket } = await withArchives(5);
    bucket!.objects.set('doc_abc123', new Uint8Array([9]));
    await prune(env, 1);
    expect(bucket!.objects.has('doc_abc123')).toBe(true);
  });
});
