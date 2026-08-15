/**
 * Appearance: light/dark, and an accent colour for each.
 *
 * Three design decisions worth stating up front.
 *
 * Light/dark is three-valued, not a boolean. "Follow my machine" is a real preference
 * and has to be distinguishable from "I chose light", or someone who picks light on a
 * dark-set machine gets silently overridden by their OS every morning.
 *
 * A colour scheme is ONE NUMBER — a hue in degrees. Every accent step is derived from
 * it in oklch (see globals.css), which keeps the eleven steps looking evenly spaced at
 * any hue. That is what makes "invent your own scheme" free: it needs no palette table
 * and no new CSS, only an integer. The consequence is that this file, not the
 * stylesheet, is the source of truth for what the named schemes are — the CSS knows
 * only how to build a ramp from whatever hue it is handed.
 *
 * The accent is stored PER MODE, because a hue that carries well on white is often
 * muddy on near-black and the reverse. Which of the two applies cannot be settled here:
 * under "System" only the browser knows which mode is showing. So the server hands over
 * both hues and a CSS rule picks between them, and nothing in this file resolves the
 * accent down to a single number for the page.
 */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** Marker scheme id meaning "use accentHue". */
export const CUSTOM_SCHEME = "custom";

export interface ColorScheme {
  id: string;
  label: string;
  hue: number;
}

export const COLOR_SCHEMES: readonly ColorScheme[] = [
  { id: "teal", label: "Teal", hue: 184 },
  { id: "emerald", label: "Emerald", hue: 158 },
  { id: "sky", label: "Sky", hue: 235 },
  { id: "indigo", label: "Indigo", hue: 276 },
  { id: "violet", label: "Violet", hue: 302 },
  { id: "rose", label: "Rose", hue: 14 },
  { id: "amber", label: "Amber", hue: 74 },
];

export const DEFAULT_SCHEME = "teal";
export const DEFAULT_HUE = 184;

/** One mode's accent: a named scheme, or "custom" together with the hue to use. */
export interface SchemeChoice {
  colorScheme: string;
  accentHue: number;
}

export interface Appearance {
  theme: Theme;
  light: SchemeChoice;
  dark: SchemeChoice;
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : "system";
}

export function normalizeScheme(value: unknown): string {
  if (value === CUSTOM_SCHEME) return CUSTOM_SCHEME;
  return COLOR_SCHEMES.some((s) => s.id === value) ? (value as string) : DEFAULT_SCHEME;
}

/**
 * Hue is circular, so an out-of-range number is meaningful rather than invalid: 380
 * degrees is 20 degrees. Only genuine non-numbers fall back.
 */
export function normalizeHue(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_HUE;
  return ((Math.round(n) % 360) + 360) % 360;
}

export function normalizeChoice(value: {
  colorScheme?: unknown;
  accentHue?: unknown;
}): SchemeChoice {
  return {
    colorScheme: normalizeScheme(value.colorScheme),
    accentHue: normalizeHue(value.accentHue ?? DEFAULT_HUE),
  };
}

/** The hue one mode actually uses: its named scheme's own, or its custom one. */
export function hueFor(choice: SchemeChoice): number {
  if (choice.colorScheme === CUSTOM_SCHEME) return normalizeHue(choice.accentHue);
  const scheme = COLOR_SCHEMES.find((s) => s.id === choice.colorScheme);
  return scheme ? scheme.hue : DEFAULT_HUE;
}

/**
 * True when both modes would paint the same accent.
 *
 * Inferred rather than stored: "keep these two the same" is a fact about the values,
 * and a column recording it separately is a column that can disagree with them.
 */
export function accentsMatch(appearance: Appearance): boolean {
  return (
    appearance.light.colorScheme === appearance.dark.colorScheme &&
    hueFor(appearance.light) === hueFor(appearance.dark)
  );
}

/**
 * Widen a stored row into an Appearance.
 *
 * The parameter is deliberately loose: the columns are TEXT and INTEGER, so what comes
 * out of the database is not an Appearance until it has been through here. Typing this
 * as Partial<Appearance> would assert the very thing it exists to check.
 */
export function normalizeAppearance(
  value:
    | {
        theme?: unknown;
        lightColorScheme?: unknown;
        lightAccentHue?: unknown;
        darkColorScheme?: unknown;
        darkAccentHue?: unknown;
      }
    | null
    | undefined,
): Appearance {
  return {
    theme: normalizeTheme(value?.theme),
    light: normalizeChoice({
      colorScheme: value?.lightColorScheme,
      accentHue: value?.lightAccentHue,
    }),
    dark: normalizeChoice({
      colorScheme: value?.darkColorScheme,
      accentHue: value?.darkAccentHue,
    }),
  };
}

/**
 * What to spread onto <html>.
 *
 * BOTH hues are handed over and neither is called --accent-hue: a stylesheet rule
 * assigns that from one of these according to the mode in force. Resolving it here
 * would mean guessing under "System", where the answer belongs to the browser.
 *
 * The hue is emitted inline even for a named scheme, so the stylesheet never carries a
 * copy of the hue list that could drift from the one above.
 *
 * `data-theme` is omitted for "system" on purpose: its absence is what lets the
 * prefers-color-scheme half of the `dark:` variant take over.
 */
export function htmlAppearanceProps(appearance: Appearance): {
  "data-theme"?: "light" | "dark";
  "data-scheme": string;
  style: React.CSSProperties;
} {
  return {
    ...(appearance.theme === "system" ? {} : { "data-theme": appearance.theme }),
    // Read by no rule; it is here so a chosen scheme is visible when inspecting the
    // page. It names the light one, since the two are usually the same.
    "data-scheme": appearance.light.colorScheme,
    style: {
      "--accent-hue-light": String(hueFor(appearance.light)),
      "--accent-hue-dark": String(hueFor(appearance.dark)),
    } as React.CSSProperties,
  };
}

/**
 * Apply a choice to the live document, ahead of the server round trip.
 *
 * A theme switch that waits for a network hop feels broken, so the control mutates
 * <html> itself and persists in the background. This must write to documentElement: a
 * custom property's own var()s are substituted where it is DECLARED, so an
 * --accent-hue-light set further down the tree cannot re-tint an --accent-500 that was
 * inherited from :root already resolved.
 *
 * It deliberately does not set --accent-hue. That one is assigned by a stylesheet rule
 * which knows the mode, and an inline value would outrank it.
 */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = appearance.theme;
  root.dataset.scheme = appearance.light.colorScheme;
  root.style.setProperty("--accent-hue-light", String(hueFor(appearance.light)));
  root.style.setProperty("--accent-hue-dark", String(hueFor(appearance.dark)));
}
