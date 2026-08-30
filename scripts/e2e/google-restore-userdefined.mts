/**
 * Put back the custom fields a probe run removed, from the payload it saved first.
 *
 *   npx tsx scripts/e2e/google-restore-userdefined.mts B --yes
 *
 * Reads .probe/all-before.json — written before any write — and restores each contact's
 * userDefined group to exactly what it held then, dropping any hearth_id a probe added.
 *
 * This exists because a --all run destroyed 41 "Photo" custom fields: by design, since a
 * Photo URL becomes the contact's picture and is no longer kept as text, but on an account
 * where nothing had imported those pictures yet it was a one-way trip. Saving the payload
 * before writing is what makes it not one.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { createPeopleClient } from "@/lib/google/people-client";
// The superset, not what an install asks for: these scripts hold one token and
// exercise features whose scopes are per-install opt-ins.
import { ALL_GOOGLE_SCOPES } from "@/lib/google/scopes";
import { GOOGLE_IMPORT_FIELDS } from "@/lib/google/import-plan";

const BEFORE = path.join(process.cwd(), ".probe", "all-before.json");
if (!existsSync(BEFORE)) {
  console.error(`No ${BEFORE}. Nothing to restore from.`);
  process.exit(1);
}

const env = new Map<string, string>();
for (const line of readFileSync(path.join(process.cwd(), ".env.e2e"), "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
}
const slot = (process.argv[2] ?? "B").toUpperCase() === "A" ? "A" : "B";
const auth = new google.auth.OAuth2({
  clientId: env.get("E2E_GOOGLE_CLIENT_ID"),
  clientSecret: env.get("E2E_GOOGLE_CLIENT_SECRET"),
});
auth.setCredentials({
  refresh_token: env.get(`E2E_REFRESH_TOKEN_${slot}`),
  scope: ALL_GOOGLE_SCOPES.join(" "),
});
const people = createPeopleClient(auth);

interface Saved {
  resourceName?: string | null;
  names?: { displayName?: string | null }[];
  userDefined?: { key?: string | null; value?: string | null }[];
}
const saved: Saved[] = JSON.parse(readFileSync(BEFORE, "utf8"));
const wanted = new Map<string, { key: string; value: string }[]>();
for (const c of saved) {
  const fields = (c.userDefined ?? [])
    .filter((u) => u.key !== "hearth_id")
    .map((u) => ({ key: u.key ?? "", value: u.value ?? "" }))
    .filter((u) => u.key && u.value);
  if (fields.length > 0 && c.resourceName) wanted.set(c.resourceName, fields);
}
console.log(`${wanted.size} contacts had custom fields when the payload was saved`);

if (!process.argv.includes("--yes")) {
  console.log("Add --yes to write them back.");
  process.exit(0);
}

// Current etags, since a write needs the etag Google holds now rather than the saved one.
const current = new Map(
  (await people.listConnections([...GOOGLE_IMPORT_FIELDS])).map((c) => [c.resourceName, c]),
);

let restored = 0;
let already = 0;
for (const [resourceName, fields] of wanted) {
  const now = current.get(resourceName);
  if (!now) { console.log(`  gone: ${resourceName}`); continue; }
  const have = (now.userDefined ?? []).filter((u) => u.key !== "hearth_id");
  if (JSON.stringify(have.map((u) => [u.key, u.value])) ===
      JSON.stringify(fields.map((u) => [u.key, u.value]))) {
    already += 1;
    continue;
  }
  // Any hearth_id currently on the contact is kept: it may be a real adoption rather than
  // a probe's marker, and this script is about custom fields.
  const hearthId = (now.userDefined ?? []).find((u) => u.key === "hearth_id");
  try {
    await people.updateContact({
      resourceName,
      etag: now.etag!,
      person: {
        userDefined: [
          ...(hearthId ? [{ key: "hearth_id", value: hearthId.value ?? "" }] : []),
          ...fields,
        ],
      },
      updateFields: ["userDefined"],
    });
    restored += 1;
  } catch (err) {
    console.log(`  failed ${now.names?.[0]?.displayName}: ${err instanceof Error ? err.message.slice(0, 70) : err}`);
  }
}
console.log(`\nrestored ${restored}, already correct ${already}\n`);
