import { versionDetail, versionLabel } from "@/lib/version";

/**
 * Persistent build stamp.
 *
 * Shown on every page so "which version am I looking at?" never requires shell
 * access. The full detail — commit and build time — sits in the title attribute
 * to keep the footer quiet while staying one hover away.
 */
export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <span>Hearth</span>
        <span title={versionDetail()} className="font-mono">
          {versionLabel()}
        </span>
      </div>
    </footer>
  );
}
