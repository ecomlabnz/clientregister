/**
 * Themes.
 *
 * Three palettes, each with a light and a dark rendering, plus a mode that
 * either picks one or follows the operating system.
 *
 * They follow what a restrained interface actually does: one accent colour and
 * neutrals for everything else; no pure black, because it makes edges vibrate
 * and elements hard to separate; and semantic colours — green for healthy, red
 * for broken — held constant across all three, because those carry meaning and
 * must not become decoration.
 *
 * The whole mechanism is two attributes on the root element, rendered by the
 * server. There is no theme JavaScript, nothing to load, and no flash of the
 * wrong colours before a script runs.
 */

export const THEMES = ['slate', 'warm', 'ink', 'blossom', 'lagoon', 'aurora'] as const;
export type Theme = (typeof THEMES)[number];

export const COLOUR_MODES = ['system', 'light', 'dark'] as const;
export type ColourMode = (typeof COLOUR_MODES)[number];

export interface ThemeInfo {
  id: Theme;
  name: string;
  description: string;
}

export const THEME_INFO: Record<Theme, ThemeInfo> = {
  slate: {
    id: 'slate',
    name: 'Slate',
    description: 'Cool neutral greys with a deep blue accent. Quiet and precise — the default.',
  },
  warm: {
    id: 'warm',
    name: 'Warm',
    description: 'Paper-toned neutrals with a muted terracotta accent. Softer on the eye over a long day.',
  },
  ink: {
    id: 'ink',
    name: 'Ink',
    description: 'Deep blue-charcoal with a teal accent. The strongest contrast of the quiet three.',
  },
  blossom: {
    id: 'blossom',
    name: 'Blossom',
    description: 'Warm pinks with a vivid magenta. Cheerful, and not remotely corporate.',
  },
  lagoon: {
    id: 'lagoon',
    name: 'Lagoon',
    description: 'Bright mint and sea green with a strong teal. Fresh and wide awake.',
  },
  aurora: {
    id: 'aurora',
    name: 'Aurora',
    description: 'Electric violet on soft lilac. The boldest of the six.',
  },
};

export const COLOUR_MODE_LABELS: Record<ColourMode, string> = {
  system: 'Follow my device',
  light: 'Always light',
  dark: 'Always dark',
};

export function isTheme(value: string | null | undefined): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function isColourMode(value: string | null | undefined): value is ColourMode {
  return typeof value === 'string' && (COLOUR_MODES as readonly string[]).includes(value);
}

export function themeOf(user: { theme?: string | null } | null): Theme {
  return isTheme(user?.theme) ? user.theme : 'slate';
}

export function colourModeOf(user: { colour_mode?: string | null } | null): ColourMode {
  return isColourMode(user?.colour_mode) ? user.colour_mode : 'system';
}

/**
 * Typefaces.
 *
 * **Asked for on 12 September 2026**, after a nine-column table would not fit:
 * *"the body-font change - please build it, with 3-4 options of various narrow
 * font types if available so the user can select."*
 *
 * ## Why every one of these is a font the reader already has
 *
 * The content policy is `default-src 'none'`, and there is no `font-src` in
 * it — this register downloads nothing, ever. That is not an obstacle here, it
 * is the reason this works at all: a chosen face applies on the very next page
 * with no request, no wait, no flash of the wrong type, and nothing about the
 * reader leaving the building.
 *
 * The cost is honesty about availability. **A stack is a list of hopes**, and
 * the last hope in each of these is the system's own interface font, so a
 * reader on a machine that has none of the named faces sees exactly what they
 * see today rather than something worse. `Narrow` is the one worth trusting:
 * Arial Narrow is on virtually every Mac and Windows machine, and the two
 * Linux substitutes below are the standard metric-compatible pair.
 *
 * ## Why a choice and not a setting for the whole practice
 *
 * It follows the theme it sits beside: this is about one person's eyes and one
 * person's screen. A partner on a 27-inch monitor and somebody on a laptop in
 * a waiting room want different answers, and neither is the practice's to
 * decide.
 */
export const FONTS = ['system', 'compact', 'narrow', 'reading'] as const;
export type FontChoice = (typeof FONTS)[number];

export interface FontInfo {
  id: FontChoice;
  name: string;
  description: string;
}

export const FONT_INFO: Record<FontChoice, FontInfo> = {
  system: {
    id: 'system',
    name: 'System',
    description: 'Whatever your device uses for its own menus. The most familiar, and the default.',
  },
  compact: {
    id: 'compact',
    name: 'Compact',
    description: 'A little narrower than the system face, without looking squeezed. A good first try.',
  },
  narrow: {
    id: 'narrow',
    name: 'Narrow',
    description: 'Properly condensed. Fits noticeably more in a column — best where tables are tight.',
  },
  reading: {
    id: 'reading',
    name: 'Reading',
    description: 'A serif face, wider rather than narrower. Easier on the eye over a long document.',
  },
};

export function isFont(value: string | null | undefined): value is FontChoice {
  return typeof value === 'string' && (FONTS as readonly string[]).includes(value);
}

export function fontOf(user: { font?: string | null } | null): FontChoice {
  return isFont(user?.font) ? user.font : 'system';
}
