/**
 * Application assembly.
 *
 * Middleware order matters and is deliberate:
 *   1. securityHeaders — sets the response headers and the request id.
 *   2. attachSession   — resolves the cookie into a user, or nobody.
 *   3. csrfProtection  — rejects cross-site state changes; webhooks opt out
 *                        because they authenticate by signature, not by cookie.
 * Then the channel webhooks, then every registered module.
 */

import { Hono } from 'hono';
import type { AppContext } from './types';
import { securityHeaders, csrfProtection } from './core/security';
import { attachSession } from './core/auth';
import { registeredModules } from './registry';
import { setNavItems } from './ui/nav-store';
import { collectNav } from './core/module';
import { handleTelegramWebhook } from './ingest/telegram';
import { handleWhatsAppVerify, handleWhatsAppWebhook } from './ingest/whatsapp';
import { page } from './ui/layout';
import { html } from './ui/html';
import { pageHeader } from './ui/components';
import { audit, clientIp } from './core/audit';

/** Paths that authenticate by signature and must bypass the CSRF cookie check. */
const WEBHOOK_PATHS = ['/api/ingest/telegram', '/api/ingest/whatsapp'];

export function createApp(): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.use('*', securityHeaders);
  app.use('*', attachSession);
  app.use('*', csrfProtection(WEBHOOK_PATHS));

  // --- Liveness -------------------------------------------------------------
  app.get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV, time: new Date().toISOString() }));

  // --- Inbound channel webhooks --------------------------------------------
  app.post('/api/ingest/telegram', handleTelegramWebhook);
  app.get('/api/ingest/whatsapp', handleWhatsAppVerify);
  app.post('/api/ingest/whatsapp', handleWhatsAppWebhook);

  // --- Feature modules ------------------------------------------------------
  for (const mod of registeredModules) {
    mod.register(app);
  }
  // Nav is collected once at startup; the layout filters it per signed-in user.
  setNavItems(collectNav(registeredModules));

  // --- Fallbacks ------------------------------------------------------------
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
    return page(c, { title: 'Not found', status: 404 }, html`
      ${pageHeader('Not found', 'That page does not exist, or you followed a stale link.')}
      <p><a class="btn btn-primary" href="/">Back to today</a></p>`);
  });

  app.onError((err, c) => {
    // Never leak internals to the browser; the detail goes to the log with the
    // request id so it can be correlated.
    const requestId = c.get('requestId');
    console.error('unhandled error', requestId, c.req.method, c.req.path, err);

    // Also record it where an administrator can actually find it. Logs are
    // ephemeral and need a live tail; the audit log is queryable after the
    // fact, which is what you have when a user reports a reference number.
    try {
      c.executionCtx.waitUntil(
        audit(c.env, {
          action: 'app.error',
          actorId: c.get('user')?.id ?? null,
          actorLabel: c.get('user')?.email ?? 'anonymous',
          ip: clientIp(c.req.raw),
          meta: {
            requestId,
            method: c.req.method,
            path: c.req.path,
            message: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : undefined,
          },
        }),
      );
    } catch {
      // No execution context (or the audit write failed): the console line above stands.
    }
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'internal error' }, 500);
    return page(c, { title: 'Something went wrong', status: 500 }, html`
      ${pageHeader('Something went wrong', 'The error has been logged.')}
      <p class="muted small">Reference: <code>${c.get('requestId')}</code></p>
      <p><a class="btn btn-primary" href="/">Back to today</a></p>`);
  });

  return app;
}
