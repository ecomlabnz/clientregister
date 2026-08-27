/** The application shell: chrome, navigation, flash messages. */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import { html, raw, type Raw } from './html';
import { getNavItems } from './nav-store';
import { visibleNav } from '../core/module';
import { initials } from './format';

export interface PageOpts {
  title: string;
  /** Nav href to mark current. */
  active?: string;
  /** Rendered without the nav chrome (login, setup). */
  bare?: boolean;
  status?: number;
}

export function page(c: Context<AppContext>, opts: PageOpts, body: Raw): Response {
  const user = c.get('user');
  const appName = c.env.APP_NAME || 'Client Register';
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  const nav = opts.bare ? [] : visibleNav(getNavItems(), user);

  const doc = html`<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${opts.title} · ${appName}</title>
<link rel="stylesheet" href="/app.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="${opts.bare ? 'bare' : 'app'}">
${opts.bare
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
             </a>`
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
  <span class="muted">${c.env.APP_ENV !== 'production' ? `environment: ${c.env.APP_ENV}` : ''}</span>
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
