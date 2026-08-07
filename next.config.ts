import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const pkg = JSON.parse(
  readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as { version: string };

/**
 * Short git SHA of the build.
 *
 * Prefers the GIT_SHA build argument, because .dockerignore excludes .git — so
 * inside the image there is no repository to ask. Falls back to querying git for
 * local builds, and to "unknown" when neither is available (e.g. a tarball
 * build), which is honest rather than misleading.
 */
function resolveGitSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.trim();
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal node_modules — keeps the runtime
  // image small and lets us run `node server.js` without the full dep tree.
  output: "standalone",

  // Inlined at build time so the running app can report which build it is,
  // without reading any files at runtime.
  env: {
    APP_VERSION: pkg.version,
    GIT_SHA: resolveGitSha(),
    BUILD_TIME: process.env.BUILD_TIME || new Date().toISOString(),
  },
};

export default nextConfig;
