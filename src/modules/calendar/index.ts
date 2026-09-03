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
  firstDay, lastDay, monthGrid, monthKeyOf, monthName, shiftMonth, validMonth, WEEKDAYS,
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
      const month = validMonth(c.req.query('m'), monthKeyOf(today));

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
        c.env, firstDay(month), lastDay(month), { sources: showing, ownerId });
      const days = byDay(events);

      /** This page's address, so one control never clears another. */
      const href = (over: Record<string, string>) => {
        const p = new URLSearchParams({
          m: month,
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

      const grid = monthGrid(month);
      const counts = new Map<string, number>();
      for (const e of events) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);

      return page(c, { title: `Calendar — ${monthName(month)}`, active: '/calendar' }, html`
        ${pageHeader(`${monthName(month)}`,
          `${events.length} ${events.length === 1 ? 'thing' : 'things'} this month`
            + (mine ? ', yours' : ''),
          // "This month", not "Today": on a month grid the second is ambiguous —
          // it could mean the day or the month — and "Today" is also the old name
          // of the dashboard, which the manual is careful not to reuse.
          html`<a class="btn btn-secondary" href="${href({ m: monthKeyOf(today) })}">This month</a>`)}

        ${'' /* Ordinary links throughout: no script on this page. */}
        <nav class="tabs">
          <a class="tab" href="${href({ m: shiftMonth(month, -1) })}">← ${monthName(shiftMonth(month, -1))}</a>
          <a class="tab current">${monthName(month)}</a>
          <a class="tab" href="${href({ m: shiftMonth(month, 1) })}">${monthName(shiftMonth(month, 1))} →</a>
          <a class="${!mine ? 'tab current' : 'tab'}" href="${href({ who: '' })}">Everyone</a>
          <a class="${mine ? 'tab current' : 'tab'}" href="${href({ who: 'me' })}">Mine</a>
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

        ${'' /* The grid is hidden under 760px by CSS and the agenda below takes
                 over: seven columns on a phone is seven columns of nothing. */}
        <div class="cal-wrap">
          <table class="cal">
            <thead><tr>${WEEKDAYS.map((d) => html`<th>${d}</th>`)}</tr></thead>
            <tbody>
              ${grid.map((week) => html`
                <tr>
                  ${week.map((day) => {
                    if (!day) return html`<td class="cal-blank"></td>`;
                    const list = days.get(day) ?? [];
                    return html`
                      <td class="${day === today ? 'cal-today' : ''}">
                        <div class="cal-daynum">
                          ${list.length
                            ? html`<a href="${href({ d: day })}">${day.slice(8)}</a>`
                            : raw(day.slice(8))}
                        </div>
                        ${list.slice(0, PER_CELL).map((e) => html`
                          <a class="cal-event cal-${e.tone}" href="${e.href}"
                             title="${`${e.title} — ${e.detail}`}">${e.title}</a>`)}
                        ${list.length > PER_CELL
                          ? html`<a class="cal-more" href="${href({ d: day })}">
                                   +${String(list.length - PER_CELL)} more</a>`
                          : ''}
                      </td>`;
                  })}
                </tr>`)}
            </tbody>
          </table>
        </div>

        ${(() => {
          // One day, when a cell was clicked. Above the month's agenda, because
          // it is what the reader just asked for.
          const day = c.req.query('d');
          if (!day || monthKeyOf(day) !== month) return '';
          const list = days.get(day) ?? [];
          return card(`${dateShort(day)} — ${relativeDays(day)}`,
            list.length === 0
              ? emptyState('Nothing on this day.')
              : html`<ul class="list">${list.map(eventLine)}</ul>`);
        })()}

        ${card(`Everything in ${monthName(month)}`, events.length === 0
          ? emptyState(chosen.length
              ? 'Nothing of the kinds you have chosen falls in this month.'
              : 'Nothing falls in this month.')
          : html`<ul class="list">${events.map(eventLine)}</ul>`)}`);
    });

    app.route('/calendar', r);
  },
};

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
