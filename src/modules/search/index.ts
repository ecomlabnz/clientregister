/**
 * Module: search.
 *
 * One box for the whole register. A person looking for "Kiwi Orchards" may be
 * after the client, the matter, the invoice or a note somebody left, and a
 * search that only knew about clients would be abandoned within a fortnight.
 *
 * The page is a plain GET form, so it works with scripting off; with scripting
 * it refreshes as you type through the enhancement every other filter on the
 * register already uses. Nothing here writes anything.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requireAuth, requirePermission } from '../../core/auth';
import { page } from '../../ui/layout';
import { html } from '../../ui/html';
import { badge, card, emptyState, pageHeader } from '../../ui/components';
import { truncate } from '../../ui/format';
import { KIND_LABELS, KIND_ORDER, searchEverything, type SearchHit } from '../../core/search';

export const searchModule: AppModule = {
  name: 'search',
  title: 'Search',
  basePaths: ['/search'],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      const hits = q ? await searchEverything(c.env, q) : [];

      const grouped = KIND_ORDER
        .map((kind) => ({ kind, rows: hits.filter((h) => h.kind === kind) }))
        .filter((g) => g.rows.length > 0);

      return page(c, { title: q ? `Search — ${q}` : 'Search', active: '/search' }, html`
        ${pageHeader('Search', 'Clients, matters, tasks, quotes, invoices, inquiries, file notes, '
          + 'documents and the knowledge base.')}

        <form method="get" action="/search" class="filters" data-live-search>
          <input type="search" name="q" value="${q}" autofocus
                 placeholder="Name, reference, INZ number, or a phrase from a note">
          <button class="btn btn-secondary js-hide" type="submit">Search</button>
        </form>

        <div data-live-results>
          ${/* A single letter matches most of the register, so it is refused
                rather than answered — but it is refused honestly. Saying "no
                matches" to one letter is a lie about the register's contents. */ ''}
          ${!q
            ? card('Nothing typed yet', emptyState('Type two letters or more.'))
            : q.length < 2
              ? card('Keep typing', emptyState('One letter matches almost everything. '
                  + 'Type two or more.'))
              : grouped.length === 0
                ? card('No matches', emptyState(`Nothing in the register matches “${q}”.`))
              : html`${grouped.map((group) => card(
                  `${KIND_LABELS[group.kind]} — ${group.rows.length}`,
                  html`<ul class="list">
                    ${group.rows.map((hit: SearchHit) => html`
                      <li class="list-row">
                        <div>
                          <a href="${hit.href}">${truncate(hit.title, 110) || '(untitled)'}</a>
                          ${hit.detail
                            ? html`<div class="small muted clamp-1">${hit.detail}</div>` : ''}
                        </div>
                        <div>${hit.weight === 0 ? badge('exact reference', 'green') : ''}</div>
                      </li>`)}
                  </ul>`))}`}
        </div>`);
    });

    app.route('/search', r);
  },
};
