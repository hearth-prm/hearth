/**
 * Actually push a real Google contact back, and diff what Google kept.
 *
 *   npx tsx scripts/e2e/google-write-check.mts B "Mister Four" --yes
 *   npx tsx scripts/e2e/google-write-check.mts B "Mister Four" --clear-id
 *
 * --clear-id undoes the one mark this leaves behind. A push writes `hearth_id` into
 * userDefined, which is the adoption working as intended — but a probe run against a
 * contact nobody is importing leaves an id no install owns, and the next plan will rightly
 * warn about it. So the probe can take its own marker back off.
 *
 * WRITES to Google, to exactly ONE contact — the one whose display name contains the
 * string given, refusing if that matches anything other than a single contact. `--yes` is
 * required; without it this prints what it would send and stops.
 *
 * The last unproven step. google-import-check.mts predicts what a push would do by diffing
 * Google's payload against what serializePerson builds, which is a prediction about how the
 * People API behaves on write: that omitting a derived field leaves it recomputed, that a
 * dateless birthday is accepted as a date, that a wholesale group replacement keeps what was
 * sent. A prediction about somebody else's API is a belief, and this is how a belief becomes
 * evidence.
 *
 * The before payload is written to .probe/ first, always, so anything Google mangles can be
 * put back by hand.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { createPeopleClient } from "@/lib/google/people-client";
import { GOOGLE_SCOPES } from "@/lib/google/scopes";
import { GOOGLE_IMPORT_FIELDS, planGoogleImport } from "@/lib/google/import-plan";
import {
  MANAGED_PERSON_FIELDS,
  serializePerson,
  type PersonWithContacts,
} from "@/lib/google/serialize-person";
import type { ContactPoint, Person } from "@prisma/client";

const ENV_FILE = path.join(process.cwd(), ".env.e2e");
const OUT_DIR = path.join(process.cwd(), ".probe");

function readEnv(): Map<string, string> {
  if (!existsSync(ENV_FILE)) {
    console.error(`No ${ENV_FILE}.`);
    process.exit(1);
  }
  const out = new Map<string, string>();
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) out.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return out;
}

const slot = (process.argv[2] ?? "").toUpperCase() === "A" ? "A" : "B";
const needle = process.argv[3] ?? "";
const confirmed = process.argv.includes("--yes");
const clearId = process.argv.includes("--clear-id");
if (!needle) {
  console.error('Name a contact: google-write-check.mts B "Mister Four" --yes');
  process.exit(1);
}

const env = readEnv();
const clientId = env.get("E2E_GOOGLE_CLIENT_ID");
const clientSecret = env.get("E2E_GOOGLE_CLIENT_SECRET");
const refreshToken = env.get(`E2E_REFRESH_TOKEN_${slot}`);
const email = env.get(`E2E_EMAIL_${slot}`) ?? `account ${slot}`;
if (!clientId || !clientSecret || !refreshToken) {
  console.error(`Missing credentials for slot ${slot} in .env.e2e`);
  process.exit(1);
}

const auth = new google.auth.OAuth2({ clientId, clientSecret });
auth.setCredentials({ refresh_token: refreshToken, scope: GOOGLE_SCOPES.join(" ") });
const people = createPeopleClient(auth);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "metadata") continue;
      if (v === null || v === undefined || v === "") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}
const show = (v: unknown) => JSON.stringify(strip(v));

const bareContactPoint = (over: Partial<ContactPoint>): ContactPoint =>
  ({
    id: "cp", personId: "p", kind: "EMAIL", label: null, value: "",
    isPrimary: false, order: 0,
    poBox: null, streetAddress: null, extendedAddress: null, city: null, region: null,
    postalCode: null, country: null, countryCode: null, displayName: null,
    protocol: null, buildingId: null, floor: null, floorSection: null, deskCode: null,
    current: null, createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  }) as ContactPoint;

const barePerson = (over: Partial<Person> & Record<string, unknown>): PersonWithContacts =>
  ({
    id: "p", ownerId: "u", givenName: null, middleName: null, familyName: null,
    honorificPrefix: null, honorificSuffix: null, phoneticGivenName: null,
    phoneticMiddleName: null, phoneticFamilyName: null, nickname: null,
    organization: null, jobTitle: null, orgDepartment: null, orgJobDescription: null,
    orgSymbol: null, orgDomain: null, orgLocation: null, orgPhoneticName: null,
    orgType: null, gender: null, birthday: null, birthdayText: null, notes: null,
    displayName: "", custom: {}, addToGoogle: true, linkedUserId: null, deletedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0), contactPoints: [],
    ...over,
  }) as unknown as PersonWithContacts;

// --- pick exactly one contact ----------------------------------------------

console.log(`\n=== Google WRITE check — ${email} (slot ${slot}) ===\n`);

const connections = await people.listConnections([...GOOGLE_IMPORT_FIELDS]);
const matches = connections.filter((c) =>
  (c.names?.[0]?.displayName ?? "").toLowerCase().includes(needle.toLowerCase()),
);
if (matches.length !== 1) {
  console.error(
    `"${needle}" matches ${matches.length} contacts. Refusing — this writes, so it acts on one contact or none.`,
  );
  for (const m of matches) console.error(`  ${m.names?.[0]?.displayName}`);
  process.exit(1);
}
const before = matches[0]!;
const resourceName = before.resourceName!;
console.log(`target: ${before.names?.[0]?.displayName}  (${resourceName})`);

if (clearId) {
  const stray = before.userDefined?.find((u) => u.key === "hearth_id");
  if (!stray) {
    console.log("no hearth_id on it — nothing to take back\n");
    process.exit(0);
  }
  console.log(`removing hearth_id=${stray.value}`);
  await people.updateContact({
    resourceName,
    etag: before.etag!,
    // userDefined holds nothing but the id, so replacing the group with an empty one
    // removes exactly the marker and nothing else.
    person: { userDefined: [] },
    updateFields: ["userDefined"],
  });
  const after = (await people.listConnections([...GOOGLE_IMPORT_FIELDS])).find(
    (c) => c.resourceName === resourceName,
  );
  console.log(`userDefined now: ${show(after?.userDefined ?? null)}`);
  console.log(`name still: ${after?.names?.[0]?.displayName}\n`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const beforePath = path.join(OUT_DIR, "write-before.json");
writeFileSync(beforePath, JSON.stringify(before, null, 2));
console.log(`before payload saved to ${beforePath}`);

// --- what Hearth would store, and what it would send -----------------------

const plan = planGoogleImport([before], { linkedResourceNames: new Set<string>() });
const contact = plan.contacts[0]!;
const { person: payload, updateFields } = serializePerson(
  barePerson({
    ...contact.columns,
    birthday: contact.columns.birthday ? new Date(contact.columns.birthday) : null,
    displayName: contact.displayName,
    // A real import would use the created row's cuid. Any stable value proves the same
    // thing here, and "probe-write" is recognisable in an address book if it is left behind.
    id: "probe-write",
    contactPoints: contact.contactPoints.map((cp, i) =>
      bareContactPoint({ ...cp, id: `cp${i}` }),
    ),
    googleEvents: contact.events,
    googleRelations: contact.relations,
  }),
);

console.log(`\nwould send ${updateFields.length} field groups: ${updateFields.join(", ")}`);
if (!confirmed) {
  console.log("\nNothing written — pass --yes to actually push.\n");
  process.exit(0);
}

// --- push, then ask Google what it kept ------------------------------------

const written = await people.updateContact({
  resourceName,
  etag: before.etag!,
  person: payload,
  updateFields: [...updateFields],
});
console.log(`\npushed. new etag ${written.etag?.slice(0, 12)}…`);

const after = (await people.listConnections([...GOOGLE_IMPORT_FIELDS])).find(
  (c) => c.resourceName === resourceName,
);
if (!after) {
  console.error("the contact is GONE from Google after the write — restore from write-before.json");
  process.exit(1);
}
writeFileSync(path.join(OUT_DIR, "write-after.json"), JSON.stringify(after, null, 2));

let lost = 0;
let changed = 0;
console.log("\n── what Google actually holds now:");
for (const field of MANAGED_PERSON_FIELDS) {
  const b = strip((before as Record<string, unknown>)[field] ?? null);
  const a = strip((after as Record<string, unknown>)[field] ?? null);
  const had = Array.isArray(b) ? b.length > 0 : b !== null;
  const has = Array.isArray(a) ? a.length > 0 : a !== null;
  if (!had && !has) continue;
  if (JSON.stringify(b) === JSON.stringify(a)) {
    console.log(`   = ${field}: survived unchanged`);
    continue;
  }
  if (had && !has) {
    lost += 1;
    console.log(`   ✗ ${field}: LOST — was ${show(b)}`);
    continue;
  }
  changed += 1;
  console.log(`   ~ ${field}: ${show(b)}\n       → ${show(a)}`);
}

// Fields outside the mask must be untouched. That is the promise the mask makes, and it is
// worth checking rather than trusting: memberships is how labels survive a push, and photos
// is somebody's picture.
console.log("\n── fields Hearth does not manage (must be untouched):");
for (const field of ["memberships", "photos", "clientData", "coverPhotos"]) {
  const b = strip((before as Record<string, unknown>)[field] ?? null);
  const a = strip((after as Record<string, unknown>)[field] ?? null);
  const same = JSON.stringify(b) === JSON.stringify(a);
  if (b === null && a === null) continue;
  console.log(`   ${same ? "=" : "✗"} ${field}: ${same ? "untouched" : `CHANGED ${show(b)} → ${show(a)}`}`);
}

console.log(`\n=== ${lost} field group(s) lost, ${changed} rewritten ===`);
console.log(`before/after payloads in ${OUT_DIR}\n`);
