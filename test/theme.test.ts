import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  COLOUR_MODES, COLOUR_MODE_LABELS, THEMES, THEME_INFO, colourModeOf, isColourMode, isTheme, themeOf,
} from '../src/ui/theme';

describe('theme allow-list', () => {
  it('accepts only the themes the application defines', () => {
    for (const id of THEMES) expect(isTheme(id)).toBe(true);
    for (const junk of ['', 'Slate', 'dracula', 'slate; drop', null, undefined]) {
      expect(isTheme(junk as string)).toBe(false);
    }
  });

  it('accepts only the colour modes the application defines', () => {
    for (const id of COLOUR_MODES) expect(isColourMode(id)).toBe(true);
    for (const junk of ['', 'Dark', 'auto', null, undefined]) {
      expect(isColourMode(junk as string)).toBe(false);
    }
  });
});

describe('reading a user preference', () => {
  it('falls back to the defaults for a signed-out or unset user', () => {
    expect(themeOf(null)).toBe('slate');
    expect(colourModeOf(null)).toBe('system');
    expect(themeOf({})).toBe('slate');
    expect(colourModeOf({ colour_mode: null })).toBe('system');
  });

  it('never returns a value that came out of the database unrecognised', () => {
    expect(themeOf({ theme: 'whatever-was-injected' })).toBe('slate');
    expect(colourModeOf({ colour_mode: 'whatever-was-injected' })).toBe('system');
  });

  it('returns a stored preference unchanged', () => {
    expect(themeOf({ theme: 'ink' })).toBe('ink');
    expect(colourModeOf({ colour_mode: 'dark' })).toBe('dark');
  });
});

describe('every theme is fully described', () => {
  it('has a name and a description for the picker', () => {
    for (const id of THEMES) {
      expect(THEME_INFO[id].id).toBe(id);
      expect(THEME_INFO[id].name.length).toBeGreaterThan(0);
      expect(THEME_INFO[id].description.length).toBeGreaterThan(0);
    }
    for (const id of COLOUR_MODES) expect(COLOUR_MODE_LABELS[id].length).toBeGreaterThan(0);
  });

  it('declares a light and a dark value for every neutral in the stylesheet', () => {
    const css = readFileSync('public/app.css', 'utf8');
    for (const id of THEMES) {
      const block = css.match(new RegExp(`\\[data-theme="${id}"\\][^{]*\\{([^}]*)\\}`));
      expect(block, `no CSS block for theme ${id}`).not.toBeNull();
      for (const token of ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'accent-text', 'grey', 'grey-bg']) {
        expect(block![1], `${id} is missing --l-${token}`).toContain(`--l-${token}:`);
        expect(block![1], `${id} is missing --d-${token}`).toContain(`--d-${token}:`);
      }
    }
  });
});
