/**
 * Nothing typed is lost to a closed tab.
 *
 * Asked for on 10 September 2026 — *"i also want to add automatic saving of
 * details entered - say every 1.5 minute after the change"* — and narrowed the
 * same day to the two behaviours that do not write to the register on their
 * own: *"build both, 1 and 2, do not build 3."*
 *
 * These run the real `public/app.js`, not a copy of it. See
 * `test/support/browser.ts` for what that costs and what it does not prove.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FakeForm, openPage } from './support/browser';

const KEY = 'draft:POST https://register.test/clients/abc';

function clientForm() {
  return new FakeForm({
    action: 'https://register.test/clients/abc',
    attrs: { 'data-draft': '' },
    fields: [
      { name: 'given_names', type: 'text', value: 'Ana' },
      { name: 'family_name', type: 'text', value: 'Silva' },
      { name: 'notes', type: 'textarea', value: '' },
      { name: 'active', type: 'checkbox', checked: true },
    ],
  });
}

describe('a draft is kept while somebody is typing', () => {
  it('writes nothing until something has actually changed', () => {
    const form = clientForm();
    const page = openPage([form]);
    page.elapse();
    expect([...page.storage.keys()]).toEqual([]);
  });

  it('keeps what was typed, under the form’s own address', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'Rang about the medical.');
    page.elapse();

    const draft = JSON.parse(page.storage.get(KEY)!);
    expect(draft.fields).toContainEqual(['notes', 'Rang about the medical.']);
    expect(typeof draft.at).toBe('number');
  });

  it('keeps a tickbox as ticked or not, not as the word "on"', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.tick('active', false);
    page.elapse();
    expect(JSON.parse(page.storage.get(KEY)!).fields).toContainEqual(['active', false]);
  });

  it('does not write a password, a file or a hidden field', () => {
    // A cross-site token is not a draft, and a password written to the disk of
    // whatever machine it was typed on is a fault, not a feature.
    const form = new FakeForm({
      action: 'https://register.test/account',
      attrs: { 'data-draft': '' },
      fields: [
        { name: 'csrf', type: 'hidden', value: 'secret-token' },
        { name: 'password', type: 'password', value: 'hunter2' },
        { name: 'upload', type: 'file', value: 'passport.pdf' },
        { name: 'note', type: 'text', value: '' },
      ],
    });
    const page = openPage([form]);
    form.set('note', 'anything');
    page.elapse();

    const written = page.storage.get('draft:POST https://register.test/account')!;
    expect(written).not.toContain('secret-token');
    expect(written).not.toContain('hunter2');
    expect(written).not.toContain('passport.pdf');
    expect(written).toContain('anything');
  });

  it('is written when the tab is hidden, not only every ninety seconds', () => {
    // Ninety seconds is a long time to lose to a closed tab.
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'half a sentence');
    page.document.visibilityState = 'hidden';
    page.fireOnDocument('visibilitychange');
    expect(page.storage.get(KEY)).toContain('half a sentence');
  });

  it('is written when the page is going away', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'half a sentence');
    page.fireOnWindow('pagehide');
    expect(page.storage.get(KEY)).toContain('half a sentence');
  });

  it('is dropped once the form has been submitted', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'saved for real');
    page.elapse();
    expect(page.storage.has(KEY)).toBe(true);

    form.fire('submit');
    expect(page.storage.has(KEY)).toBe(false);
    page.elapse();
    expect(page.storage.has(KEY)).toBe(false);
  });
});

describe('the draft is offered back, never applied on its own', () => {
  it('offers it, and leaves the page as the register sent it until asked', () => {
    // Somebody else may have saved this record since. Quietly overwriting
    // their work with an old draft is the sort of thing nobody notices until
    // it matters.
    const storage = new Map([[KEY, JSON.stringify({
      at: Date.now() - 60_000, fields: [['given_names', 'Ana'], ['family_name', 'Silva'],
        ['notes', 'What was typed and never saved.'], ['active', true]],
    })]]);
    const form = clientForm();
    const page = openPage([form], { storage });

    expect(form.offer).not.toBeNull();
    expect(form.offer!.text()).toContain('never saved');
    expect(form.elements.find((f) => f.name === 'notes')!.value).toBe('');

    form.button('Put them back').fire('click');
    expect(form.elements.find((f) => f.name === 'notes')!.value)
      .toBe('What was typed and never saved.');
    expect(form.offer).toBeNull();
    expect(page.storage.has(KEY)).toBe(false);
  });

  it('discards it when asked, and does not ask twice', () => {
    const storage = new Map([[KEY, JSON.stringify({
      at: Date.now(), fields: [['given_names', 'Ana'], ['family_name', 'Silva'],
        ['notes', 'no longer wanted'], ['active', true]],
    })]]);
    const form = clientForm();
    const page = openPage([form], { storage });
    form.button('Discard them').fire('click');
    expect(form.offer).toBeNull();
    expect(page.storage.has(KEY)).toBe(false);
    expect(form.elements.find((f) => f.name === 'notes')!.value).toBe('');
  });

  it('says nothing when the draft matches what is already on the page', () => {
    // The record was saved by another route. A bar offering back the values
    // already in front of somebody is noise.
    const storage = new Map([[KEY, JSON.stringify({
      at: Date.now(), fields: [['given_names', 'Ana'], ['family_name', 'Silva'],
        ['notes', ''], ['active', true]],
    })]]);
    const form = clientForm();
    const page = openPage([form], { storage });
    expect(form.offer).toBeNull();
    expect(page.storage.has(KEY)).toBe(false);
  });

  it('forgets a draft older than twelve hours rather than offering it', () => {
    // A draft is part of a client's record sitting on a machine. It is worth
    // keeping for as long as somebody might come back to the tab, and no
    // longer.
    const storage = new Map([[KEY, JSON.stringify({
      at: Date.now() - 13 * 60 * 60 * 1000,
      fields: [['given_names', 'Ana'], ['family_name', 'Silva'],
        ['notes', 'stale'], ['active', true]],
    })]]);
    const form = clientForm();
    const page = openPage([form], { storage });
    expect(form.offer).toBeNull();
    expect(page.storage.has(KEY)).toBe(false);
  });

  it('skips the fields of a draft that no longer match the form', () => {
    // A field was renamed between the draft being written and being offered.
    // Each field is matched by its position *and* its name, so the one that no
    // longer matches is left as the register sent it rather than having a
    // stranger's value poured into it — and the ones that still line up are
    // restored as normal.
    const storage = new Map([[KEY, JSON.stringify({
      at: Date.now(),
      fields: [['given_names', 'Ana'], ['a_field_since_renamed', 'x'],
        ['notes', 'kept'], ['active', true]],
    })]]);
    const form = clientForm();
    openPage([form], { storage });
    form.button('Put them back').fire('click');
    expect(form.elements.find((f) => f.name === 'family_name')!.value).toBe('Silva');
    expect(form.elements.find((f) => f.name === 'notes')!.value).toBe('kept');
  });

  it('does not touch a form that has not asked for drafts', () => {
    const search = new FakeForm({
      action: 'https://register.test/search',
      fields: [{ name: 'q', type: 'search', value: '' }],
    });
    const page = openPage([search]);
    search.set('q', 'Silva');
    page.elapse();
    expect([...page.storage.keys()]).toEqual([]);
    expect(search.offer).toBeNull();
  });
});

describe('leaving with changes not yet saved', () => {
  it('says nothing when nothing has changed', () => {
    const form = clientForm();
    const page = openPage([form]);
    expect(page.fireOnWindow('beforeunload')).toBe(false);
  });

  it('stops the page leaving once something has been typed', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'not saved yet');
    expect(page.fireOnWindow('beforeunload')).toBe(true);
  });

  it('says nothing while the form itself is being submitted', () => {
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'on its way');
    form.fire('submit');
    expect(page.fireOnWindow('beforeunload')).toBe(false);
  });

  it('still warns when a different form on the page is submitted', () => {
    // Adding a tag reloads the client page, and the half-typed record above it
    // goes with it. The warning is correct, and the draft is the safety net.
    const main = clientForm();
    const tags = new FakeForm({
      action: 'https://register.test/clients/abc/tags',
      fields: [{ name: 'tag', type: 'text', value: 'urgent' }],
    });
    const page = openPage([main, tags]);
    main.set('notes', 'half typed');
    tags.fire('submit');
    expect(page.fireOnWindow('beforeunload')).toBe(true);
  });
});

describe('signing out clears every draft', () => {
  it('leaves nothing of a client’s record on the machine', () => {
    // The point of signing out is that it is not there for the next person.
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'something about a client');
    page.elapse();
    expect(page.storage.size).toBe(1);

    const logout = new FakeForm({ action: 'https://register.test/logout', fields: [] });
    page.fireOnDocument('submit', { target: logout });
    expect(page.storage.size).toBe(0);
  });
});

describe('the register still works with the script blocked', () => {
  const js = readFileSync('public/app.js', 'utf8');

  it('gives up quietly when the browser has no storage to write to', () => {
    // Private browsing, or a browser locked down by somebody's employer. The
    // forms must carry on working exactly as they do with this file blocked.
    expect(js).toContain('if (!store) return;');
  });

  it('does not write to the register by itself', () => {
    // The third option was declined, and deliberately: a register that saves
    // without being told to has no moment where a person decided the record
    // was right, and the audit line hangs off that moment.
    const form = clientForm();
    const page = openPage([form]);
    form.set('notes', 'typed but not saved');
    page.elapse();
    page.elapse();
    expect(page.storage.size).toBe(1);   // the browser, and nowhere else
  });
});
