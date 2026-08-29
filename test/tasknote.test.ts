import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tasks = readFileSync('src/modules/tasks/index.ts', 'utf8');
const prefs = readFileSync('src/core/preferences.ts', 'utf8');
const migration = readFileSync('migrations/0025_task_completion_note.sql', 'utf8');

/**
 * A task history of "done, done, done" answers nothing six months later. These
 * pin the shape of the answer, which is as much about what it does *not* do:
 * it never blocks the completion, and it never requires a note.
 */
describe('what was done, not just that it was done', () => {
  it('completes the task before asking anything', () => {
    // The row is written and the audit entry made, and only then is the note
    // asked for. Nothing is held up by somebody who has nothing to say, and a
    // person who closes the tab has still marked it done.
    const statusRoute = tasks.slice(tasks.indexOf("r.post('/:id/status'"), tasks.indexOf("r.get('/:id/note'"));
    const update = statusRoute.indexOf('UPDATE tasks SET status');
    const audit = statusRoute.indexOf("action: 'task.status_changed'");
    const prompt = statusRoute.indexOf('/note?return_to=');
    expect(update).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(update);
    expect(prompt, 'the note must be asked for after the task is already done')
      .toBeGreaterThan(audit);
  });

  it('never requires a note', () => {
    // Some tasks genuinely need none. Forcing one produces notes that say
    // "done", which is the thing this exists to stop.
    expect(migration).toContain('ALTER TABLE tasks ADD COLUMN completion_note TEXT;');
    expect(migration).not.toMatch(/NOT NULL/);
    expect(tasks).toContain("if (!note) return redirectWith(c, back, 'Task marked done.');");
  });

  it('is a page rather than a dialog', () => {
    // A dialog needs scripting to exist at all, and this register works with
    // scripting off. It is also a box people learn to dismiss.
    expect(tasks).toContain("r.get('/:id/note'");
    expect(tasks).not.toMatch(/<dialog|showModal/);
  });

  it('can be turned off, and the note still added later', () => {
    expect(prefs).toContain("key: 'pref.task_note_prompt'");
    expect(tasks).toContain("asPrefBoolean(prefs['pref.task_note_prompt'], true)");
    expect(tasks).toContain("name: 'completion_note'");
  });

  it('appends to the file rather than rewriting it', () => {
    // The timeline records what was said at the time. A second thought is a
    // second line, never a rewrite of the first — which is the append-only
    // rule the audit log and file notes already live under.
    const noteWrites = [...tasks.matchAll(/kind: 'note',\s*\n\s*body: `\$\{[a-zA-Z.]+\} — \$\{[a-zA-Z]+\}`/g)];
    expect(noteWrites.length, 'both the prompt and a later edit append a note entry').toBe(2);
    expect(tasks).not.toMatch(/UPDATE entries/);
  });

  it('does not send the note back to a foreign address', () => {
    // return_to comes from the query string, so it goes through the same
    // guard every other return address does.
    expect(tasks).toContain("const back = safeReturn(c.req.query('return_to'));");
  });
});
