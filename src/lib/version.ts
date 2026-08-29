/**
 * Build identity.
 *
 * These three values are inlined at build time by next.config.ts, so they
 * describe the build that is actually running rather than whatever the working
 * tree happens to say. That distinction is the whole point: for a self-hosted
 * install, the useful question is "what is deployed on my server?", which a
 * version number living only in package.json cannot answer.
 *
 * - version — from package.json, bumped by `npm version`
 * - commit  — short git SHA, so an unreleased build is still identifiable
 * - builtAt — ISO timestamp of the build
 */

export const APP_VERSION = process.env.APP_VERSION || "0.0.0";
export const GIT_SHA = process.env.GIT_SHA || "unknown";
export const BUILD_TIME = process.env.BUILD_TIME || "";

export interface BuildInfo {
  version: string;
  commit: string;
  builtAt: string | null;
}

export function buildInfo(): BuildInfo {
  return {
    version: APP_VERSION,
    commit: GIT_SHA,
    builtAt: BUILD_TIME || null,
  };
}

/** "v0.1.0" — the short form for the UI. */
export function versionLabel(): string {
  return `v${APP_VERSION}`;
}

/** "v0.1.0 · c5f4a75 · built 7 Aug 2026" — the full form, for tooltips. */
export function versionDetail(): string {
  const parts = [versionLabel()];
  if (GIT_SHA !== "unknown") parts.push(GIT_SHA);
  if (BUILD_TIME) {
    const built = new Date(BUILD_TIME);
    if (!Number.isNaN(built.getTime())) {
      parts.push(
        `built ${new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(built)} UTC`,
      );
    }
  }
  return parts.join(" · ");
}

/**
 * Where to get the source of the running version.
 *
 * The AGPL asks that anyone interacting with the software over a network be offered its
 * Corresponding Source, and that a MODIFIED version offer ITS source rather than the
 * original's. So this is a setting: an operator running an unmodified Hearth gets the upstream
 * repository for free, and one running a fork points it at their fork and is compliant without
 * touching the code — which is precisely the case the licence is written about.
 */
const UPSTREAM_SOURCE = "https://gitlab.com/hammerling/hearth";

export function sourceUrl(): string {
  const configured = (process.env.HEARTH_SOURCE_URL ?? "").trim();
  return configured || UPSTREAM_SOURCE;
}
