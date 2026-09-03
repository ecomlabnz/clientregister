import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { alertTiming, byWorkingOrder, type Alert } from '../src/modules/alerts';

/**
 * The order a working morning wants.
 *
 * "Needs you today" was sorted by date alone, so the oldest row came first
 * whatever it was — and a matter lodged in 2024 whose record contradicts itself
 * carries a 2024 date. It sat above a reply due this afternoon, permanently.
 * The practice said so on 3 September: *"there are some old ones for closed
 * cases — yes they need to be attended to but the priority is so low."*
 *
 * The cause was one field carrying two meanings. `date` is a **deadline** on a
 * task or an expiry, and merely **when the record was made** on a finding that
 * something is wrong. Sorting them together compares a due date with a
 * lodgement date, which is not a comparison at all.
 */

const alert = (kind: Alert['kind'], date: string, title?: string): Alert => ({
  kind, date, title: title ?? kind, severity: 'urgent', detail: '', href: '#',
});

describe('a deadline and a provenance are not the same date', () => {
  it('calls a due date due, and a record-made date wrong', () => {
    for (const kind of ['case_deadline', 'task', 'document', 'quote', 'no_slack'] as const) {
      expect(alertTiming(kind), `${kind} is a deadline`).toBe('due');
    }
    for (const kind of ['contradiction', 'quiet', 'status_unknown',
                        'expiry_unfixed', 'unacknowledged', 'mail_quiet'] as const) {
      expect(alertTiming(kind), `${kind} is not a deadline`).toBe('wrong');
    }
  });

  it('puts a reply due today above a record that has been wrong since 2024', () => {
    // The exact row the practice complained about.
    const stale = alert('contradiction', '2024-03-01', 'approved with no decision date');
    const todayTask = alert('case_deadline', '2026-09-03', 'PPI reply due today');
    expect([stale, todayTask].sort(byWorkingOrder)[0]!.title).toBe('PPI reply due today');
    expect([todayTask, stale].sort(byWorkingOrder)[0]!.title).toBe('PPI reply due today');
  });

  it('still puts the most overdue deadline first among deadlines', () => {
    // Within things that are actually due, old means overdue, and overdue
    // first is right. The fix must not reverse that.
    const order = [
      alert('task', '2026-09-03', 'today'),
      alert('case_deadline', '2026-08-01', 'a month late'),
      alert('document', '2026-09-01', 'two days late'),
    ].sort(byWorkingOrder).map((a) => a.title);
    expect(order).toEqual(['a month late', 'two days late', 'today']);
  });

  it('puts the newest problem first among problems', () => {
    // A record that went wrong yesterday is likelier to be a live mistake than
    // one that has been wrong for two years — the opposite of a deadline.
    const order = [
      alert('contradiction', '2024-03-01', 'wrong for two years'),
      alert('quiet', '2026-09-01', 'wrong since Tuesday'),
      alert('status_unknown', '2025-06-01', 'wrong for a year'),
    ].sort(byWorkingOrder).map((a) => a.title);
    expect(order).toEqual(['wrong since Tuesday', 'wrong for a year', 'wrong for two years']);
  });

  it('never hides a problem — it only moves it down', () => {
    // These are real work. The complaint was about priority, not about
    // wanting them gone.
    const all = [alert('contradiction', '2024-03-01'), alert('task', '2026-09-03')];
    expect(all.sort(byWorkingOrder).length).toBe(2);
  });

  it('is a total order, so the list does not shuffle between page loads', () => {
    const rows = [
      alert('contradiction', '2024-03-01', 'a'), alert('task', '2026-09-03', 'b'),
      alert('quiet', '2026-09-01', 'c'), alert('document', '2026-08-01', 'd'),
      alert('case_deadline', '2026-08-01', 'e'),
    ];
    const once = [...rows].sort(byWorkingOrder).map((a) => a.title);
    const twice = [...rows].reverse().sort(byWorkingOrder).map((a) => a.title);
    // Two rows sharing a timing and a date may sit either way round; what must
    // not happen is the groups interleaving.
    const groupOf = (t: string) => alertTiming(rows.find((r) => r.title === t)!.kind);
    expect(once.map(groupOf)).toEqual(twice.map(groupOf));
    expect(once.map(groupOf).join('')).toBe('duedueduewrongwrong');
  });
});

describe('the dashboard cards can be sorted and opened out', () => {
  const dash = readFileSync('src/modules/dashboard/index.ts', 'utf8');

  it('leads with the working order when no column is chosen', () => {
    // The fallback handed to the sorter is what orders the card before anybody
    // clicks a heading. Asserted on the call, not on the words appearing
    // somewhere in the file: an earlier version checked only that
    // `byWorkingOrder` was mentioned, and it still is after the sort is
    // reverted, because the import remains.
    const call = dash.slice(dash.indexOf('const needsCard = sortCard('),
                            dash.indexOf('const deadlineCard'));
    expect(call).toMatch(/: byWorkingOrder,/);
    expect(call).toMatch(/needsSort === 'date'/);
  });

  it('offers the controls as links, so they work with scripting off', () => {
    // A control that silently does nothing is worse than no control.
    const card = dash.slice(dash.indexOf('Needs you today —'), dash.indexOf('<div class="cols">'));
    expect(card).toMatch(/<a class="\$\{needsSort/);
    expect(card).not.toMatch(/onclick|addEventListener/);
  });

  it('no longer stops a card at a number nobody chose', () => {
    // The Deadlines query capped at 15 and the card simply stopped, with
    // nothing saying there was more.
    expect(dash).not.toMatch(/ORDER BY k\.decision_due_at LIMIT 15/);
    // Every card takes its length from the same preference-derived number.
    for (const card of ['needsCard', 'deadlineCard', 'myCasesCard']) {
      expect(dash, `${card} does not use the shared row count`)
        .toMatch(new RegExp(`${card}\\.rows\\.slice\\(0, needsRows\\)`));
    }
  });

  it('takes its row count from the reader’s own preference', () => {
    // Rather than this page having an opinion of its own. Twelve was written
    // in and could not be changed.
    expect(dash).toMatch(/pageSizeFor\(undefined, prefs\['pref\.page_size'\]\)/);
    expect(dash).not.toMatch(/slice\(0, 12\)/);
  });

  it('ranks priority by the register’s own order, not alphabetically', () => {
    // "urgent" must not sort under "high" because u comes after h.
    const rank = dash.match(/PRIORITY_RANK[^=]*= \{([^}]*)\}/)![1]!;
    expect(rank.indexOf('urgent')).toBeLessThan(rank.indexOf('high'));
    expect(rank.indexOf('high')).toBeLessThan(rank.indexOf('normal'));
    expect(rank.indexOf('normal')).toBeLessThan(rank.indexOf('low'));
  });

  it('gives every card its own place in the address', () => {
    // So sorting the Deadlines card does not silently reset "Needs you today".
    for (const pair of [['nk', 'nd'], ['dk', 'dd'], ['mk', 'md']]) {
      expect(dash, `${pair[0]} is not carried`).toMatch(new RegExp(`key: '${pair[0]}', dir: '${pair[1]}'`));
      expect(dash).toMatch(new RegExp(`q\\('${pair[0]}'\\)`));
    }
  });

  it('offers a sortable heading on all three cards', () => {
    // The ordinary thing a table does, which is what the practice asked for
    // when two whole-card orderings turned out to be interchangeable.
    for (const key of ['due', 'what', 'detail', 'case', 'client', 'status', 'next']) {
      expect(dash, `no heading sorts by ${key}`).toMatch(new RegExp(`sort: '${key}'`));
    }
    expect((dash.match(/sort: \w+Card\.table/g) ?? []).length).toBe(3);
  });
});
