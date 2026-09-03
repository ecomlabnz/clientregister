import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { byDay, calendarEvents, CALENDAR_SOURCES } from '../src/core/calendar';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * The calendar: a view over dates the register already owns.
 *
 * It stores nothing. The practice decided on 3 September that it holds no
 * appointments — every event belongs to a record and is edited there — so the
 * thing worth guarding is that it stays a *view*, and that the source registry
 * keeps its promises when one source misbehaves.
 */

const AT = '2026-09-01T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u2','c@d.test','Another','x','adviser',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                   created_at, updated_at)
              VALUES ('c1','CL-9001','individual','Hemi Rangi TAWHAI','active','2026-09-20',?,?)`)
    .run(AT, AT);
  const matter = (id: string, ref: string, owner: string, cols: Record<string, string | null>) => {
    const keys = Object.keys(cols);
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   created_at, updated_at${keys.length ? ', ' + keys.join(', ') : ''})
                VALUES (?, ?, 'c1', 'A matter', 'wv_aewv', 'lodged', ?, ?, ?${keys.map(() => ', ?').join('')})`)
      .run(id, ref, owner, AT, AT, ...keys.map((k) => cols[k] ?? null));
  };
  return { db, matter };
}

const envFor = (db: ReturnType<typeof register>['db']) => ({
  DB: {
    prepare(sql: string) {
      return { bind: (...p: unknown[]) => ({ all: async () => ({ results: db.prepare(sql).all(...p) }) }) };
    },
  },
} as never);

describe('the calendar holds nothing of its own', () => {
  const core = readFileSync('src/core/calendar.ts', 'utf8');
  const page = readFileSync('src/modules/calendar/index.ts', 'utf8');

  it('never writes, anywhere', () => {
    // A view over records the register already owns. Moving a visa expiry does
    // not change when the visa expires.
    for (const src of [core, page]) {
      expect(src).not.toMatch(/INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM/);
    }
  });

  it('has no appointments table, because the practice said no appointments', () => {
    const migrations = readdirSync('migrations').map((f) => readFileSync(`migrations/${f}`, 'utf8')).join('');
    expect(migrations).not.toMatch(/CREATE TABLE appointments/i);
  });

  it('takes no POST at all', () => {
    expect(page).not.toMatch(/r\.post\(/);
  });

  it('runs without script, so every control is a link', () => {
    expect(page).not.toMatch(/onclick|addEventListener|<script/);
    expect(page).toMatch(/<a class=/);
  });
});

describe('the source registry', () => {
  it('gives every source a plain-words label and a colour', () => {
    expect(CALENDAR_SOURCES.length).toBeGreaterThanOrEqual(8);
    for (const s of CALENDAR_SOURCES) {
      expect(s.label, `${s.id} has no label`).toBeTruthy();
      expect(s.label, `${s.id} shows a developer's word`).not.toMatch(/_/);
      expect(['red', 'amber', 'green', 'blue', 'grey']).toContain(s.tone);
    }
  });

  it('has no two sources sharing an id', () => {
    const ids = CALENDAR_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every event inside the range it was asked for', async () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-08-31' });
    matter('k2', 'CASE-26-902', 'u1', { decision_due_at: '2026-09-15' });
    matter('k3', 'CASE-26-903', 'u1', { decision_due_at: '2026-10-01' });
    const events = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30');
    for (const e of events) {
      expect(e.date >= '2026-09-01' && e.date <= '2026-09-30', `${e.date} is outside`).toBe(true);
    }
    expect(events.some((e) => e.date === '2026-09-15')).toBe(true);
  });

  it('includes both ends of the range', async () => {
    // An exclusive boundary loses the 1st and the 30th, which is a whole day of
    // deadlines nobody sees.
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-01' });
    matter('k2', 'CASE-26-902', 'u1', { decision_due_at: '2026-09-30' });
    const dates = (await calendarEvents(envFor(db), '2026-09-01', '2026-09-30'))
      .filter((e) => e.source === 'decision_due').map((e) => e.date);
    expect(dates).toContain('2026-09-01');
    expect(dates).toContain('2026-09-30');
  });

  it('returns events sorted by date', async () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-20' });
    matter('k2', 'CASE-26-902', 'u1', { decision_due_at: '2026-09-05' });
    const events = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30');
    const dates = events.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('shows only the sources asked for', async () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-15' });
    const events = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30', { sources: ['task'] });
    expect(events.every((e) => e.source === 'task')).toBe(true);
    expect(events.some((e) => e.source === 'decision_due')).toBe(false);
  });

  it('treats an empty source list as all of them, not none', async () => {
    // A calendar that opens empty because a previous visit unticked something
    // is a calendar nobody trusts.
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-15' });
    expect((await calendarEvents(envFor(db), '2026-09-01', '2026-09-30', { sources: [] })).length)
      .toBeGreaterThan(0);
  });

  it('does not fall over when one source fails', async () => {
    // A calendar missing one kind of date is still a calendar. A blank page is
    // not.
    const broken = {
      id: 'broken', label: 'Broken', tone: 'grey' as const,
      load: async () => { throw new Error('deliberate'); },
    };
    CALENDAR_SOURCES.push(broken);
    try {
      const { db, matter } = register();
      matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-15' });
      const events = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30');
      expect(events.some((e) => e.source === 'decision_due')).toBe(true);
    } finally {
      CALENDAR_SOURCES.pop();
    }
  });
});

describe('narrowing to one person — the seed of a per-user calendar', () => {
  it('keeps only what that person owns', async () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-15' });
    matter('k2', 'CASE-26-902', 'u2', { decision_due_at: '2026-09-16' });
    const mine = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30', { ownerId: 'u1' });
    expect(mine.map((e) => e.date)).toContain('2026-09-15');
    expect(mine.map((e) => e.date)).not.toContain('2026-09-16');
  });

  it('steps client dates aside rather than filing them under somebody', async () => {
    // A passport belongs to a client, not to a member of staff. Narrowing by
    // owner must not list everybody's client expiries under one name — nor
    // silently empty the calendar.
    const { db } = register();
    const everyone = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30');
    const mine = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30', { ownerId: 'u1' });
    expect(everyone.some((e) => e.source === 'visa_expiry')).toBe(true);
    expect(mine.some((e) => e.source === 'visa_expiry')).toBe(false);
  });

  it('marks which sources can be narrowed at all', () => {
    const ownable = CALENDAR_SOURCES.filter((s) => s.ownable).map((s) => s.id);
    expect(ownable).toContain('decision_due');
    expect(ownable).toContain('task');
    expect(ownable).not.toContain('visa_expiry');
    expect(ownable).not.toContain('passport_expiry');
  });

  it('carries the owner on the event, so a name can be shown', async () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', 'u1', { decision_due_at: '2026-09-15' });
    const [event] = await calendarEvents(envFor(db), '2026-09-01', '2026-09-30', { sources: ['decision_due'] });
    expect(event!.ownerId).toBe('u1');
    expect(event!.ownerName).toBe('A Lawyer');
  });
});

describe('grouping by day', () => {
  it('puts every event under its own date, and loses none', () => {
    const events = [
      { date: '2026-09-14', source: 'a', title: '1', detail: '', href: '#', tone: 'red' as const, ownerId: null, ownerName: null },
      { date: '2026-09-14', source: 'b', title: '2', detail: '', href: '#', tone: 'red' as const, ownerId: null, ownerName: null },
      { date: '2026-09-15', source: 'a', title: '3', detail: '', href: '#', tone: 'red' as const, ownerId: null, ownerName: null },
    ];
    const days = byDay(events);
    expect(days.get('2026-09-14')!.length).toBe(2);
    expect(days.get('2026-09-15')!.length).toBe(1);
    expect([...days.values()].flat().length).toBe(events.length);
  });

  it('returns nothing for a day with nothing on it', () => {
    expect(byDay([]).get('2026-09-14')).toBeUndefined();
  });
});
