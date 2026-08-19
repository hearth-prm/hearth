/**
 * What Hearth would make of a REAL Google address book, and what it would give back.
 *
 *   npx tsx scripts/e2e/google-import-check.mts [A|B]
 *
 * READ-ONLY. It lists contacts and groups and then runs the two pure modules that decide
 * everything — planGoogleImport and serializePerson — over what Google actually returned.
 * No contact is created, updated, deleted or adopted; no database is involved.
 *
 * The question it exists to answer is not "does the import work" — the e2e suite covers
 * that against payloads I wrote, which is the problem: they contain the shapes I thought
 * of. This asks what happens to shapes I did not.
 *
 * The second half is the one that matters. MANAGED_PERSON_FIELDS is an update mask, and
 * Google replaces each listed group wholesale, so a field Hearth reads but does not send
 * back is DELETED from the contact on the first sync after an import. This walks each
 * contact through Google → plan → Person → Google and diffs the two ends, so that loss is
 * something you read here rather than discover in your address book.
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
    console.error(`No ${ENV_FILE}. Run \`npm run token -- B\` first.`);
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

const slot = (process.argv[2] ?? "B").toUpperCase() === "A" ? "A" : "B";
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

// --- helpers ---------------------------------------------------------------

/** Google decorates every value with `metadata`; only the meaning is compared. */
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // metadata is Google's bookkeeping. formattedType and formattedName are echoes
      // Google derives from the parts, and it recomputes them on write — comparing them
      // would report a difference Hearth is not making.
      if (k === "metadata" || k === "formattedType" || k === "formattedName") continue;
      if (v === null || v === undefined || v === "") continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

function show(value: unknown): string {
  return JSON.stringify(strip(value));
}

const bareContactPoint = (over: Partial<ContactPoint>): ContactPoint =>
  ({
    id: "cp", personId: "p", kind: "EMAIL", label: null, value: "",
    isPrimary: false, order: 0,
    poBox: null, streetAddress: null, extendedAddress: null, city: null, region: null,
    postalCode: null, country: null, countryCode: null, displayName: null,
    protocol: null, buildingId: null, floor: null, floorSection: null, deskCode: null,
    current: null,
    createdAt: new Date(0), updatedAt: new Date(0),
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
    createdAt: new Date(0), updatedAt: new Date(0),
    contactPoints: [],
    ...over,
  }) as unknown as PersonWithContacts;

// --- go --------------------------------------------------------------------

console.log(`\n=== Google import check — ${email} (slot ${slot}) — READ ONLY ===\n`);

/**
 * A dead refresh token is the likely failure here, and it deserves a sentence rather than
 * a hundred lines of gaxios internals.
 *
 * Google expires refresh tokens after SEVEN DAYS for an OAuth app whose publishing status
 * is still "Testing", whatever the scopes. That is not a quirk of this script — it is what
 * makes a self-hosted install stop syncing every week until the app is published.
 */
async function fetchOrExplain<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\ncould not ${what}: ${message}`);
    if (message.includes("invalid_grant")) {
      console.error(
        [
          "",
          "The stored refresh token is dead. Mint a fresh one:",
          "",
          `    npm run token -- ${slot}`,
          "",
          "and sign in as that account when the browser opens.",
          "",
          "If this keeps happening weekly, the cause is the OAuth app's publishing status:",
          "Google expires refresh tokens after 7 days while an app is in \"Testing\".",
        ].join("\n"),
      );
    }
    process.exit(1);
  }
}

const [connections, groups] = await Promise.all([
  fetchOrExplain("list contacts", () => people.listConnections([...GOOGLE_IMPORT_FIELDS])),
  fetchOrExplain("list contact groups", () => people.listContactGroups()),
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  path.join(OUT_DIR, `google-${slot}-before.json`),
  JSON.stringify({ connections, groups }, null, 2),
);
console.log(`${connections.length} contacts, ${groups.length} user-created groups`);
console.log(`raw payload saved to ${path.join(OUT_DIR, `google-${slot}-before.json`)}\n`);

const groupName = new Map(groups.map((g) => [g.resourceName, g.name]));
for (const g of groups) {
  const n = connections.filter((p) =>
    (p.memberships ?? []).some(
      (m) => m.contactGroupMembership?.contactGroupResourceName === g.resourceName,
    ),
  ).length;
  console.log(`  label "${g.name}" — ${n} contact${n === 1 ? "" : "s"}`);
}

const plan = planGoogleImport(connections, { linkedResourceNames: new Set<string>() });
console.log(
  `\nplan: ${plan.counts.import} to import, ${plan.counts.linked} already linked, ` +
    `${plan.counts.skip} skipped, ${plan.counts.rescued} values rescued as custom fields`,
);
if (plan.newFieldKeys.length > 0) {
  console.log(`custom fields it would create: ${plan.newFieldKeys.join(", ")}`);
}

let lossCount = 0;
let changeCount = 0;

for (const contact of plan.contacts) {
  const source = connections.find((c) => c.resourceName === contact.resourceName)!;
  console.log(`\n──────────── ${contact.displayName} (${contact.action})`);

  const setColumns = Object.entries(contact.columns).filter(([, v]) => v !== null);
  console.log(`  columns: ${setColumns.map(([k, v]) => `${k}=${v}`).join(", ") || "—"}`);
  for (const cp of contact.contactPoints) {
    const detail = Object.entries(cp)
      .filter(([k, v]) => v !== null && !["kind", "value", "label", "isPrimary", "order"].includes(k))
      .map(([k, v]) => `${k}=${v}`);
    console.log(
      `  ${cp.kind}${cp.label ? ` (${cp.label})` : ""}: ${cp.value}` +
        (detail.length ? `  [${detail.join(", ")}]` : ""),
    );
  }
  for (const e of contact.events) {
    console.log(`  date ${e.label ?? "—"}: ${e.year ?? "????"}-${e.month}-${e.day}`);
  }
  for (const r of contact.relations) {
    console.log(`  relation ${r.label ?? "—"}: ${r.name}`);
  }
  for (const r of contact.rescued) {
    console.log(`  RESCUED → custom field "${r.label}" (${r.key}) = ${r.value}`);
  }
  if (contact.groupIds.length > 0) {
    console.log(
      `  labels: ${contact.groupIds.map((g) => groupName.get(g) ?? g).join(", ")}`,
    );
  }
  for (const reason of contact.reasons) console.log(`  note: ${reason}`);

  // --- the round trip ----------------------------------------------------
  //
  // Everything above is what Hearth would store. This is what it would send back, and
  // the mask means anything missing from it is deleted rather than merely not updated.
  const { person: pushed } = serializePerson(
    barePerson({
      ...contact.columns,
      birthday: contact.columns.birthday ? new Date(contact.columns.birthday) : null,
      displayName: contact.displayName,
      contactPoints: contact.contactPoints.map((cp, i) =>
        bareContactPoint({ ...cp, id: `cp${i}` }),
      ),
      googleEvents: contact.events,
      googleRelations: contact.relations,
    }),
  );

  console.log("  ── if Hearth pushed this contact back to Google:");
  for (const field of MANAGED_PERSON_FIELDS) {
    const before = strip((source as Record<string, unknown>)[field] ?? null);
    const after = strip((pushed as Record<string, unknown>)[field] ?? null);
    const had = Array.isArray(before) ? before.length > 0 : before !== null;
    const has = Array.isArray(after) ? after.length > 0 : after !== null;

    if (!had && !has) continue;
    if (JSON.stringify(before) === JSON.stringify(after)) {
      console.log(`     = ${field}: unchanged`);
      continue;
    }
    if (had && !has) {
      lossCount += 1;
      console.log(`     ✗ ${field}: WOULD BE CLEARED — Google has ${show(before)}`);
      continue;
    }
    changeCount += 1;
    console.log(`     ~ ${field}: ${show(before)}  →  ${show(after)}`);
  }
}

writeFileSync(
  path.join(OUT_DIR, `plan-${slot}.json`),
  JSON.stringify(plan, null, 2),
);

console.log(
  `\n=== ${lossCount} field group(s) would be cleared, ${changeCount} would be rewritten ===`,
);
console.log("Nothing was written to Google. `hearth_id` is expected under userDefined.\n");
