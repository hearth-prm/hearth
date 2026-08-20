/**
 * Actually push a real Google contact back, and diff what Google kept.
 *
 *   npx tsx scripts/e2e/google-write-check.mts B "Mister Four" --yes
 *   npx tsx scripts/e2e/google-write-check.mts B "Mister Four" --clear-id
 *   npx tsx scripts/e2e/google-write-check.mts B --all --yes
 *
 * --all pushes EVERY contact in the account and then re-reads the lot. Only ever point that
 * at an account you are willing to lose: it is the whole address book through the most
 * dangerous write path in the app, which is exactly the test worth having and exactly the
 * thing that ruins a real Google account if a belief here is wrong.
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
import { resolveMappings } from "@/lib/google/mappings";
import type { FieldDef } from "@/lib/fields/types";
import type { FieldMapping } from "@prisma/client";
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
const all = process.argv.includes("--all");
if (!needle && !all) {
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

/**
 * Key order is not a difference.
 *
 * strip() preserved whatever order each side happened to build its objects in, so six
 * organisations were reported as rewritten purely because Hearth emits title before
 * department and Google returns them the other way round. Exactly the bug canonical() in
 * person-history.ts exists for, in a second place — comparing serialised JSON is only
 * meaningful once both sides are ordered the same way.
 *
 * Array order is left alone: a different order of addresses IS a difference.
 */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canon((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

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
const show = (v: unknown) => JSON.stringify(canon(strip(v)));

/**
 * Entries that were in a group and are not any more.
 *
 * Presence of the GROUP is not presence of its contents. Comparing only "had something,
 * has something" reported a clean run while forty-one custom fields were deleted from
 * inside userDefined, because every contact had gained a hearth_id and so every group was
 * still non-empty. Matched on the serialised entry so a value that merely moved position
 * is not called a loss.
 */
function entriesMissing(before: unknown, after: unknown): string[] {
  if (!Array.isArray(before)) return [];
  const now = new Set((Array.isArray(after) ? after : []).map((x) => JSON.stringify(x)));
  return before
    .map((x) => JSON.stringify(x))
    .filter((x) => !now.has(x))
    .map((x) => (x.length > 70 ? `${x.slice(0, 70)}…` : x));
}

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

/** What Hearth would send for one Google contact, through the real modules. */
function payloadFor(source: (typeof connections)[number]) {
  const contact = planGoogleImport([source], {
    linkedResourceNames: new Set<string>(),
  }).contacts[0]!;
  const customFields: FieldDef[] = contact.rescued.map((r, i) => ({
    key: r.key, label: r.label, type: "TEXT", core: false, entity: "PERSON",
    order: 100 + i, required: false, options: [], helpText: null, archived: false,
    storage: "custom", generic: true, listed: false,
  }) as unknown as FieldDef);
  const mappings = resolveMappings(
    contact.rescued.map((r) => ({
      fieldKey: r.key, target: "userDefined", targetKey: r.label,
    }) as unknown as FieldMapping),
  );
  return serializePerson(
    barePerson({
      ...contact.columns,
      birthday: contact.columns.birthday ? new Date(contact.columns.birthday) : null,
      displayName: contact.displayName,
      id: "probe-write",
      custom: Object.fromEntries(contact.rescued.map((r) => [r.key, r.value])),
      contactPoints: contact.contactPoints.map((cp, i) =>
        bareContactPoint({ ...cp, id: `cp${i}` }),
      ),
      googleEvents: contact.events,
      googleRelations: contact.relations,
    }),
    { customFields, mappings },
  );
}

if (all && clearId) {
  // Undo a --all run: strip the probe's marker from every contact, keeping whatever else
  // each one had in its custom fields.
  let cleaned = 0;
  for (const source of connections) {
    const stray = source.userDefined?.find((u) => u.key === "hearth_id");
    if (!stray) continue;
    const keep = (source.userDefined ?? [])
      .filter((u) => u.key !== "hearth_id")
      .map((u) => ({ key: u.key ?? "", value: u.value ?? "" }));
    try {
      await people.updateContact({
        resourceName: source.resourceName!,
        etag: source.etag!,
        person: { userDefined: keep },
        updateFields: ["userDefined"],
      });
      cleaned += 1;
    } catch (err) {
      console.log(`  failed on ${source.names?.[0]?.displayName}: ${err instanceof Error ? err.message.slice(0, 70) : err}`);
    }
    if (cleaned % 50 === 0 && cleaned > 0) console.log(`  ${cleaned} cleaned`);
  }
  console.log(`\nremoved the marker from ${cleaned} contacts\n`);
  process.exit(0);
}

if (all) {
  if (!confirmed) {
    console.error(`--all would push all ${connections.length} contacts. Add --yes.`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "all-before.json"), JSON.stringify(connections, null, 2));
  console.log(`pushing all ${connections.length} contacts. before payload saved.\n`);

  let done = 0;
  const failures: { name: string; error: string }[] = [];
  for (const source of connections) {
    const name = source.names?.[0]?.displayName ?? source.resourceName ?? "?";
    const { person: payload, updateFields } = payloadFor(source);
    // One at a time with a retry, rather than as fast as the loop will go: the People API
    // rate-limits writes, and a run that dies two thirds of the way through leaves an
    // address book in a state nobody planned.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await people.updateContact({
          resourceName: source.resourceName!,
          etag: source.etag!,
          person: payload,
          updateFields: [...updateFields],
        });
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === 4) {
          failures.push({ name, error: message.slice(0, 90) });
          break;
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
    done += 1;
    if (done % 25 === 0) console.log(`  ${done}/${connections.length}`);
  }
  console.log(`\npushed ${done - failures.length} of ${connections.length}`);
  for (const f of failures) console.log(`  FAILED ${f.name}: ${f.error}`);

  const afterAll = await people.listConnections([...GOOGLE_IMPORT_FIELDS]);
  writeFileSync(path.join(OUT_DIR, "all-after.json"), JSON.stringify(afterAll, null, 2));
  const afterByName = new Map(afterAll.map((c) => [c.resourceName, c]));

  const verdicts = new Map<string, { same: number; rewritten: number; lost: number }>();
  const losses: string[] = [];
  const unmanagedChanges: string[] = [];
  let missing = 0;

  for (const source of connections) {
    const after = afterByName.get(source.resourceName);
    if (!after) { missing += 1; continue; }
    const name = source.names?.[0]?.displayName ?? "?";

    for (const field of MANAGED_PERSON_FIELDS) {
      const b = canon(strip((source as Record<string, unknown>)[field] ?? null));
      const a = canon(strip((after as Record<string, unknown>)[field] ?? null));
      const had = Array.isArray(b) ? b.length > 0 : b !== null;
      const has = Array.isArray(a) ? a.length > 0 : a !== null;
      if (!had && !has) continue;
      const v = verdicts.get(field) ?? { same: 0, rewritten: 0, lost: 0 };
      if (JSON.stringify(b) === JSON.stringify(a)) v.same += 1;
      else if (had && !has) {
        v.lost += 1;
        if (losses.length < 40) losses.push(`   ✗ ${name} — ${field} — was ${show(b)}`);
      } else {
        // A group that still has SOMETHING in it can still have lost something from it,
        // and calling that merely "rewritten" is how this instrument came to report zero
        // losses while 41 values disappeared from inside userDefined. Entries present
        // before and absent after are counted as losses whether the group emptied or not.
        const gone = entriesMissing(b, a);
        if (gone.length > 0) {
          v.lost += 1;
          if (losses.length < 40) {
            losses.push(`   ✗ ${name} — ${field} — gone from the group: ${gone.join(", ")}`);
          }
        } else v.rewritten += 1;
      }
      verdicts.set(field, v);
    }

    // The promise the mask makes, checked on every contact rather than one.
    for (const field of ["memberships", "photos"]) {
      const b = canon(strip((source as Record<string, unknown>)[field] ?? null));
      const a = canon(strip((after as Record<string, unknown>)[field] ?? null));
      if (JSON.stringify(b) !== JSON.stringify(a) && unmanagedChanges.length < 20) {
        unmanagedChanges.push(`   ✗ ${name} — ${field} — ${show(b)} → ${show(a)}`);
      }
    }
  }

  console.log(`\n── what Google kept, across ${connections.length} contacts`);
  for (const [field, v] of verdicts) {
    const flag = v.lost > 0 ? "✗" : v.rewritten > 0 ? "~" : "=";
    console.log(`   ${flag} ${field.padEnd(16)} ${v.same} unchanged, ${v.rewritten} rewritten, ${v.lost} LOST`);
  }
  if (missing > 0) console.log(`\n   ${missing} contacts are GONE — restore from all-before.json`);
  if (losses.length > 0) { console.log("\n── losses"); for (const l of losses) console.log(l); }
  console.log(`\n── fields outside the mask (must be untouched): ${unmanagedChanges.length === 0 ? "all untouched" : ""}`);
  for (const c of unmanagedChanges) console.log(c);

  const totalLost = [...verdicts.values()].reduce((n, v) => n + v.lost, 0);
  console.log(`\n=== ${totalLost} field group(s) lost across the account ===\n`);
  process.exit(0);
}

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
  // Everything else in the group is written back. userDefined is replaced wholesale, so
  // sending an empty group to drop one marker would take a contact's other custom fields
  // with it — which on this account means 63 Photo values. Taking a marker back has to
  // put the rest back with it.
  const keep = (before.userDefined ?? [])
    .filter((u) => u.key !== "hearth_id")
    .map((u) => ({ key: u.key ?? "", value: u.value ?? "" }));
  await people.updateContact({
    resourceName,
    etag: before.etag!,
    person: { userDefined: keep },
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
  const b = canon(strip((before as Record<string, unknown>)[field] ?? null));
  const a = canon(strip((after as Record<string, unknown>)[field] ?? null));
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
  const b = canon(strip((before as Record<string, unknown>)[field] ?? null));
  const a = canon(strip((after as Record<string, unknown>)[field] ?? null));
  const same = JSON.stringify(b) === JSON.stringify(a);
  if (b === null && a === null) continue;
  console.log(`   ${same ? "=" : "✗"} ${field}: ${same ? "untouched" : `CHANGED ${show(b)} → ${show(a)}`}`);
}

console.log(`\n=== ${lost} field group(s) lost, ${changed} rewritten ===`);
console.log(`before/after payloads in ${OUT_DIR}\n`);
