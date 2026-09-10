/**
 * Enough of a browser to run `public/app.js` for real.
 *
 * The other tests of that file read it as text and assert that a line is in
 * it, which proves the line was typed and nothing else. The drafts feature is
 * a state machine — it writes, expires, offers, restores and forgets — and a
 * text assertion would pass while every one of those was wrong.
 *
 * So: the real file, evaluated with `window`, `document` and `Date` bound to
 * the smallest objects that can stand in for the parts of a browser it
 * touches. No dependency is added for this — the register keeps four
 * development dependencies and it is worth keeping the number small — and no
 * global is replaced, so the rest of the suite is unaffected.
 *
 * **What this does not prove.** Nothing about layout, painting, or how a real
 * browser fires `pagehide`. It proves the logic. Anything about appearance
 * belongs in a browser.
 */

import { readFileSync } from 'node:fs';

type Listener = (event: any) => void;

export interface FakeField {
  name: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  options?: Array<{ value: string; selected: boolean }>;
}

/** A node with just enough of the DOM to be built, filled and removed. */
class FakeNode {
  tagName: string;
  className = '';
  type = '';
  textContent = '';
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  listeners: Record<string, Listener[]> = {};
  hidden = false;

  constructor(tagName: string) { this.tagName = tagName.toUpperCase(); }

  appendChild(child: FakeNode) { child.parent = this; this.children.push(child); return child; }
  insertBefore(child: FakeNode, _before: FakeNode | null) {
    child.parent = this; this.children.unshift(child); return child;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(name: string, fn: Listener) {
    (this.listeners[name] ||= []).push(fn);
  }
  fire(name: string, event: any = {}) {
    (this.listeners[name] || []).forEach((fn) => fn({ target: this, ...event }));
  }
  /** Everything under here, flattened, for a test to look through. */
  descendants(): FakeNode[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].join(' ').trim();
  }
}

export class FakeForm extends FakeNode {
  method: string;
  action: string;
  elements: FakeField[];
  private attrs: Record<string, string>;

  constructor(opts: { action: string; method?: string; fields: FakeField[]; attrs?: Record<string, string> }) {
    super('form');
    this.method = opts.method ?? 'post';
    this.action = opts.action;
    this.elements = opts.fields;
    this.attrs = opts.attrs ?? {};
  }

  get firstChild() { return this.children[0] ?? null; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  querySelector() { return null; }

  /** What the person types. */
  set(name: string, value: string) {
    const field = this.elements.find((f) => f.name === name);
    if (!field) throw new Error(`no field named ${name}`);
    field.value = value;
    this.fire('input');
  }
  tick(name: string, checked: boolean) {
    const field = this.elements.find((f) => f.name === name);
    if (!field) throw new Error(`no field named ${name}`);
    field.checked = checked;
    this.fire('change');
  }
  get offer(): FakeNode | null {
    return this.children.find((c) => c.className === 'draft-offer') ?? null;
  }
  button(label: string): FakeNode {
    const found = (this.offer?.descendants() ?? []).find((n) => n.textContent === label);
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
  }
}

export interface Browser {
  storage: Map<string, string>;
  document: any;
  window: any;
  /** Run every pending interval once, as if the wait had elapsed. */
  elapse(): void;
  fireOnWindow(name: string, event?: any): boolean;
  fireOnDocument(name: string, event?: any): void;
}

/**
 * Evaluate `public/app.js` against a page holding these forms.
 *
 * `now` is a clock the test moves, so a draft can be aged twelve hours
 * without waiting twelve hours.
 */
export function openPage(
  forms: FakeForm[],
  opts: { storage?: Map<string, string>; now?: () => number } = {},
): Browser {
  const storage = opts.storage ?? new Map<string, string>();
  const now = opts.now ?? (() => Date.now());

  const localStorage = {
    getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
    setItem: (k: string, v: string) => { storage.set(k, String(v)); },
    removeItem: (k: string) => { storage.delete(k); },
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() { return storage.size; },
  };

  const documentListeners: Record<string, Listener[]> = {};
  const windowListeners: Record<string, Listener[]> = {};
  const intervals: Array<() => void> = [];

  const document: any = {
    visibilityState: 'visible',
    // Sections of the file that are not under test read attributes off the
    // body and stop when they are absent. This is what "absent" looks like.
    body: { getAttribute: () => null, appendChild: () => {}, classList: { add() {}, remove() {} } },
    activeElement: null,
    addEventListener: (name: string, fn: Listener) => { (documentListeners[name] ||= []).push(fn); },
    querySelectorAll: (selector: string) =>
      (selector === 'form[data-draft]' ? forms.filter((f) => f.hasAttribute('data-draft')) : []),
    querySelector: () => null,
    createElement: (tag: string) => new FakeNode(tag),
  };

  const window: any = {
    localStorage,
    addEventListener: (name: string, fn: Listener) => { (windowListeners[name] ||= []).push(fn); },
    setInterval: (fn: () => void) => { intervals.push(fn); return intervals.length; },
    clearInterval: (id: number) => { if (id) intervals[id - 1] = () => {}; },
    setTimeout: (fn: () => void) => { fn(); return 0; },
    confirm: () => true,
    print: () => {},
  };

  // A clock the test can move, so a draft can be aged twelve hours without
  // waiting twelve hours.
  const RealDate = Date;
  const FakeDate: any = function (this: unknown, ...args: unknown[]) {
    return args.length ? new (RealDate as any)(...args) : new RealDate(now());
  };
  FakeDate.now = () => now();

  // The file is evaluated with these names in scope, so `window`, `document`
  // and `Date` inside it are ours. No `vm`, no dependency, no globals touched.
  const run = new Function('window', 'document', 'HTMLFormElement', 'Date',
    readFileSync('public/app.js', 'utf8'));
  run(window, document, FakeForm, FakeDate);

  return {
    storage,
    document,
    window,
    elapse: () => intervals.slice().forEach((fn) => fn()),
    fireOnWindow: (name: string, event: any = {}) => {
      let prevented = false;
      const e = { preventDefault: () => { prevented = true; }, returnValue: undefined, ...event };
      (windowListeners[name] || []).forEach((fn) => fn(e));
      return prevented;
    },
    fireOnDocument: (name: string, event: any = {}) => {
      (documentListeners[name] || []).forEach((fn) => fn(event));
    },
  };
}
