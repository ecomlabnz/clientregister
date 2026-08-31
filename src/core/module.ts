/**
 * The module contract.
 *
 * A feature is a folder under src/modules that exports one `AppModule`. It
 * owns its routes and its navigation entry, and it is mounted by app.ts. To
 * add a feature you write the module and add one line to the registry; to
 * remove one you delete that line. Nothing else in the app knows about it.
 */

import type { Hono } from 'hono';
import type { AppContext, User } from '../types';
import type { Permission } from './rbac';
import type { SettingsGroup } from './settings';
import { can } from './rbac';

export interface NavItem {
  href: string;
  label: string;
  /** Hidden from users lacking this permission. */
  permission?: Permission;
  /** Highest first; ties break on declaration order. */
  order?: number;
  /**
   * A heading this item sits under, rather than in the bar on its own.
   *
   * The bar had twelve items and wrapped onto a second line, which is the
   * point at which a navigation stops being scannable — you read it instead of
   * glancing at it. Grouping is the same answer the pages already use for
   * themselves: tabs when it runs past one screen.
   *
   * Declared by the module rather than listed centrally, so a module still
   * owns its own entry and adding one is still a line in that module.
   */
  group?: string;
  /**
   * Kept out of the main run and shown in the corner with the account
   * controls. For the things you reach for occasionally and never scan past.
   */
  corner?: boolean;
}

/** A run of nav items under one heading, or a single item on its own. */
export type NavEntry =
  | { kind: 'item'; item: NavItem }
  | { kind: 'group'; label: string; items: NavItem[] };

/**
 * The bar as it is rendered: items in order, with grouped ones collected under
 * their heading at the position of the first of them.
 */
export function navEntries(items: NavItem[]): NavEntry[] {
  const out: NavEntry[] = [];
  const groups = new Map<string, { kind: 'group'; label: string; items: NavItem[] }>();
  for (const item of items) {
    if (!item.group) { out.push({ kind: 'item', item }); continue; }
    const existing = groups.get(item.group);
    if (existing) { existing.items.push(item); continue; }
    const fresh = { kind: 'group' as const, label: item.group, items: [item] };
    groups.set(item.group, fresh);
    out.push(fresh);
  }
  return out;
}

export interface AppModule {
  /** Stable machine name, used in audit entries. */
  name: string;
  /** Human title, shown in admin. */
  title: string;
  /** Mount points, e.g. ['/clients']. Informational — used by docs and admin. */
  basePaths?: string[];
  nav?: NavItem[];
  /**
   * Configuration this module owns, rendered as a tab on the settings page.
   * Declaring settings here is what allows them to be validated and saved
   * generically — and is what stops anything undeclared being written.
   */
  settings?: SettingsGroup[];
  /** Attach routes to the main app. Called once at startup. */
  register(app: Hono<AppContext>): void;
}

/** Every nav item every module declares, in display order. */
export function collectNav(modules: AppModule[]): NavItem[] {
  const items: NavItem[] = [];
  for (const mod of modules) items.push(...(mod.nav ?? []));
  return items.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
}

/** The subset of `items` this user may see. */
export function visibleNav(items: NavItem[], user: User | null): NavItem[] {
  return items.filter((item) => !item.permission || can(user, item.permission));
}
