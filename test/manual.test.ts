import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const help = readFileSync('src/modules/help/index.ts', 'utf8');
const registry = readFileSync('src/registry.ts', 'utf8');

/**
 * The manual is part of the product, not a courtesy. These check that it keeps
 * up — three sections were built and shipped without one, and a rename left
 * the old name in three places.
 */
describe('the manual keeps up with the application', () => {
  const ids = [...help.matchAll(/^ {6}id: '([a-z-]+)',/gm)].map((m) => m[1]!);

  it('has a section for every substantial feature', () => {
    for (const id of ['clients', 'cases', 'certificates', 'decisions', 'fees', 'quotes',
                      'invoices', 'export', 'automations', 'conversations', 'intake',
                      'knowledge', 'notes', 'tasks', 'alerts', 'admin', 'connecting']) {
      expect(ids, id).toContain(id);
    }
  });

  it('gives every section a distinct id, since the id is its anchor', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('calls the first screen by its current name', () => {
    // It was renamed from Today, and three references were left behind.
    expect(help).not.toContain('<strong>Today</strong>');
  });

  it('documents each way of sending mail out', () => {
    expect(help).toContain('Resend');
    expect(help).toContain('Replies should go to');
    expect(help).toContain('Send a test message to myself');
  });

  it('names a module for every registered feature that has a page', () => {
    // A feature in the registry with nothing in the manual is a feature nobody
    // outside this repository knows how to use.
    const registered = [...registry.matchAll(/^ {2}([a-z]+)Module,$/gm)].map((m) => m[1]!);
    const documented = new Set(ids);
    const undocumented = registered.filter((name) => !documented.has(name)
      // These have no manual section of their own by design: the landing page
      // is documented under "website", auth under "account", the dashboard
      // under "getting-around", search likewise, and help is this page.
      && !['landing', 'auth', 'dashboard', 'help', 'documents', 'workflows', 'inbox'].includes(name));
    expect(undocumented, `no manual section: ${undocumented.join(', ')}`).toEqual([]);
  });
});
