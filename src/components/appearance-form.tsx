"use client";

import { useEffect, useState } from "react";
import { useAppearance } from "@/components/appearance-provider";
import { ThemePicker } from "@/components/theme-toggle";
import { Card, CardHeader, helpClass, labelClass } from "@/components/ui";
import {
  accentsMatch,
  COLOR_SCHEMES,
  CUSTOM_SCHEME,
  hueFor,
  type SchemeChoice,
  type Theme,
} from "@/lib/theme";

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
  const active = useActiveMode(appearance.theme);

  // Two accents are the exception, so the control starts as one and splits on request.
  // Held locally rather than derived on every render: the two being equal is what makes
  // them *look* linked, so a purely derived toggle would snap straight back the instant
  // you unlinked and before you had changed anything.
  const [linked, setLinked] = useState(() => accentsMatch(appearance));

  const setBoth = (choice: SchemeChoice, save: boolean) =>
    (save ? commit : preview)({ light: choice, dark: choice });

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
            System follows the light or dark setting of the device you are reading on.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={labelClass}>Accent colour</span>
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <input
                id="linkAccents"
                type="checkbox"
                checked={linked}
                onChange={(e) => {
                  setLinked(e.target.checked);
                  // Re-linking has to pick a winner. The mode you are looking at is the
                  // one you just judged, so that is the one that survives.
                  if (e.target.checked) {
                    setBoth(active === "dark" ? appearance.dark : appearance.light, true);
                  }
                }}
                className="size-4 rounded border-neutral-300 dark:border-neutral-600"
              />
              Same in light and dark
            </label>
          </div>

          {linked ? (
            <SchemePicker
              hueInputId="accentHue"
              value={appearance.light}
              onPreview={(c) => setBoth(c, false)}
              onCommit={(c) => setBoth(c, true)}
            />
          ) : (
            <>
              <SchemePicker
                heading="In light mode"
                showing={active === "light"}
                hueInputId="lightAccentHue"
                value={appearance.light}
                onPreview={(light) => preview({ light })}
                onCommit={(light) => commit({ light })}
              />
              <SchemePicker
                heading="In dark mode"
                showing={active === "dark"}
                hueInputId="darkAccentHue"
                value={appearance.dark}
                onPreview={(dark) => preview({ dark })}
                onCommit={(dark) => commit({ dark })}
              />
            </>
          )}

          {!linked && active ? (
            <p className={helpClass}>
              You are reading in {active} mode, so changes to the other one will not
              show until you switch.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="status" className="text-sm text-rose-700 dark:text-rose-400">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Which mode the reader is actually in.
 *
 * Starts as null and fills in after mount, because under "system" the answer is the
 * browser's and the server has no way to render it — guessing would mean a hydration
 * mismatch. It listens for changes too, so a machine that flips at sunset moves the
 * "showing now" mark without a reload.
 */
function useActiveMode(theme: Theme): "light" | "dark" | null {
  const [systemDark, setSystemDark] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (theme !== "system") return theme;
  if (systemDark === null) return null;
  return systemDark ? "dark" : "light";
}

function SchemePicker({
  heading,
  showing = false,
  hueInputId,
  value,
  onPreview,
  onCommit,
}: {
  heading?: string;
  showing?: boolean;
  hueInputId: string;
  value: SchemeChoice;
  onPreview: (choice: SchemeChoice) => void;
  onCommit: (choice: SchemeChoice) => void;
}) {
  const custom = value.colorScheme === CUSTOM_SCHEME;
  // Seed the custom hue from whatever this mode is showing, so pressing Custom is a way
  // in rather than a colour change of its own.
  const currentHue = hueFor(value);

  return (
    <div>
      {heading ? (
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {heading}
          {showing ? (
            <span className="ml-2 font-normal normal-case tracking-normal text-neutral-400">
              showing now
            </span>
          ) : null}
        </p>
      ) : null}

      <div role="radiogroup" aria-label={heading ?? "Accent colour"} className="flex flex-wrap gap-2">
        {COLOR_SCHEMES.map((scheme) => (
          <Swatch
            key={scheme.id}
            hue={scheme.hue}
            label={scheme.label}
            active={value.colorScheme === scheme.id}
            onSelect={() => onCommit({ colorScheme: scheme.id, accentHue: value.accentHue })}
          />
        ))}
        <Swatch
          hue={currentHue}
          label="Custom"
          active={custom}
          onSelect={() => onCommit({ colorScheme: CUSTOM_SCHEME, accentHue: currentHue })}
        />
      </div>

      {custom ? (
        <div className="mt-3">
          <label htmlFor={hueInputId} className={labelClass}>
            Hue
          </label>
          <div className="mt-1.5 flex items-center gap-3">
            <input
              id={hueInputId}
              type="range"
              min={0}
              max={359}
              value={currentHue}
              // Dragging re-tints on every step but saves only when let go: the
              // alternative is a write per pixel of travel.
              onChange={(e) =>
                onPreview({ colorScheme: CUSTOM_SCHEME, accentHue: Number(e.target.value) })
              }
              onPointerUp={() => onCommit({ colorScheme: CUSTOM_SCHEME, accentHue: currentHue })}
              onKeyUp={() => onCommit({ colorScheme: CUSTOM_SCHEME, accentHue: currentHue })}
              onBlur={() => onCommit({ colorScheme: CUSTOM_SCHEME, accentHue: currentHue })}
              className="hue-track h-2 w-64 max-w-full cursor-pointer appearance-none rounded-full"
            />
            <span className="w-10 text-sm tabular-nums text-neutral-600 dark:text-neutral-400">
              {currentHue}°
            </span>
          </div>
          <p className={helpClass}>
            One number is the whole scheme: the eleven shades Hearth uses are worked out
            from this hue, so they stay evenly matched wherever you put it.
          </p>
        </div>
      ) : null}
    </div>
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
