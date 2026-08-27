/**
 * Navigation is collected from the modules at startup and read by the layout.
 * Keeping it in its own store means modules never import the layout's importer,
 * so there is no cycle between "what exists" and "how it is drawn".
 */

import type { NavItem } from '../core/module';

let items: NavItem[] = [];

export function setNavItems(next: NavItem[]): void {
  items = next;
}

export function getNavItems(): NavItem[] {
  return items;
}
