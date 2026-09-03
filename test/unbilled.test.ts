import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { ALERT_SETTINGS, alertTiming } from '../src/modules/alerts';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Work finished, and nothing was ever charged for it.
 *
 * The practice asked for this having said it did not want to miss payments for
 * work done. The whole difficulty is the window: counted against production,
 * 135 finished matters have no fee of any kind, because the register was loaded
 * from an archive of matters already dealt with. An alert that fires 135 times
 * on the first morning is not an alert. These tests are mostly about the two
 * settings that narrow it to six.
 */

const AT = '2026-09-03T00:00:00Z';
const TODAY = '2026-09-03';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','Hemi Rangi TAWHAI','active',?,?)`).run(AT, AT);
  const matter = (id: string, ref: string, status: string, decided: string | null,
                  agreed: number | null = null) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   decided_at, fee_agreed_cents, created_at, updated_at)
                VALUES (?, ?, 'c1', 'A matter', 'wv_aewv', ?, 'u1', ?, ?, ?, ?)`)
      .run(id, ref, status, decided, agreed, AT, decided ? `${decided}T00:00:00Z` : AT);
  return { db, matter };
}

/** The query the alert runs, lifted from the module so it cannot drift. */
const source = readFileSync('src/modules/alerts/index.ts', 'utf8');
const QUERY = source.slice(source.indexOf('`SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name,\n            substr('),
                          source.indexOf('ORDER BY done_on LIMIT 100`') + 'ORDER BY done_on LIMIT 100'.length)
  .replace(/^`/, '');

const run = (db: ReturnType<typeof register>['db'], from: string, until: string) =>
  (db.prepare(QUERY).all(from, until) as Array<{ ref: string }>).map((r) => r.ref);

describe('which matters count as unbilled', () => {
  it('names a finished matter with nothing charged', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-08-01');
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual(['CASE-26-901']);
  });

  it('leaves a matter that is still running', () => {
    // Nothing to bill yet. The work is not done.
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'lodged', null);
    expect(run(db, '2026-01-01', TODAY)).toEqual([]);
  });

  it('leaves a matter with an agreed fee on it', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-08-01', 250000);
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual([]);
  });

  it('leaves a matter with a fee line', () => {
    // "Charged for" is read broadly: the practice records money in more than
    // one place, and this asks whether it was dealt with at all.
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-08-01');
    db.prepare(`INSERT INTO fee_items (id, case_id, description, kind, amount_cents,
                                       gst_treatment, net_cents, gst_cents, gross_cents,
                                       currency, created_at, updated_at)
                VALUES ('f1','k1','Professional fee','professional',250000,'inclusive',
                        217391,32609,250000,'NZD',?,?)`)
      .run(AT, AT);
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual([]);
  });

  it('leaves a matter with an invoice', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-08-01');
    db.prepare(`INSERT INTO invoices (id, ref, case_id, client_id, description, status, currency,
                                      net_cents, gst_cents, gross_cents, paid_cents,
                                      issued_on, created_at, updated_at)
                VALUES ('i1','INV-9001','k1','c1','Professional fee','issued','NZD',
                        100,15,115,0,'2026-08-05',?,?)`)
      .run(AT, AT);
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual([]);
  });

  it('counts every way a matter can be finished', () => {
    const { db, matter } = register();
    const statuses = ['approved', 'declined', 'withdrawn', 'closed'];
    statuses.forEach((st, i) => matter(`k${i}`, `CASE-26-90${i}`, st, '2026-08-01'));
    expect(run(db, '2026-06-05', '2026-08-20').length).toBe(statuses.length);
  });
});

describe('the window, which is what makes it usable', () => {
  it('ignores the archive behind the look-back', () => {
    // The reason this exists: 135 matters in production finished with no fee,
    // because they were loaded from an archive already dealt with.
    const { db, matter } = register();
    matter('old', 'CASE-24-901', 'approved', '2024-03-01');
    matter('new', 'CASE-26-901', 'approved', '2026-08-01');
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual(['CASE-26-901']);
  });

  it('leaves a matter alone inside the grace period', () => {
    // Decided yesterday is not forgotten; it is not billed yet. Nagging on the
    // day is how a page stops being read.
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-09-02');
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual([]);
  });

  it('names it once the grace period has passed', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'approved', '2026-08-19');
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual(['CASE-26-901']);
  });

  it('includes both ends of the window', () => {
    const { db, matter } = register();
    matter('a', 'CASE-26-901', 'approved', '2026-06-05');
    matter('b', 'CASE-26-902', 'approved', '2026-08-20');
    expect(run(db, '2026-06-05', '2026-08-20').sort()).toEqual(['CASE-26-901', 'CASE-26-902']);
  });

  it('reports the oldest first, because that is the likeliest to be forgotten', () => {
    const { db, matter } = register();
    matter('b', 'CASE-26-902', 'approved', '2026-08-10');
    matter('a', 'CASE-26-901', 'approved', '2026-07-01');
    expect(run(db, '2026-06-05', '2026-08-20')).toEqual(['CASE-26-901', 'CASE-26-902']);
  });
});

describe('the settings that narrow it', () => {
  const setting = (key: string) => ALERT_SETTINGS.settings.find((d) => d.key === key);

  it('offers both, with the defaults measured against production', () => {
    // 90 days back and a 14-day grace turned 135 into six.
    expect(setting('alerts.unbilled_days')!.default).toBe('90');
    expect(setting('alerts.unbilled_grace_days')!.default).toBe('14');
  });

  it('can be switched off entirely', () => {
    // A practice that bills elsewhere should not have to look at this.
    expect(setting('alerts.unbilled_days')!.min).toBe(0);
    expect(source).toMatch(/if \(lookBack <= 0\) return \[\];/);
  });

  it('explains itself in plain words', () => {
    for (const key of ['alerts.unbilled_days', 'alerts.unbilled_grace_days']) {
      const help = setting(key)!.help!;
      expect(help.length).toBeGreaterThan(40);
      expect(help).not.toMatch(/\bSQL\b|null|NOT EXISTS|fee_items/);
    }
  });

  it('sorts like a deadline, oldest first', () => {
    // The date is the day the work finished, and the longer ago that was the
    // likelier the money is to be forgotten.
    expect(alertTiming('unbilled')).toBe('due');
  });
});

describe('the arithmetic that produces the window', () => {
  it('sets the far end from the look-back and the near end from the grace', async () => {
    const { unbilledWindow } = await import('../src/modules/alerts');
    expect(unbilledWindow('2026-09-03', 90, 14))
      .toEqual({ from: '2026-06-05', until: '2026-08-20' });
  });

  it('moves the near end when the grace changes', async () => {
    // The mutation this exists to catch: dropping the grace period entirely.
    // The first version of these tests passed the dates in, so removing it
    // failed nothing at all.
    const { unbilledWindow } = await import('../src/modules/alerts');
    expect(unbilledWindow('2026-09-03', 90, 0).until).toBe('2026-09-03');
    expect(unbilledWindow('2026-09-03', 90, 30).until).toBe('2026-08-04');
  });

  it('moves the far end when the look-back changes', async () => {
    const { unbilledWindow } = await import('../src/modules/alerts');
    expect(unbilledWindow('2026-09-03', 30, 14).from).toBe('2026-08-04');
    expect(unbilledWindow('2026-09-03', 365, 14).from).toBe('2025-09-03');
  });

  it('never reaches into the future, whatever it is given', async () => {
    // A negative setting would otherwise ask for matters finishing next month.
    const { unbilledWindow } = await import('../src/modules/alerts');
    const w = unbilledWindow('2026-09-03', -5, -5);
    expect(w.from <= '2026-09-03').toBe(true);
    expect(w.until <= '2026-09-03').toBe(true);
  });

  it('leaves the window empty when the grace outruns the look-back', async () => {
    // Nonsense settings should return nothing, not everything.
    const { unbilledWindow } = await import('../src/modules/alerts');
    const w = unbilledWindow('2026-09-03', 10, 60);
    expect(w.until < w.from).toBe(true);
  });
});
