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
import { can } from './rbac';

export interface NavItem {
  href: string;
  label: string;
  /** Hidden from users lacking this permission. */
  permission?: Permission;
  /** Highest first; ties break on declaration order. */
  order?: number;
}

export interface AppModule {
  /** Stable machine name, used in audit entries. */
  name: string;
  /** Human title, shown in admin. */
  title: string;
  /** Mount points, e.g. ['/clients']. Informational — used by docs and admin. */
  basePaths?: string[];
  nav?: NavItem[];
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
