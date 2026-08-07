/**
 * Promote the [Unreleased] changelog section to the version being released.
 *
 * Runs from the `version` npm hook, i.e. after `npm version` has bumped
 * package.json but before it creates the release commit — so the changelog edit
 * lands inside that same commit and can never drift from the tag.
 *
 * Refuses to run when [Unreleased] is empty. That is the point: it makes an
 * undocumented release an error rather than something you notice months later
 * while trying to work out what changed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const changelogPath = path.join(root, "CHANGELOG.md");
const REPO = "https://gitlab.com/hammerling/hearth";

const { version } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const today = new Date().toISOString().slice(0, 10);

let text = readFileSync(changelogPath, "utf8");

// --- 1. check [Unreleased] actually has content ---------------------------
const unreleasedHeading = "## [Unreleased]";
const start = text.indexOf(unreleasedHeading);
if (start === -1) {
  fail(`could not find "${unreleasedHeading}" in CHANGELOG.md`);
}

const afterHeading = start + unreleasedHeading.length;
const nextHeading = text.indexOf("\n## ", afterHeading);
const body = text.slice(afterHeading, nextHeading === -1 ? undefined : nextHeading);

if (body.trim().length === 0) {
  fail(
    `[Unreleased] is empty — describe what changed in CHANGELOG.md before releasing v${version}.`,
  );
}

if (text.includes(`## [${version}]`)) {
  fail(`CHANGELOG.md already has a section for ${version}.`);
}

// --- 2. insert the new version heading -----------------------------------
text =
  text.slice(0, afterHeading) +
  `\n\n## [${version}] — ${today}` +
  text.slice(afterHeading);

// --- 3. refresh the link references at the foot of the file ---------------
// The Unreleased comparison must now start from the tag being created.
text = text.replace(
  /^\[Unreleased\]:.*$/m,
  `[Unreleased]: ${REPO}/-/compare/v${version}...main`,
);

// Add this version's tag link directly beneath the Unreleased line.
text = text.replace(
  /^(\[Unreleased\]:.*)$/m,
  `$1\n[${version}]: ${REPO}/-/tags/v${version}`,
);

writeFileSync(changelogPath, text);
console.log(`[release] CHANGELOG.md: [Unreleased] -> [${version}] — ${today}`);

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}
