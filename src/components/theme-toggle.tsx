"use client";

import { useAppearance } from "@/components/appearance-provider";
import { ThemeIcon } from "@/components/theme-icons";
import { THEMES, THEME_LABELS, type Theme } from "@/lib/theme";

/**
 * The light/dark control in the nav.
 *
 * One cycling button rather than three side by side: the nav is the wrong place to
 * spend 90px on a segmented control, and the full three-way choice is spelled out in
 * Settings → Appearance. The hover text names the state it will move to, so the cycle
 * does not have to be guessed at — which is the pattern asked for over permanent
 * on-screen explanation.
 */
export function ThemeToggle() {
  const { appearance, commit } = useAppearance();
  const next = THEMES[(THEMES.indexOf(appearance.theme) + 1) % THEMES.length]!;

  return (
    <button
      type="button"
      onClick={() => commit({ theme: next })}
      title={`Appearance: ${THEME_LABELS[appearance.theme].toLowerCase()}. Switch to ${THEME_LABELS[next].toLowerCase()}.`}
      aria-label={`Appearance: ${THEME_LABELS[appearance.theme]}. Switch to ${THEME_LABELS[next]}.`}
      data-theme-choice={appearance.theme}
      className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
    >
      <ThemeIcon theme={appearance.theme} />
    </button>
  );
}

/** The same choice as three explicit options, for the settings page. */
export function ThemePicker() {
  const { appearance, commit } = useAppearance();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700"
    >
      {THEMES.map((theme: Theme) => {
        const active = appearance.theme === theme;
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => commit({ theme })}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition ${
              active
                ? "bg-accent-600 font-medium text-white"
                : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            <ThemeIcon theme={theme} />
            {THEME_LABELS[theme]}
          </button>
        );
      })}
    </div>
  );
}
