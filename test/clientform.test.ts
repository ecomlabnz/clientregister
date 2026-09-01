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

/**
 * Saving a company must not be blocked by a box belonging to a person.
 *
 * `family_name` carried the HTML `required` attribute and lives in the
 * individual half of the form. Choose "Company or organisation" and that half is
 * hidden — leaving the browser with a required field it can neither satisfy nor
 * display. It refuses to submit and reports nothing, so the Create button does
 * nothing at all. Reported from the register with a company that would not save.
 *
 * The rule: **a required field must never sit inside a block that can be
 * hidden.** These tests hold both halves of the fix.
 */
describe('a company can be saved', () => {
  it('marks no field required inside a block that can be hidden', () => {
    // Read the two kind blocks out of the form and check neither carries a
    // required field. This is the rule, not just the one field that broke it.
    for (const kind of ['individual', 'organisation']) {
      const start = form.indexOf(`<div data-kind="${kind}"`);
      expect(start, `no ${kind} block found`).toBeGreaterThan(-1);
      // The block runs to the start of the next top-level data-kind or panel.
      const after = form.slice(start + 20);
      const end = Math.min(
        ...[after.indexOf('<div data-kind='), after.indexOf('data-panel=')]
          .filter((n) => n > -1)
          .concat([after.length]),
      );
      const block = after.slice(0, end);
      expect(block, `a required field inside the ${kind} block`).not.toContain('required: true');
    }
  });

  it('still requires a family name for a person, on the server', () => {
    // Removing the browser's check must not remove the rule. The server is
    // where it was enforced all along.
    expect(form).toContain("f.text('family_name', { required: true, label: 'Family name'");
  });

  it('takes the other kind of record out of validation entirely', () => {
    // Belt and braces for any field added to either half later: a control in
    // the half that does not apply is disabled, so the browser neither
    // validates it nor submits it.
    expect(js).toContain('el.disabled = off;');
  });
});
