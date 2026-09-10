/** The application shell: chrome, navigation, flash messages. */

import type { Context } from 'hono';
import type { AppContext } from '../types';
import { html, raw, type Raw } from './html';
import { getNavItems } from './nav-store';
import { navEntries } from '../core/module';
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
  /**
   * This page **is** a document — a quotation, a letter of engagement, an
   * invoice — and is served as paper whatever the reader's theme.
   *
   * **The fault this closes, for the third time.** A quotation printed by the
   * practice on 9 September 2026 arrived with a near-black rectangle over both
   * pages. 1.23.0 had already moved the paper palette onto `.quote-doc` so the
   * document would not depend on the print stylesheet running — and it did run:
   * the application's header and buttons are correctly absent from that PDF.
   *
   * What the print stylesheet could not reach is the **canvas**. The colour
   * behind the whole page comes from `color-scheme` on the *root* element, and
   * the print block set it on `body`. With the browser's "Background graphics"
   * ticked, the dark canvas printed, under a document that was white.
   *
   * So a document page no longer renders in a dark theme at all. It is served
   * with `data-mode="light"`, which is what it has always been: this is not a
   * print rule, a media query or an override, and there is nothing left for a
   * render path to skip. What the practice sees on the screen is now what comes
   * out of the printer, which is the property that was wanted all along.
   *
   * The sign-in page is `bare` too and is not paper, which is why this is its
   * own flag rather than being read off `bare`.
   */
  paper?: boolean;
  /**
   * Serve the page without `/app.js`.
   *
   * The shared script exists for the application's forms — confirmations, live
   * search, the quote line picker. A page with no forms on it downloads six
   * hundred lines to do nothing, and the pages that have no forms are exactly
   * the ones opened by somebody outside the office, on a phone, on whatever
   * connection they have. So the document a client is sent goes without it.
   *
   * This is not a way to make a page work without JavaScript — every page here
   * already does. It is a way to stop sending what will not be used.
   */
  noScript?: boolean;
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
  // A document is paper. See `paper` above for why this is not a print rule.
  const mode = opts.paper ? 'light' : colourModeOf(user ?? null);

  const doc = html`<!doctype html>
<html lang="en-NZ" data-theme="${theme}" data-mode="${mode}"${opts.paper ? raw(' data-paper') : ''}>
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
  ${'' /* Grouped items collapse into a heading that opens on press. Built on
           `<details>` like every other disclosure here, so it needs no script —
           and it closes when the page navigates, because each link is a real
           link and the page is rendered fresh. A group whose page you are on
           renders open, so you can see where you are without pressing
           anything. */}
  <nav class="topnav">
    ${navEntries(nav.filter((item) => !item.corner)).map((entry) => (entry.kind === 'item'
      ? html`<a href="${entry.item.href}"
          class="${opts.active === entry.item.href ? 'nav-link current' : 'nav-link'}">${entry.item.label}</a>`
      : html`
        ${'' /* name="topnav" makes the menus an exclusive set: opening one
                 closes the other, in the browser, with no script. */}
        ${'' /* Closed on arrival, always.

                 **Reported on 9 September 2026:** *"the Money menu keeps
                 opening on its own — why?"* Because it did: the group was
                 rendered `open` whenever the page you were on sat inside it, so
                 every visit to Quotes or Invoices arrived with a panel hanging
                 over the page and covering the search box.

                 The intention was to show where you are, and that part was
                 right — but a dropdown is absolutely positioned, so "open"
                 means "covering the page", not "highlighted". Where you are is
                 said by the summary carrying `current`, which is how every
                 other item in the bar says it. On a phone the panel is laid out
                 in the flow rather than over the page, so it opened harmlessly
                 there and only looked broken on a desktop. */}
        <details class="nav-group" name="topnav">
          <summary class="${entry.items.some((i) => i.href === opts.active) ? 'nav-link current' : 'nav-link'}">
            ${entry.label}
          </summary>
          <div class="nav-group-items">
            ${entry.items.map((item) => html`<a href="${item.href}"
              class="${opts.active === item.href ? 'nav-link current' : 'nav-link'}">${item.label}</a>`)}
          </div>
        </details>`))}
  </nav>
  <div class="topbar-right">
    ${'' /* Reached occasionally and never scanned past, so out of the run and
             beside the account controls. */}
    ${nav.filter((item) => item.corner).map((item) => html`<a href="${item.href}"
      class="${opts.active === item.href ? 'nav-corner current' : 'nav-corner'}">${item.label}</a>`)}
    ${user
      ? html`${/* One box for the whole register, on every page. A plain GET
                   form: it needs no scripting to work, and the results page
                   refreshes as you type once scripting is there. */ ''}
             <form method="get" action="/search" class="topsearch" role="search">
               <input type="search" name="q" placeholder="Search everything"
                      aria-label="Search the register" autocomplete="off">
             </form>` : ''}
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
${opts.noScript ? '' : raw('<script src="/app.js" defer></script>')}
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
