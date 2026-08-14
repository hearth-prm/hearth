"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { saveAppearance } from "@/lib/actions/theme";
import { applyAppearance, type Appearance } from "@/lib/theme";

interface AppearanceContext {
  appearance: Appearance;
  /** Show a choice without saving it — for dragging a slider. */
  preview: (next: Partial<Appearance>) => void;
  /** Show a choice and remember it. */
  commit: (next: Partial<Appearance>) => void;
  saving: boolean;
  /** Set when the save failed, so a control can admit the choice will not stick. */
  error: string | null;
}

const Ctx = createContext<AppearanceContext | null>(null);

/**
 * Holds the appearance choice for every control that can change it.
 *
 * There are two such controls in different subtrees — the nav toggle and the settings
 * card — and without shared state they drift: change the theme in the nav and the
 * settings card still claims the old value until a reload. So this lives in the root
 * layout, above both.
 *
 * The server has already rendered <html> from the stored row, so this is not the
 * source of truth on first paint; it is the source of truth for changes made since.
 */
export function AppearanceProvider({
  initial,
  children,
}: {
  initial: Appearance;
  children: ReactNode;
}) {
  const [appearance, setAppearance] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Merging from the rendered value rather than inside a state updater. React is free
  // to call an updater more than once, so a save started in there can fire twice.
  const preview = useCallback(
    (next: Partial<Appearance>) => {
      const merged = { ...appearance, ...next };
      applyAppearance(merged);
      setAppearance(merged);
    },
    [appearance],
  );

  const commit = useCallback(
    (next: Partial<Appearance>) => {
      const merged = { ...appearance, ...next };
      applyAppearance(merged);
      setAppearance(merged);
      startSaving(async () => {
        try {
          await saveAppearance(merged);
          setError(null);
        } catch {
          // The change is already on screen, so the honest failure mode is to keep it
          // and say it will not survive a reload — not to snap the page back.
          setError("Could not save that — it will go back on your next reload.");
        }
      });
    },
    [appearance],
  );

  return (
    <Ctx.Provider value={{ appearance, preview, commit, saving, error }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppearance(): AppearanceContext {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useAppearance must be used inside AppearanceProvider");
  return ctx;
}
