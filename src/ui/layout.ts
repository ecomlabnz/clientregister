/** The application shell: chrome, navigation, flash messages. */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import { html, raw, type Raw } from './html';
import { getNavItems } from './nav-store';
import { visibleNav } from '../core/module';
import { initials } from './format';
import { APP_VERSION } from '../version';
import { themeOf, colourModeOf } from './theme';

export interface PageOpts {
  title: string;
  /** Nav href to mark current. */
  active?: string;
  /** Rendered without the nav chrome (login, setup). */
  bare?: boolean;
  /** The public website: no application chrome — the page supplies its own. */
  landing?: boolean;
  /** Meta description, for the one page that has an audience outside the office. */
  description?: string;
  /**
   * Everything here is a private register, so pages are kept out of search
   * indexes unless a page explicitly opts in.
   */
  indexable?: boolean;
  /** Extra head content — canonical, social cards, structured data. */
  head?: Raw;
  status?: number;
}

export function page(c: Context<AppContext>, opts: PageOpts, body: Raw): Response {
  const user = c.get('user');
  const session = c.get('session');
  const appName = c.env.APP_NAME || 'Client Register';
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  const chrome = !opts.bare && !opts.landing;
  const nav = chrome ? visibleNav(getNavItems(), user) : [];

  // Appearance is two attributes rendered by the server from the user's own
  // record: no theme script, nothing extra to load, and no flash of the wrong
  // colours. Signed-out pages get the defaults.
  const theme = themeOf(user ?? null);
  const mode = colourModeOf(user ?? null);

  const doc = html`<!doctype html>
<html lang="en-NZ" data-theme="${theme}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${opts.indexable ? 'index, follow' : 'noindex, nofollow'}">
${opts.description ? html`<meta name="description" content="${opts.description}">` : ''}
<title>${opts.landing ? opts.title : `${opts.title} · ${appName}`}</title>
${opts.head ?? ''}
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#f5484f">
</head>
${/*
   * Notification settings ride on the body as data attributes rather than in a
   * script block, because the policy forbids inline script — and this way the
   * values are the person's own, rendered by the server, with nothing to fetch
   * before the page can behave correctly.
   */ ''}
<body class="${opts.landing ? 'site' : opts.bare ? 'bare' : 'app'}"
  ${chrome && c.get('notify')
    ? raw(`data-notify="${c.get('notify')!.on ? '1' : '0'}"`
        + ` data-notify-position="${c.get('notify')!.position}"`
        + ` data-notify-sound="${c.get('notify')!.sound}"`
        + ` data-notify-every="${c.get('notify')!.everySeconds}"`)
    : ''}>
${opts.landing
    ? body
    : opts.bare
    ? html`<main class="bare-main">${body}</main>`
    : html`
<header class="topbar">
  <a class="brand" href="/">${appName}</a>
  <nav class="topnav">
    ${nav.map(
      (item) => html`<a href="${item.href}"
        class="${opts.active === item.href ? 'nav-link current' : 'nav-link'}">${item.label}</a>`,
    )}
  </nav>
  <div class="topbar-right">
    ${user
      ? html`<a class="whoami" href="/account" title="${user.email}">
               <span class="avatar">${initials(user.name)}</span>
               <span class="whoami-name">${user.name}</span>
             </a>
             ${session
               ? html`<form method="post" action="/logout" class="signout">
                        <input type="hidden" name="_csrf" value="${session.csrf}">
                        <button type="submit" class="btn btn-secondary btn-small">Sign out</button>
                      </form>`
               : ''}`
      : ''}
  </div>
</header>
<main class="main">
  ${ok ? html`<div class="alert alert-ok">${ok}</div>` : ''}
  ${err ? html`<div class="alert alert-error">${err}</div>` : ''}
  ${body}
</main>
<footer class="footer">
  <span>${appName}</span>
  <span class="muted">
    <a href="/help">Help</a> · v${APP_VERSION}${c.env.APP_ENV !== 'production' ? ` · ${c.env.APP_ENV}` : ''}
  </span>
</footer>`}
<script src="/app.js" defer></script>
</body>
</html>`;

  return c.html(doc.value, (opts.status ?? 200) as 200);
}

/** Redirect back with a success or error banner. */
export function redirectWith(c: Context<AppContext>, path: string, message: string, kind: 'ok' | 'err' = 'ok'): Response {
  const sep = path.includes('?') ? '&' : '?';
  return c.redirect(`${path}${sep}${kind}=${encodeURIComponent(message)}`, 303);
}

export function breadcrumbs(items: Array<{ href?: string; label: string }>): Raw {
  return html`<nav class="crumbs">${items.map((item, i) =>
    html`${i > 0 ? raw('<span class="crumb-sep">/</span>') : ''}${
      item.href ? html`<a href="${item.href}">${item.label}</a>` : html`<span>${item.label}</span>`
    }`)}</nav>`;
}
