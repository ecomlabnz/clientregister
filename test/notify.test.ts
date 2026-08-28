import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { preferenceByKey } from '../src/core/preferences';

const js = readFileSync('public/app.js', 'utf8');
const css = readFileSync('public/app.css', 'utf8');

/**
 * The arrival alert: a poll, a banner, and a synthesised sound. These tests
 * cover the decisions that were got wrong the first time, not the appearance.
 */
describe('the poller tells "not asked yet" apart from "nothing waiting"', () => {
  it('keeps a separate primed flag', () => {
    // With one variable doing both jobs, an empty inbox looks exactly like a
    // page that has not polled yet — so the first message to arrive sets the
    // mark instead of announcing itself, and is never heard about.
    expect(js).toContain('var primed = false;');
    expect(js).toContain('if (!primed) { primed = true; lastSeen = id; return; }');
  });

  it('says nothing when the queue empties', () => {
    // The top of the queue also changes when somebody triages the last
    // message. That is not an arrival.
    expect(js).toContain('if (!latest) return;');
  });
});

describe('the alert asks for as little as it can', () => {
  it('does not poll at all when the tab is in the background', () => {
    expect(js).toContain('if (document.hidden) return;');
  });

  it('does not poll at all when the person has turned it off', () => {
    expect(js).toContain("body.getAttribute('data-notify') !== '1'");
  });

  it('never polls faster than every fifteen seconds', () => {
    expect(js).toContain('Math.max(15, every) * 1000');
  });
});

describe('sounds are made, not fetched', () => {
  it('synthesises every offered sound', () => {
    // The content policy permits no media at all, so an audio file would be
    // blocked outright. Every name the preference offers must exist here.
    const sound = preferenceByKey('pref.notify_sound')!;
    for (const option of sound.options ?? []) {
      if (option.value === 'none') continue;
      expect(js, option.value).toContain(`${option.value}: { notes:`);
    }
  });
});

describe('a banner can appear in any corner that is offered', () => {
  it('has a rule for each position', () => {
    const position = preferenceByKey('pref.notify_position')!;
    for (const option of position.options ?? []) {
      expect(css, option.value).toContain(`.toasts-${option.value} {`);
    }
  });

  it('holds still for anyone who asked for less motion', () => {
    // The banner only slides in where motion has been asked for; the rule
    // lives inside the query rather than being undone by it.
    const base = css.slice(css.indexOf('.toast {'), css.indexOf('.toast a {'));
    expect(base).not.toContain('animation');
    const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(motion).toContain('.toast { animation:');
  });
});
