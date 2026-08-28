/**
 * Module: the assistant.
 *
 * What the AI layer is for, and what it is not.
 *
 * It reads. Given a piece of text — an email somebody forwarded, a letter that
 * was scanned and pasted, a scrawl of notes from a call — it extracts what is
 * actually there and offers to start a record with it. Given a matter, it reads
 * the file and briefs whoever owns it.
 *
 * It does not write. Every suggestion arrives as a form somebody looks at and
 * submits, or as a note somebody presses save on. Nothing here creates a record
 * on its own, and nothing here is a step that cannot be done by hand — the
 * whole register works with the AI layer switched off, which is the point.
 * If the provider is down, over quota or was never configured, the assistant
 * says so and every workflow still completes.
 *
 * Every run is recorded in `ai_runs` with its input hash, output and latency,
 * so a suggestion acted on months ago can be traced back to what was asked.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { one } from '../../core/db';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import { badge, card, csrfField, emptyState, field, pageHeader, statusTone } from '../../ui/components';
import { dateTime } from '../../ui/format';
import { isAiEnabled } from '../../ai/provider';
import { runTriage, latestTriage } from '../../ai/triage';
import { caseTypes, labelFor } from '../../core/vocabulary';
import { newId } from '../../core/ids';

/** Shown wherever the assistant is offered but not switched on. */
function notConfigured(): ReturnType<typeof html> {
  return html`
    <div class="alert alert-warn">
      <p><strong>The AI layer is not switched on.</strong> Everything in this register works
         without it — this page is the only thing that needs it.</p>
      <p class="mb">To enable it, set <code>AI_PROVIDER</code> to <code>anthropic</code> with an
         <code>ANTHROPIC_API_KEY</code>, or to <code>workers-ai</code> to use Cloudflare's own
         models with nothing leaving their network. Both are repository secrets; see
         <a href="/help#connecting">the setup guide</a>.</p>
    </div>`;
}

export const assistantModule: AppModule = {
  name: 'assistant',
  title: 'Assistant',
  basePaths: ['/assistant'],
  nav: [{ href: '/assistant', label: 'Assistant', permission: 'ai:run', order: 15 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('ai:run'), async (c) => {
      const enabled = isAiEnabled(c.env);
      const session = c.get('session')!;
      const runId = c.req.query('run');
      const types = await caseTypes(c.env);

      // A suggestion is fetched back by its run id rather than held in a
      // session or re-run on every page load: it is already recorded, so
      // reading it is free and it cannot quietly change between being shown
      // and being acted on.
      const suggestion = runId ? await latestTriage(c.env, 'assistant', runId) : null;

      return page(c, { title: 'Assistant', active: '/assistant' }, html`
        ${pageHeader('Assistant',
          'Paste something in and it will tell you what it is. It never writes anything itself.')}

        ${enabled ? '' : notConfigured()}

        <div class="cols">
          <div class="col-main">
            ${card('Read this for me', html`
              <form method="post" action="/assistant" class="entry-form">
                ${csrfField(session.csrf)}
                ${field({ label: 'Subject or heading', name: 'subject', maxlength: 200,
                          placeholder: 'Optional — the subject line, or what this is' })}
                ${field({ label: 'The text', name: 'body', type: 'textarea', rows: 14, required: true,
                          maxlength: 40000,
                          placeholder: 'Paste an email, a letter, or your notes from a call.' })}
                <button class="btn btn-primary" type="submit" ${enabled ? '' : raw('disabled')}>
                  Read it
                </button>
                <p class="hint">Sent to the configured provider and recorded here. Nothing is
                   created in the register until you choose to.</p>
              </form>`)}

            ${suggestion ? card('What it found', html`
              <p class="lede-sm">${suggestion.summary}</p>
              <dl class="kv">
                <dt>Urgency</dt><dd>${badge(suggestion.urgency, statusTone(suggestion.urgency))}</dd>
                <dt>Name</dt><dd>${suggestion.contact_name ?? '—'}</dd>
                <dt>Email</dt><dd>${suggestion.contact_email ?? '—'}</dd>
                <dt>Phone</dt><dd>${suggestion.contact_phone ?? '—'}</dd>
                <dt>Nationality</dt><dd>${suggestion.nationality ?? '—'}</dd>
                <dt>Likely matter</dt><dd>${suggestion.suggested_case_type
                  ? labelFor(types, suggestion.suggested_case_type) : '—'}</dd>
                <dt>Suggested title</dt><dd>${suggestion.suggested_title ?? '—'}</dd>
                <dt>Next action</dt><dd>${suggestion.suggested_next_action ?? '—'}</dd>
                <dt>Dates mentioned</dt><dd>${suggestion.key_dates.length ? suggestion.key_dates.join(', ') : '—'}</dd>
                ${suggestion.is_spam ? html`<dt>Note</dt><dd class="warn">Flagged as likely spam.</dd>` : ''}
              </dl>

              <div class="admin-links mt">
                <a class="btn btn-primary" href="${`/inquiries/new?${new URLSearchParams({
                  contact_name: suggestion.contact_name ?? '',
                  contact_email: suggestion.contact_email ?? '',
                  contact_phone: suggestion.contact_phone ?? '',
                  subject: suggestion.suggested_title ?? '',
                }).toString()}`}">Start an inquiry</a>
                <a class="btn btn-secondary" href="${`/clients/new?${new URLSearchParams({
                  given_names: (suggestion.contact_name ?? '').split(' ').slice(0, -1).join(' '),
                  family_name: (suggestion.contact_name ?? '').split(' ').slice(-1).join(''),
                  email: suggestion.contact_email ?? '',
                  phone: suggestion.contact_phone ?? '',
                  nationality: suggestion.nationality ?? '',
                }).toString()}`}">Start a client record</a>
                <a class="btn btn-secondary" href="/knowledge/new">File in the knowledge base</a>
              </div>
              <p class="hint">Each of these opens a form filled in with what was found. Check it
                 before saving — the model reads carefully but it is still reading, not knowing.</p>`) : ''}
          </div>

          <div class="col-side">
            ${card('What this does', html`
              <p class="small">It reads text you give it and pulls out names, contact details,
                 dates and what kind of matter it looks like. It also drafts a brief on any case,
                 from the <strong>Brief me</strong> button on that case.</p>
              <p class="small"><strong>It never writes to the register.</strong> Every suggestion
                 becomes a form you look at and submit. Nothing it offers is a step you could not
                 take by hand, which is why the whole register works with this switched off.</p>
              <p class="small">Every run is recorded — what was asked, what came back, and how long
                 it took — so a suggestion acted on months ago can still be traced.</p>`)}
          </div>
        </div>`);
    });

    r.post('/', requirePermission('ai:run'), async (c) => {
      if (!isAiEnabled(c.env)) {
        return redirectWith(c, '/assistant', 'The AI layer is not switched on.', 'err');
      }
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const body = f.text('body', { required: true, label: 'The text', max: 40000 });
      const subject = f.optional('subject', { max: 200 });
      if (!f.valid) return redirectWith(c, '/assistant', Object.values(f.errors)[0]!, 'err');

      // The run is keyed by an id of its own rather than by a record, because
      // this text does not belong to anything yet — that is the point of it.
      const key = newId('ast');
      const result = await runTriage(c.env, { subject, body },
        { entityType: 'assistant', entityId: key, userId: user.id });

      await auditFrom(c, { action: 'assistant.read', entityType: 'assistant', entityId: key,
        meta: { ok: result.ok, chars: body.length } });

      return result.ok
        ? c.redirect(`/assistant?run=${key}`, 303)
        : redirectWith(c, '/assistant', result.error, 'err');
    });

    app.route('/assistant', r);
  },
};
