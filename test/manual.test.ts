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
    // Both transports, because the choice between them is not about
    // deliverability — it decides whether a copy of what you sent ends up in
    // your own mailbox, and a manual that names only one leaves that invisible.
    expect(help).toContain('Resend');
    expect(help).toContain('gmail.send');
    expect(help).toContain('Replies should go to');
    // Checked by what the feature does rather than by where it lives. The
    // section was called Admin and is now called Settings; pinning the name
    // failed the build once already, and pinning it again would only mean
    // failing it the next time something is renamed.
    expect(help).toMatch(/Integrations[\s\S]{0,300}test message/);
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

describe('what the manual claims about passport numbers', () => {
  /**
   * The manual told the practice its clients' passport numbers were stored
   * encrypted for two days after migration 0042 made that false.
   *
   * A wrong claim about how sensitive data is held is worse than no claim: it
   * is relied on. This pins the correction, and it is written as "the manual
   * must not say the thing that is no longer true" rather than as a phrase
   * match, so a rewrite that reintroduces the claim in other words still has
   * to face the question.
   */
  const manual = readFileSync('src/modules/help/index.ts', 'utf8');
  // Only the guidance sections; release notes are history and stay as written.
  const sections = manual.slice(manual.indexOf('function sections('));

  it('does not claim the number is encrypted or sealed at rest', () => {
    expect(sections).not.toMatch(/passport number is stored encrypted/i);
    expect(sections).not.toMatch(/passport[^.]{0,80}\b(encrypted|sealed)\b/i);
    expect(sections).not.toMatch(/\b(encrypts|encrypted|sealed)\b[^.]{0,80}passport/i);
  });

  it('still says the number stays out of bulk exports, which did not change', () => {
    // The one part of the old arrangement the practice kept.
    expect(sections).toMatch(/Passport numbers are in none of them/);
  });
});
