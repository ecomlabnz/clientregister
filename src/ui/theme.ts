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
