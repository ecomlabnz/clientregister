import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHANNEL_SETTINGS } from '../src/modules/inbox';

const source = readFileSync('src/modules/inbox/index.ts', 'utf8');

/**
 * Deleting several messages at once, and where the post now lands.
 *
 * Junk arrives in runs, and clearing it one page at a time was the job the
 * inbox made hardest. What makes deletion safe to offer at all is that the
 * captured copy goes and the audit log — append-only — keeps the record that
 * each message arrived. These tests hold the parts of that which are easy to
 * lose.
 */

describe('everything that arrives waits in the inbox', () => {
  it('does not turn an allow-listed sender’s mail into an inquiry on its own', () => {
    // The practice's decision, 2 September 2026. It was on, and it split the
    // post in two: known senders became inquiries without anybody seeing them,
    // everybody else waited in the inbox, and which one a message went to
    // depended on a list nobody had in mind while reading.
    const setting = CHANNEL_SETTINGS.settings.find((s) => s.key === 'ingest.auto_create_inquiries');
    expect(setting, 'the setting must still exist, so it can be turned back on').toBeTruthy();
    expect(setting!.default).toBe('false');
  });

  it('reads the same default in the pipeline that decides', () => {
    // The pipeline passes its own fallback to getBoolSetting. If that fallback
    // and the setting's default disagree, the register behaves one way and
    // Settings claims another — and the setting row does not exist until
    // somebody saves the page.
    const pipeline = readFileSync('src/ingest/pipeline.ts', 'utf8');
    expect(pipeline).toMatch(/getBoolSetting\(env, 'ingest\.auto_create_inquiries', false\)/);
  });
});

describe('the bulk delete refuses what something else points at', () => {
  it('drops a message that became an inquiry, and one that has been filed', () => {
    // Both filters appear twice — once on the confirmation page and once on the
    // route that deletes — because the second re-reads rather than trusting
    // what the first sent back.
    const guards = source.match(/!m\.inquiry_id && !m\.filed_at/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('re-reads the rows before deleting rather than trusting the form', () => {
    const confirm = source.slice(source.indexOf("r.post('/delete/confirm'"));
    expect(confirm.slice(0, 1400)).toMatch(/gatherForDeletion/);
  });

  it('offers no checkbox on a row it would refuse', () => {
    expect(source).toMatch(/row\.inquiry_id \|\| row\.filed_at/);
  });

  it('audits each message before its row goes', () => {
    const body = source.slice(source.indexOf("r.post('/delete/confirm'"));
    const auditAt = body.indexOf('inbox.deleted');
    const deleteAt = body.indexOf('DELETE FROM ingest_messages');
    expect(auditAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(auditAt, 'the audit row must be written before the message row goes')
      .toBeLessThan(deleteAt);
  });

  it('deletes in chunks, because a selection can exceed what D1 will bind', () => {
    // A page shows up to 200. One statement with 200 bound values is refused,
    // and a write that is silently not chunked leaves the caller believing rows
    // went when the statement never ran.
    expect(source).toMatch(/runByIds\(c\.env\.DB/);
    expect(source).not.toMatch(/DELETE FROM ingest_messages WHERE id IN \(\$\{ids/);
  });

  it('confirms on a page rather than in a dialog', () => {
    // A data-confirm dialog is script, and the register works with scripting
    // off. On a destructive action reaching this many rows, "it silently did
    // not ask" is not an acceptable failure.
    const bulk = source.slice(source.indexOf("r.post('/delete'"), source.indexOf("r.post('/delete/confirm'"));
    expect(bulk).not.toMatch(/data-confirm/);
    expect(bulk).toMatch(/\/inbox\/delete\/confirm/);
  });

  it('caps how many ids one submission can carry', () => {
    expect(source).toMatch(/\.slice\(0, 200\)/);
  });

  it('de-duplicates the ids, so one message is not audited twice', () => {
    expect(source).toMatch(/new Set\(form\.getAll\('id'\)/);
  });
});

describe('the bulk routes are registered, not nested', () => {
  it('declares both, above the routes that would swallow them', () => {
    const bulk = source.indexOf("r.post('/delete'");
    const byId = source.indexOf("r.post('/:id/delete'");
    expect(bulk).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(bulk, 'the bulk route must be declared before the per-message one')
      .toBeLessThan(byId);
  });
});

describe('runByIds, which the bulk delete depends on', () => {
  it('chunks past the bound-value limit and reports rows actually changed', async () => {
    const { runByIds, MAX_BOUND_VALUES } = await import('../src/core/db');
    const seen: number[] = [];
    // A stand-in that refuses too many bindings exactly as D1 does, so the test
    // fails the same way production would rather than passing on a lie.
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (params.length > 100) throw new Error('too many SQL variables');
            seen.push(params.length);
            return { run: async () => ({ meta: { changes: params.length } }) };
          },
        };
      },
    } as unknown as D1Database;

    const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
    const changed = await runByIds(db, ids, (p) => `DELETE FROM t WHERE id IN (${p})`);
    expect(changed).toBe(250);
    expect(seen.length).toBe(Math.ceil(250 / MAX_BOUND_VALUES));
    expect(Math.max(...seen)).toBeLessThanOrEqual(MAX_BOUND_VALUES);
  });

  it('runs nothing, and reports nothing, for an empty list', async () => {
    const { runByIds } = await import('../src/core/db');
    let calls = 0;
    const db = { prepare() { calls++; throw new Error('should not run'); } } as unknown as D1Database;
    expect(await runByIds(db, [], (p) => `DELETE FROM t WHERE id IN (${p})`)).toBe(0);
    expect(calls).toBe(0);
  });
});

describe('a column heading may be markup, and plain text is still escaped', () => {
  it('renders markup passed as Raw', async () => {
    const { table } = await import('../src/ui/components');
    const { raw } = await import('../src/ui/html');
    const { html } = await import('../src/ui/html');
    // A row is needed: an empty table renders its empty state, not its head.
    const out = table([{ label: raw('<span class="sr-only">Select</span>'), width: '4' }],
                      [html`<tr><td>x</td></tr>`]).value;
    expect(out).toContain('<span class="sr-only">Select</span>');
  });

  it('still escapes a plain string, which is how widening a slot loses escaping', async () => {
    const { table } = await import('../src/ui/components');
    const { html } = await import('../src/ui/html');
    const out = table([{ label: '<script>x</script>', width: '4' }],
                      [html`<tr><td>x</td></tr>`]).value;
    expect(out).not.toContain('<script>');
  });
});

describe('a tick box is a tick box at every width', () => {
  it('is not stretched by the rule that makes text fields full-width', async () => {
    // Inputs are full-width by default, which is right for a text field and
    // wrong for a control the browser draws at a fixed size. Measured in
    // Chromium at 360px the inbox's boxes came out 20 by 13. The same rule had
    // already been needed once, for the radio buttons in Appearance — this
    // makes it general rather than waiting for the next control to be squashed.
    const css = readFileSync('public/app.css', 'utf8');
    const rule = css.match(/input\[type="checkbox"\], input\[type="radio"\] \{[^}]*\}/);
    expect(rule, 'checkboxes and radios need an explicit size').toBeTruthy();
    expect(rule![0]).toMatch(/width:\s*\d+px/);
    expect(rule![0]).toMatch(/height:\s*\d+px/);
  });
});
