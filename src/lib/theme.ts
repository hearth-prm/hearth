/**
 * Appearance: light/dark, and the accent colour.
 *
 * Two design decisions worth stating up front.
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

export interface Appearance {
  theme: Theme;
  colorScheme: string;
  accentHue: number;
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

/** The hue actually in force: a named scheme's own, or the custom one. */
export function hueFor(appearance: Appearance): number {
  if (appearance.colorScheme === CUSTOM_SCHEME)
    return normalizeHue(appearance.accentHue);
  const scheme = COLOR_SCHEMES.find((s) => s.id === appearance.colorScheme);
  return scheme ? scheme.hue : DEFAULT_HUE;
}

/**
 * Widen a stored row into an Appearance.
 *
 * The parameter is deliberately loose: the columns are a TEXT and an INTEGER, so what
 * comes out of the database is not an Appearance until it has been through here. Typing
 * this as Partial<Appearance> would assert the very thing it exists to check.
 */
export function normalizeAppearance(
  value:
    | { theme?: unknown; colorScheme?: unknown; accentHue?: unknown }
    | null
    | undefined,
): Appearance {
  return {
    theme: normalizeTheme(value?.theme),
    colorScheme: normalizeScheme(value?.colorScheme),
    accentHue: normalizeHue(value?.accentHue ?? DEFAULT_HUE),
  };
}

/**
 * What to spread onto <html>.
 *
 * The hue is always emitted inline, even for a named scheme, so the stylesheet never
 * has to carry a copy of the hue list that could drift from the one above.
 *
 * `data-theme` is omitted for "system" on purpose: its absence is what lets the
 * prefers-color-scheme half of the `dark:` variant take over.
 */
export function htmlAppearanceProps(appearance: Appearance): {
  "data-theme"?: "light" | "dark";
  "data-scheme": string;
  style: React.CSSProperties;
} {
  const hue = hueFor(appearance);
  return {
    ...(appearance.theme === "system" ? {} : { "data-theme": appearance.theme }),
    // Not read by any rule; it is here so the chosen scheme is visible when
    // inspecting the page, and so a future stylesheet can hook onto it.
    "data-scheme": appearance.colorScheme,
    style: { "--accent-hue": String(hue) } as React.CSSProperties,
  };
}

/**
 * Apply a choice to the live document, ahead of the server round trip.
 *
 * A theme switch that waits for a network hop feels broken, so the control mutates
 * <html> itself and persists in the background. This must set the hue on the same
 * element that declares the ramp: a custom property's own var()s are substituted
 * where it is DECLARED, so an --accent-hue set further down the tree cannot re-tint
 * an --accent-500 inherited from :root.
 */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = appearance.theme;
  root.dataset.scheme = appearance.colorScheme;
  root.style.setProperty("--accent-hue", String(hueFor(appearance)));
}
