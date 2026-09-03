/**
 * The calendar.
 *
 * A month at a glance, an agenda beneath it, and one day in detail — over the
 * dates the register already owns. It holds nothing of its own: the practice
 * decided on 3 September that appointments stay out, so every row here belongs
 * to a matter, a task, a passport or an invoice, and is edited there.
 *
 * The events come from `core/calendar.ts`, which keeps them in a registry of
 * sources. This file draws; it does not know where a date comes from.
 *
 * Everything is a link. There is no script on this page at all — the register
 * works with scripting switched off, and a month grid is the sort of thing that
 * invites a library the content-security policy would refuse to load anyway.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all } from '../../core/db';
import { requireAuth, requirePermission } from '../../core/auth';
import { page } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { badge, card, emptyState, pageHeader } from '../../ui/components';
import { dateShort, relativeDays } from '../../ui/format';
import {
  byDay, calendarEvents, CALENDAR_SOURCES, type CalendarEvent,
} from '../../core/calendar';
import {
  firstDay, lastDay, monthGrid, monthKeyOf, monthName, shiftDate, shiftMonth,
  validDate, validMonth, validYear, weekDays, weekName, weekStart, yearMonths, WEEKDAYS,
} from '../../core/months';

/** How many events a day cell shows before it says how many more there are. */
const PER_CELL = 3;

export const calendarModule: AppModule = {
  name: 'calendar',
  title: 'Calendar',
  basePaths: ['/calendar'],
  nav: [{ href: '/calendar', label: 'Calendar', permission: 'register:read', order: 76 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const user = c.get('user')!;
      const today = new Date().toISOString().slice(0, 10);

      /*
       * Three ways of looking at the same events, asked for in that order by
       * the practice. They differ only in the range they ask for and how they
       * draw it — the events, the filters and the agenda are identical, which
       * is what keeps a third view from being a third page.
       */
      const askedView = c.req.query('v');
      const view: 'month' | 'week' | 'year' =
        askedView === 'week' || askedView === 'year' ? askedView : 'month';

      const month = validMonth(c.req.query('m'), monthKeyOf(today));
      const year = validYear(c.req.query('y'), Number(today.slice(0, 4)));
      // The week is named by any day inside it; the arithmetic finds its Monday.
      const anchorDay = validDate(c.req.query('w')) ?? today;
      const weekFrom = weekStart(anchorDay);
      const weekTo = shiftDate(weekFrom, 6);

      const range = view === 'week'
        ? { from: weekFrom, to: weekTo }
        : view === 'year'
          ? { from: `${year}-01-01`, to: `${year}-12-31` }
          : { from: firstDay(month), to: lastDay(month) };

      // Which sources are switched on. Absent means all of them — a calendar
      // that opens empty because a previous visit unticked something is a
      // calendar nobody trusts.
      const asked = (c.req.query('s') ?? '').split(',').filter(Boolean);
      const known = new Set(CALENDAR_SOURCES.map((s) => s.id));
      const chosen = asked.filter((id) => known.has(id));
      const showing = chosen.length ? chosen : CALENDAR_SOURCES.map((s) => s.id);

      // "Mine" is the seed of the per-user calendars the practice asked to keep
      // possible: it is a filter value, not a second page.
      const mine = c.req.query('who') === 'me';
      const ownerId = mine ? user.id : null;

      const events = await calendarEvents(
        c.env, range.from, range.to, { sources: showing, ownerId });
      const days = byDay(events);

      /** This page's address, so one control never clears another. */
      const href = (over: Record<string, string>) => {
        const p = new URLSearchParams({
          // Every view carries all three anchors, so switching between them
          // lands where the reader was rather than back on today.
          ...(view === 'month' ? {} : { v: view }),
          m: month, y: String(year), w: weekFrom,
          ...(chosen.length ? { s: chosen.join(',') } : {}),
          ...(mine ? { who: 'me' } : {}),
          ...over,
        });
        for (const [k, v] of [...p]) if (!v) p.delete(k);
        const q = p.toString();
        return q ? `/calendar?${q}` : '/calendar';
      };

      /** The address with one source toggled, so a tick is a link. */
      const toggle = (id: string): string => {
        const on = new Set(showing);
        if (on.has(id)) on.delete(id); else on.add(id);
        // All of them on is the same as none specified, and the shorter address
        // is the one worth sharing.
        const next = [...on];
        return next.length === CALENDAR_SOURCES.length
          ? href({ s: '' })
          : href({ s: next.join(',') });
      };

      const counts = new Map<string, number>();
      for (const e of events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);

      // What this view is called, what it spans, and where its arrows go. Held
      // in one place so the heading, the title and the arrows cannot disagree
      // about which period is on screen.
      const period = view === 'week'
        ? { name: weekName(weekFrom), noun: 'this week',
            back: href({ w: shiftDate(weekFrom, -7) }), backLabel: 'Previous week',
            forward: href({ w: shiftDate(weekFrom, 7) }), forwardLabel: 'Next week',
            here: href({ w: today }), hereLabel: 'This week' }
        : view === 'year'
          ? { name: String(year), noun: 'this year',
              back: href({ y: String(year - 1) }), backLabel: String(year - 1),
              forward: href({ y: String(year + 1) }), forwardLabel: String(year + 1),
              here: href({ y: today.slice(0, 4) }), hereLabel: 'This year' }
          : { name: monthName(month), noun: 'this month',
              back: href({ m: shiftMonth(month, -1) }), backLabel: monthName(shiftMonth(month, -1)),
              forward: href({ m: shiftMonth(month, 1) }), forwardLabel: monthName(shiftMonth(month, 1)),
              here: href({ m: monthKeyOf(today) }), hereLabel: 'This month' };

      return page(c, { title: `Calendar — ${period.name}`, active: '/calendar' }, html`
        ${pageHeader(period.name,
          `${events.length} ${events.length === 1 ? 'thing' : 'things'} ${period.noun}`
            + (mine ? ', yours' : ''),
          // Named for the period rather than "Today": on a month grid "Today"
          // is ambiguous — the day or the month — and it is also the old name of
          // the dashboard, which the manual is careful not to reuse.
          html`<a class="btn btn-secondary" href="${period.here}">${period.hereLabel}</a>`)}

        ${'' /* Ordinary links throughout: no script on this page. */}
        <nav class="tabs">
          ${([['month', 'Month'], ['week', 'Week'], ['year', 'Year']] as const).map(([id, label]) => html`
            <a class="${view === id ? 'tab current' : 'tab'}"
               href="${href({ v: id === 'month' ? '' : id })}">${label}</a>`)}
          <a class="${!mine ? 'tab current' : 'tab'}" href="${href({ who: '' })}">Everyone</a>
          <a class="${mine ? 'tab current' : 'tab'}" href="${href({ who: 'me' })}">Mine</a>
        </nav>

        <nav class="tabs tabs-sub">
          <a class="tab" href="${period.back}">← ${period.backLabel}</a>
          <a class="tab current">${period.name}</a>
          <a class="tab" href="${period.forward}">${period.forwardLabel} →</a>
        </nav>

        ${'' /* The legend is also the filter: a colour and what it means, and
                 clicking it takes that kind off the month. Two things in one
                 row rather than a key nobody reads beside a filter nobody
                 finds. */}
        <div class="filters cal-legend">
          ${CALENDAR_SOURCES.map((s) => {
            const on = showing.includes(s.id);
            const n = counts.get(s.id) ?? 0;
            return html`
              <a class="cal-key ${on ? '' : 'cal-key-off'}" href="${toggle(s.id)}"
                 title="${on ? `Hide ${s.label}` : `Show ${s.label}`}">
                <span class="cal-dot cal-${s.tone}"></span>${s.label}
                ${on ? html`<span class="muted">${String(n)}</span>` : ''}
              </a>`;
          })}
          ${chosen.length ? html`<a class="btn btn-link" href="${href({ s: '' })}">Show all kinds</a>` : ''}
        </div>

        ${mine ? html`<p class="hint">Showing only what is assigned to you. Client dates —
           visas, passports, certificates — belong to a client rather than to a person, so they
           are not in this view.</p>` : ''}

        ${'' /* Every grid is hidden under 760px by CSS and the agenda below
                 takes over: seven columns on a phone is seven columns of
                 nothing. The three views differ only here. */}
        <div class="cal-wrap">
          ${view === 'month' ? html`
            <table class="cal">
              <thead><tr>${WEEKDAYS.map((d) => html`<th>${d}</th>`)}</tr></thead>
              <tbody>
                ${monthGrid(month).map((week) => html`
                  <tr>
                    ${week.map((day) => day === null
                      ? html`<td class="cal-blank"></td>`
                      : dayCell(day, days.get(day) ?? [], today, href, PER_CELL))}
                  </tr>`)}
              </tbody>
            </table>` : ''}

          ${'' /* A week is one column a day, deeper than a month cell, so a
                   busy day shows everything on it rather than "+4 more". That
                   is the whole reason to look at a week. */}
          ${view === 'week' ? html`
            <table class="cal cal-week">
              <thead><tr>${weekDays(weekFrom).map((day) => html`
                <th class="${day === today ? 'cal-today-head' : ''}">
                  ${WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]}
                  <span class="muted">${day.slice(8)}</span>
                </th>`)}</tr></thead>
              <tbody>
                <tr>${weekDays(weekFrom).map((day) =>
                  dayCell(day, days.get(day) ?? [], today, href, 40))}</tr>
              </tbody>
            </table>` : ''}

          ${'' /* A year is twelve small months. Too small for titles, so a day
                   carries only whether anything is on it and how much — and the
                   number is a link into that month. */}
          ${view === 'year' ? html`
            <div class="cal-year">
              ${yearMonths(year).map((key) => html`
                <div class="cal-mini">
                  <a class="cal-mini-head" href="${href({ v: '', m: key })}">${monthName(key)}</a>
                  <table>
                    <thead><tr>${WEEKDAYS.map((d) => html`<th>${d.slice(0, 1)}</th>`)}</tr></thead>
                    <tbody>
                      ${monthGrid(key).map((week) => html`
                        <tr>${week.map((day) => {
                          if (!day) return html`<td></td>`;
                          const list = days.get(day) ?? [];
                          const tone = list.length ? busiestTone(list) : null;
                          return html`
                            <td class="${day === today ? 'cal-today' : ''}">
                              ${list.length
                                ? html`<a class="cal-mini-day cal-${tone}"
                                          href="${href({ v: '', m: key, d: day })}"
                                          title="${`${list.length} on ${day}`}">${day.slice(8)}</a>`
                                : raw(day.slice(8))}
                            </td>`;
                        })}</tr>`)}
                    </tbody>
                  </table>
                </div>`)}
            </div>` : ''}
        </div>

        ${(() => {
          // One day, when a cell was clicked. Above the month's agenda, because
          // it is what the reader just asked for.
          const day = validDate(c.req.query('d'));
          // Only when the chosen day is inside what is on screen — otherwise a
          // stale link from another month shows a panel about nothing.
          if (!day || day < range.from || day > range.to) return '';
          const list = days.get(day) ?? [];
          return card(`${dateShort(day)} — ${relativeDays(day)}`,
            list.length === 0
              ? emptyState('Nothing on this day.')
              : html`<ul class="list">${list.map(eventLine)}</ul>`);
        })()}

        ${card(`Everything in ${period.name}`, events.length === 0
          ? emptyState(chosen.length
              ? `Nothing of the kinds you have chosen falls in ${period.noun}.`
              : `Nothing falls in ${period.noun}.`)
          : html`<ul class="list">${events.map(eventLine)}</ul>`)}`);
    });

    app.route('/calendar', r);
  },
};

/**
 * One day in a grid. Shared by the month and the week, which differ only in how
 * many events a cell has room for — a week column is deep enough to show them
 * all, which is the whole reason to look at a week.
 */
function dayCell(
  day: string, list: CalendarEvent[], today: string,
  href: (over: Record<string, string>) => string, limit: number,
) {
  return html`
    <td class="${day === today ? 'cal-today' : ''}">
      <div class="cal-daynum">
        ${list.length ? html`<a href="${href({ d: day })}">${day.slice(8)}</a>` : raw(day.slice(8))}
      </div>
      ${list.slice(0, limit).map((e) => html`
        <a class="cal-event cal-${e.tone}" href="${e.href}"
           title="${`${e.title} — ${e.detail}`}">${e.title}</a>`)}
      ${list.length > limit
        ? html`<a class="cal-more" href="${href({ d: day })}">+${String(list.length - limit)} more</a>`
        : ''}
    </td>`;
}

/**
 * The loudest thing on a day, for the year view's single dot.
 *
 * A day with a deadline and a circular on it is a day with a deadline on it.
 * Taking the first event instead would colour the day by whichever source
 * happened to sort first, which is not information.
 */
export function busiestTone(list: CalendarEvent[]): CalendarEvent['tone'] {
  const order: Array<CalendarEvent['tone']> = ['red', 'amber', 'green', 'blue', 'grey'];
  for (const tone of order) if (list.some((e) => e.tone === tone)) return tone;
  return 'grey';
}

/** One event, as a line in an agenda. The same shape in both lists. */
function eventLine(e: CalendarEvent) {
  return html`
    <li>
      <span class="cal-dot cal-${e.tone}"></span>
      <a href="${e.href}">${e.title}</a>
      <span class="muted small"> · ${dateShort(e.date)}</span>
      <div class="muted small">${e.detail}${e.ownerName ? ` · ${e.ownerName}` : ''}</div>
    </li>`;
}
