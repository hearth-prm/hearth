import { sourceUrl, versionDetail, versionStamp } from "@/lib/version";

/**
 * Persistent build stamp.
 *
 * Shown on every page so "which version am I looking at?" never requires shell access, and
 * showing the COMMIT beside the version rather than only on hover — because the version alone
 * does not identify a build. Two installs both reporting v1.2.0 may be running different code,
 * and a bug report has to be able to say which. The build time stays in the title.
 *
 * The copyright line and source link are here for the licence rather than for decoration: the
 * AGPL asks that anyone using the software over a network be offered its source, and that an
 * interactive program display a notice. A footer on every page is the plainest way to do both.
 * HEARTH_SOURCE_URL points the link at a fork, which is what a modified version owes its own
 * users rather than pointing them upstream.
 */
export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
        <span>
          Hearth · © 2026 Taylor Hammerling ·{" "}
          <a
            href={sourceUrl()}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            source
          </a>{" "}
          · AGPL-3.0
        </span>
        <span title={versionDetail()} className="font-mono">
          {versionStamp()}
        </span>
      </div>
    </footer>
  );
}
