/**
 * A form that waits behind its button.
 *
 * The task list ended with an always-open "New task" box, which put an empty
 * form between the rows people came to read and the pager. It is now behind a
 * button.
 *
 * The rule worth pinning is not "there is a button" but the two properties
 * that make the button safe to rely on:
 *
 *  - **It opens with no script.** The content policy forbids an inline one, so
 *    a disclosure built on a click handler would be a form nobody could reach.
 *    `<details>` needs none.
 *  - **It starts closed, and the form inside it is whole.** Hiding a form is
 *    only an improvement if the form still works when it is opened.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { tasksModule } from '../src/modules/tasks';
import { revealForm } from '../src/ui/components';
import { html } from '../src/ui/html';

const AT = '2026-09-01T00:00:00Z';
const USER = fakeUser();

function seed(h: any) {
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
}

describe('the component', () => {
  const out = revealForm('New thing', html`<p>the form</p>`).value;

  it('is a native disclosure, so it needs no script', () => {
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
    // Nothing to run, and nothing for the policy to block.
    expect(out).not.toMatch(/\son[a-z]+\s*=/i);
    expect(out).not.toContain('<script');
  });

  it('starts closed', () => {
    // `<details open>` would put us back where we started.
    expect(out).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('gives the summary the button classes, so it reads as one', () => {
    expect(out).toMatch(/<summary class="[^"]*\bbtn\b[^"]*">New thing<\/summary>/);
  });

  it('still contains the form it was given', () => {
    expect(out).toContain('<p>the form</p>');
  });
});

describe('the task list', () => {
  it('keeps the new-task form closed behind the button', async () => {
    const h = mountModule(tasksModule, { user: USER });
    seed(h);
    const body = await (await h.request('/tasks')).text();

    expect(body).toContain('<summary class="btn btn-primary reveal-open">New task</summary>');
    // Present, but not opened for us.
    expect(body).toMatch(/<details class="reveal">/);
    expect(body).not.toMatch(/<details class="reveal"[^>]*\bopen\b/);
  });

  it('keeps the form itself intact inside it', async () => {
    // A hidden form that lost a field is worse than a visible one.
    const h = mountModule(tasksModule, { user: USER });
    seed(h);
    const body = await (await h.request('/tasks')).text();
    const reveal = /<details class="reveal">[\s\S]*?<\/details>/.exec(body)?.[0] ?? '';

    expect(reveal).toContain('action="/tasks"');
    expect(reveal).toContain('name="_csrf"');
    for (const f of ['title', 'due_at', 'priority', 'assigned_to', 'details']) {
      expect(reveal).toContain(`name="${f}"`);
    }
  });

  it('shows no button at all to somebody who may not write', async () => {
    const h = mountModule(tasksModule, { user: fakeUser({ role: 'readonly' }) });
    const body = await (await h.request('/tasks')).text();
    expect(body).not.toContain('New task</summary>');
    expect(body).not.toContain('action="/tasks" class="row-form"');
  });
});
