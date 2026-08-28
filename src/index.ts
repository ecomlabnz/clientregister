/**
 * Worker entry points.
 *
 *   fetch     — the web application.
 *   email     — Cloudflare Email Routing delivers inbound mail here.
 *   scheduled — housekeeping: flush the outbound mail queue, expire stale quotes,
 *                 and keep the knowledge base follow-ups in step with their dates.
 */

import type { Env } from './types';
import { createApp } from './app';
import { handleInboundEmail } from './ingest/email';
import { flushQueue } from './mail/queue';
import { nowIso, run } from './core/db';
import { audit } from './core/audit';
import { syncAllFollowUps } from './core/kb';

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message, env);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(housekeeping(env));
  },
} satisfies ExportedHandler<Env>;

async function housekeeping(env: Env): Promise<void> {
  try {
    const mail = await flushQueue(env);

    // A quote past its validity is no longer on the table; say so rather than
    // leaving it looking live in the pipeline.
    const expired = await run(
      env.DB,
      `UPDATE quotes SET status = 'expired', updated_at = ?
        WHERE status = 'sent' AND valid_until IS NOT NULL AND valid_until < ?`,
      nowIso(), nowIso().slice(0, 10),
    );

    // Reconcile every knowledge base follow-up against its article's dates and
    // the configured lead time. Doing it here rather than only on save is what
    // makes the lead time genuinely editable: change it in settings and the
    // whole knowledge base corrects itself overnight, instead of leaving old
    // tasks on the old timing for anyone to trip over.
    const followUps = await syncAllFollowUps(env);

    await audit(env, {
      action: 'cron.housekeeping',
      actorLabel: 'system',
      meta: { mail, quotesExpired: expired.meta?.changes ?? 0, followUps },
    });
  } catch (err) {
    console.error('scheduled housekeeping failed', err);
  }
}
