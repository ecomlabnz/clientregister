import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const js = readFileSync('public/app.js', 'utf8');
const form = readFileSync('src/modules/clients/index.ts', 'utf8');

/**
 * A company has no passport and a person has no NZBN. The half of the client
 * form that belongs to the other kind of record should never be on the page.
 */
describe('the wrong half of the client form is never shown', () => {
  it('is marked hidden by the server, not only by the script', () => {
    // With scripting off the script hides nothing, and the company boxes were
    // sitting under an individual's name.
    expect(form).toContain(`<div data-kind="individual" \${kind === 'individual' ? '' : raw('hidden')}>`);
    expect(form).toContain(`<div data-kind="organisation" \${kind === 'organisation' ? '' : raw('hidden')}>`);
  });

  it('hides the identity and immigration sections for an organisation', () => {
    const identity = form.slice(form.indexOf('data-panel="identity"'));
    expect(identity.slice(0, 120)).toContain("kind === 'individual' ? '' : raw('hidden')");
  });
});

describe('a tab that opens nothing is not offered', () => {
  it('hides the button when its panel belongs to the other kind', () => {
    // Otherwise clicking Identity as an organisation un-hid a section full of
    // passport fields, because the tab handler only knew about tabs.
    expect(js).toContain('button.hidden = Boolean(panel) && !applies(panel);');
  });

  it('moves off a tab that has just become irrelevant', () => {
    // Switching to Organisation while Identity is open would otherwise leave
    // the form apparently empty.
    expect(js).toContain('if (!open || !applies(open))');
  });

  it('re-renders when the record type changes', () => {
    expect(js).toContain("if (kindSelect) kindSelect.addEventListener('change', render);");
  });

  it('opens the tab holding a field that failed validation', () => {
    expect(js).toContain("form.addEventListener('invalid'");
  });
});
