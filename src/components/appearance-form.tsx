"use client";

import { useAppearance } from "@/components/appearance-provider";
import { ThemePicker } from "@/components/theme-toggle";
import { Card, CardHeader, helpClass, labelClass } from "@/components/ui";
import { COLOR_SCHEMES, CUSTOM_SCHEME, hueFor } from "@/lib/theme";

/**
 * Settings → Appearance.
 *
 * There is no Save button, on purpose. The whole page is already the preview — every
 * accent-coloured thing on it re-tints the moment a swatch is pressed — so asking for
 * a second confirming click would only delay the feedback that makes the choice
 * obvious. That is also why this is its own card rather than a section of the big
 * settings form, which does need a Save.
 */
export function AppearanceForm() {
  const { appearance, preview, commit, error } = useAppearance();
  const custom = appearance.colorScheme === CUSTOM_SCHEME;
  // Seed the custom hue from whatever is on screen, so pressing Custom is a way in
  // rather than a colour change of its own.
  const currentHue = hueFor(appearance);

  return (
    <Card>
      <CardHeader
        title="Appearance"
        description="Applies immediately, and only for you — everyone signed in to this Hearth chooses their own."
      />
      <div className="space-y-5 px-5 py-5">
        <div>
          <span className={labelClass}>Light or dark</span>
          <div className="mt-1.5">
            <ThemePicker />
          </div>
          <p className={helpClass}>
            System follows the light or dark setting of the device you are
            reading on.
          </p>
        </div>

        <div>
          <span className={labelClass}>Accent colour</span>
          <div
            role="radiogroup"
            aria-label="Accent colour"
            className="mt-1.5 flex flex-wrap gap-2"
          >
            {COLOR_SCHEMES.map((scheme) => (
              <Swatch
                key={scheme.id}
                hue={scheme.hue}
                label={scheme.label}
                active={appearance.colorScheme === scheme.id}
                onSelect={() => commit({ colorScheme: scheme.id })}
              />
            ))}
            <Swatch
              hue={currentHue}
              label="Custom"
              active={custom}
              onSelect={() =>
                commit({ colorScheme: CUSTOM_SCHEME, accentHue: currentHue })
              }
            />
          </div>
        </div>

        {custom ? (
          <div>
            <label htmlFor="accentHue" className={labelClass}>
              Hue
            </label>
            <div className="mt-1.5 flex items-center gap-3">
              <input
                id="accentHue"
                type="range"
                min={0}
                max={359}
                value={currentHue}
                // Dragging re-tints on every step but saves only when let go: the
                // alternative is a write per pixel of travel.
                onChange={(e) =>
                  preview({
                    colorScheme: CUSTOM_SCHEME,
                    accentHue: Number(e.target.value),
                  })
                }
                onPointerUp={() => commit({ accentHue: currentHue })}
                onKeyUp={() => commit({ accentHue: currentHue })}
                onBlur={() => commit({ accentHue: currentHue })}
                className="hue-track h-2 w-64 max-w-full cursor-pointer appearance-none rounded-full"
              />
              <span className="w-10 text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
                {currentHue}°
              </span>
            </div>
            <p className={helpClass}>
              One number is the whole scheme: the eleven shades Hearth uses are
              worked out from this hue, so they stay evenly matched wherever you
              put it.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="status" className="text-sm text-rose-700 dark:text-rose-400">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Swatch({
  hue,
  label,
  active,
  onSelect,
}: {
  hue: number;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      title={label}
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition ${
        active
          ? "border-accent-500 font-medium text-neutral-900 ring-2 ring-accent-500/30 dark:text-neutral-100"
          : "border-neutral-300 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      <span
        aria-hidden
        className="hue-swatch size-4 shrink-0 rounded-full"
        style={{ "--accent-hue": String(hue) } as React.CSSProperties}
      />
      {label}
    </button>
  );
}
