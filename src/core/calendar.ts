/**
 * What the register has on any given day.
 *
 * The calendar is a **view over dates the register already owns**, not a new
 * store of them. The practice decided on 3 September that it holds no
 * appointments of its own: every event here belongs to a record — a matter, a
 * task, a passport — and is edited on that record. Moving a visa expiry does
 * not change when the visa expires.
 *
 * ## Why a registry rather than one query
 *
 * Each kind of date is a `CalendarSource`: a label, a colour, and a function
 * that returns events between two dates. Adding a new kind of date to the
 * calendar is adding one entry to `CALENDAR_SOURCES` — not editing a query that
 * eleven things already depend on. That is what makes this modular, and it is
 * what the practice asked for when it said a per-user calendar should be
 * possible later: `CalendarFilter.ownerId` already narrows every source that
 * knows who owns its records, so "Luiza's calendar" is a filter value rather
 * than a second calendar.
 *
 * ## Why not `collectAlerts`
 *
 * They look similar and are not the same collection. Alerts answer *what is
 * wrong or due soon* — and half of what they return has no date the calendar
 * could use: a matter whose record contradicts itself is not an event on the
 * day it was lodged. A calendar answers *what happens on this day*, including
 * days that have passed and things that went perfectly well: a lodgement, a
 * decision. One is a worry list, the other is a diary.
 */

import type { Env } from '../types';
import { all } from './db';

export type CalendarTone = 'red' | 'amber' | 'green' | 'blue' | 'grey';

export interface CalendarEvent {
  /** `YYYY-MM-DD`. Every event is a whole day: the register stores no times. */
  date: string;
  /** Which source produced it, so the reader can switch it off. */
  source: string;
  title: string;
  /** One line under the title. Never repeats the title. */
  detail: string;
  href: string;
  tone: CalendarTone;
  /** Who owns the underlying record, where it has an owner. */
  ownerId: string | null;
  ownerName: string | null;
}

export interface CalendarFilter {
  /** Only these sources. Empty or absent means all of them. */
  sources?: string[];
  /** Only records owned by this person. The seed of a per-user calendar. */
  ownerId?: string | null;
}

export interface CalendarSource {
  id: string;
  /** Plain words. This is what the reader ticks. */
  label: string;
  tone: CalendarTone;
  /** Whether these events are in the past by nature — a lodgement, a decision. */
  historic?: boolean;
  /**
   * Whether this source can be narrowed to one person. A passport expiry
   * belongs to a client, not to a member of staff, so filtering it by owner
   * would silently empty the calendar rather than narrow it.
   */
  ownable?: boolean;
  load(env: Env, from: string, to: string, filter: CalendarFilter): Promise<CalendarEvent[]>;
}

/** A cap per source, so one busy source cannot fill a month on its own. */
const PER_SOURCE_LIMIT = 400;

/** `AND k.assigned_to = ?` when narrowing to a person, and nothing otherwise. */
function ownerClause(column: string, filter: CalendarFilter): { sql: string; params: string[] } {
  return filter.ownerId
    ? { sql: ` AND ${column} = ?`, params: [filter.ownerId] }
    : { sql: '', params: [] };
}

export const CALENDAR_SOURCES: CalendarSource[] = [
  {
    id: 'decision_due', label: 'Decision due', tone: 'red', ownable: true,
    async load(env, from, to, filter) {
      const o = ownerClause('k.assigned_to', filter);
      return (await all<any>(env.DB,
        `SELECT k.id, k.ref, k.title, k.descriptor, k.decision_due_at AS date,
                cl.full_name AS client_name, u.name AS owner_name, k.assigned_to AS owner_id
           FROM cases k JOIN clients cl ON cl.id = k.client_id
           LEFT JOIN users u ON u.id = k.assigned_to
          WHERE k.decision_due_at IS NOT NULL
            AND substr(k.decision_due_at, 1, 10) BETWEEN ? AND ?${o.sql}
          ORDER BY k.decision_due_at LIMIT ${PER_SOURCE_LIMIT}`, from, to, ...o.params))
        .map((r) => ({
          date: String(r.date).slice(0, 10), source: 'decision_due', tone: 'red' as const,
          title: r.title, detail: `${r.client_name} · ${r.ref}`,
          href: `/cases/${r.id}`, ownerId: r.owner_id, ownerName: r.owner_name,
        }));
    },
  },
  {
    id: 'task', label: 'Tasks', tone: 'amber', ownable: true,
    async load(env, from, to, filter) {
      const o = ownerClause('t.assigned_to', filter);
      return (await all<any>(env.DB,
        `SELECT t.id, t.title, t.due_at AS date, t.status, t.priority,
                u.name AS owner_name, t.assigned_to AS owner_id
           FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.due_at IS NOT NULL
            AND substr(t.due_at, 1, 10) BETWEEN ? AND ?${o.sql}
          ORDER BY t.due_at LIMIT ${PER_SOURCE_LIMIT}`, from, to, ...o.params))
        .map((r) => ({
          date: String(r.date).slice(0, 10), source: 'task',
          // A finished task still belongs on the day it was due — a calendar
          // that hides what was done reads as though nothing happened.
          tone: (r.status === 'done' ? 'grey' : 'amber') as CalendarTone,
          title: r.title,
          detail: `${r.status === 'done' ? 'Done · ' : ''}${r.owner_name ?? 'Unassigned'}`,
          href: `/tasks/${r.id}`, ownerId: r.owner_id, ownerName: r.owner_name,
        }));
    },
  },
  {
    id: 'lodged', label: 'Lodged', tone: 'blue', historic: true, ownable: true,
    async load(env, from, to, filter) {
      const o = ownerClause('k.assigned_to', filter);
      return (await all<any>(env.DB,
        `SELECT k.id, k.ref, k.title, k.lodged_at AS date, cl.full_name AS client_name,
                u.name AS owner_name, k.assigned_to AS owner_id
           FROM cases k JOIN clients cl ON cl.id = k.client_id
           LEFT JOIN users u ON u.id = k.assigned_to
          WHERE k.lodged_at IS NOT NULL
            AND substr(k.lodged_at, 1, 10) BETWEEN ? AND ?${o.sql}
          ORDER BY k.lodged_at LIMIT ${PER_SOURCE_LIMIT}`, from, to, ...o.params))
        .map((r) => ({
          date: String(r.date).slice(0, 10), source: 'lodged', tone: 'blue' as const,
          title: `Lodged — ${r.title}`, detail: `${r.client_name} · ${r.ref}`,
          href: `/cases/${r.id}`, ownerId: r.owner_id, ownerName: r.owner_name,
        }));
    },
  },
  {
    id: 'decided', label: 'Decided', tone: 'green', historic: true, ownable: true,
    async load(env, from, to, filter) {
      const o = ownerClause('k.assigned_to', filter);
      return (await all<any>(env.DB,
        `SELECT k.id, k.ref, k.title, k.decided_at AS date, k.status, k.outcome,
                cl.full_name AS client_name, u.name AS owner_name, k.assigned_to AS owner_id
           FROM cases k JOIN clients cl ON cl.id = k.client_id
           LEFT JOIN users u ON u.id = k.assigned_to
          WHERE k.decided_at IS NOT NULL
            AND substr(k.decided_at, 1, 10) BETWEEN ? AND ?${o.sql}
          ORDER BY k.decided_at LIMIT ${PER_SOURCE_LIMIT}`, from, to, ...o.params))
        .map((r) => ({
          date: String(r.date).slice(0, 10), source: 'decided',
          tone: (r.status === 'declined' ? 'red' : 'green') as CalendarTone,
          title: `${r.status === 'declined' ? 'Declined' : 'Decided'} — ${r.title}`,
          detail: `${r.client_name} · ${r.ref}`,
          href: `/cases/${r.id}`, ownerId: r.owner_id, ownerName: r.owner_name,
        }));
    },
  },
  {
    id: 'visa_expiry', label: 'Visa expiry', tone: 'red',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT id, ref, full_name, current_visa_expiry AS date FROM clients
          WHERE current_visa_expiry IS NOT NULL AND current_visa_expiry BETWEEN ? AND ?
            AND status != 'archived'
          ORDER BY current_visa_expiry LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'visa_expiry', tone: 'red' as const,
          title: `Visa expires — ${r.full_name}`, detail: String(r.ref),
          href: `/clients/${r.id}`, ownerId: null, ownerName: null,
        }));
    },
  },
  {
    id: 'passport_expiry', label: 'Passport expiry', tone: 'amber',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT c.id, c.ref, c.full_name, p.expires_on AS date, p.country
           FROM client_passports p JOIN clients c ON c.id = p.client_id
          WHERE p.status = 'held' AND p.expires_on IS NOT NULL
            AND p.expires_on BETWEEN ? AND ? AND c.status != 'archived'
          ORDER BY p.expires_on LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'passport_expiry', tone: 'amber' as const,
          title: `Passport expires — ${r.full_name}`,
          detail: `${r.country ? `${r.country} · ` : ''}${r.ref}`,
          href: `/clients/${r.id}`, ownerId: null, ownerName: null,
        }));
    },
  },
  {
    id: 'certificate_expiry', label: 'Certificates', tone: 'amber',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT c.id, c.ref, c.full_name, cc.expires_on AS date, cc.kind
           FROM client_certificates cc JOIN clients c ON c.id = cc.client_id
          WHERE cc.expires_on IS NOT NULL AND cc.expires_on BETWEEN ? AND ?
            AND c.status != 'archived'
          ORDER BY cc.expires_on LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'certificate_expiry', tone: 'amber' as const,
          title: `${r.kind === 'chest_xray' ? 'Chest x-ray' : r.kind === 'police' ? 'Police certificate' : 'Medical certificate'} expires — ${r.full_name}`,
          detail: String(r.ref), href: `/clients/${r.id}`, ownerId: null, ownerName: null,
        }));
    },
  },
  {
    id: 'invoice_due', label: 'Invoices due', tone: 'blue',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT i.id, i.ref, i.due_on AS date, i.status, cl.full_name AS client_name
           FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
          WHERE i.due_on IS NOT NULL AND i.due_on BETWEEN ? AND ?
            AND i.status IN ('issued','part_paid')
          ORDER BY i.due_on LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'invoice_due', tone: 'blue' as const,
          title: `Invoice ${r.ref} due`, detail: r.client_name ?? 'No client',
          href: `/invoices/${r.id}`, ownerId: null, ownerName: null,
        }));
    },
  },
  {
    id: 'quote_expiry', label: 'Quotes expiring', tone: 'grey',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT q.id, q.ref, q.valid_until AS date, cl.full_name AS client_name
           FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id
          WHERE q.status = 'sent' AND q.valid_until IS NOT NULL
            AND q.valid_until BETWEEN ? AND ?
          ORDER BY q.valid_until LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'quote_expiry', tone: 'grey' as const,
          title: `Quote ${r.ref} expires`, detail: r.client_name ?? 'No client',
          href: `/quotes/${r.id}`, ownerId: null, ownerName: null,
        }));
    },
  },
  {
    id: 'flag_expiry', label: 'Warnings lapsing', tone: 'grey',
    async load(env, from, to) {
      return (await all<any>(env.DB,
        `SELECT f.id, f.entity_type, f.entity_id, f.body, f.expires_on AS date
           FROM flags f
          WHERE f.cleared_at IS NULL AND f.expires_on IS NOT NULL
            AND f.expires_on BETWEEN ? AND ?
          ORDER BY f.expires_on LIMIT ${PER_SOURCE_LIMIT}`, from, to))
        .map((r) => ({
          date: r.date, source: 'flag_expiry', tone: 'grey' as const,
          title: 'A warning lapses',
          detail: String(r.body).slice(0, 120),
          href: r.entity_type === 'case' ? `/cases/${r.entity_id}` : `/clients/${r.entity_id}`,
          ownerId: null, ownerName: null,
        }));
    },
  },
];

/**
 * Every event between two dates, from every source the filter allows.
 *
 * Sources run together and a failing one is dropped rather than taking the page
 * down: a calendar missing one kind of date is still a calendar, and a blank
 * page is not. What failed is logged.
 */
export async function calendarEvents(
  env: Env, from: string, to: string, filter: CalendarFilter = {},
): Promise<CalendarEvent[]> {
  const wanted = CALENDAR_SOURCES.filter((s) => {
    if (filter.sources?.length && !filter.sources.includes(s.id)) return false;
    // Narrowing to a person hides the sources that have no person to narrow by,
    // rather than showing everybody's client expiries under one name.
    if (filter.ownerId && !s.ownable) return false;
    return true;
  });

  const results = await Promise.allSettled(
    wanted.map((s) => s.load(env, from, to, filter)));

  const events: CalendarEvent[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') events.push(...r.value);
    else console.error('calendar source failed', wanted[i]!.id, r.reason);
  });
  return events.sort((a, b) =>
    a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

/** Events keyed by day, for a grid that needs to ask "what is on the 14th". */
export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = out.get(e.date);
    if (list) list.push(e); else out.set(e.date, [e]);
  }
  return out;
}
