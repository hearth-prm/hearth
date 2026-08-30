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
// The superset, not what an install asks for: these scripts hold one token and
// exercise features whose scopes are per-install opt-ins.
import { ALL_GOOGLE_SCOPES } from "@/lib/google/scopes";
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
auth.setCredentials({ refresh_token: refreshToken, scope: ALL_GOOGLE_SCOPES.join(" ") });
const people = createPeopleClient(auth);

// --- helpers ---------------------------------------------------------------

/** Google decorates every value with `metadata`; only the meaning is compared. */
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
  return JSON.stringify(canon(strip(value)));
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

/**
 * At three hundred contacts, printing each one is not a report — it is a haystack.
 *
 * So this counts, and then shows only what is worth reading: every contact a push would
 * take something from, every distinct reason and rescue with an example, and a census of
 * which of Google's field groups this address book actually uses. `--verbose` restores the
 * per-contact dump for a small account.
 */
const verbose = process.argv.includes("--verbose");
/** --field organizations: show every contact whose named group the push would change. */
const onlyField = (() => {
  const i = process.argv.indexOf("--field");
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
})();

// Which field groups Google actually returned, across the whole book. This is the answer to
// "which of the things Hearth models has never been seen in the wild".
const census = new Map<string, number>();
for (const person of connections) {
  for (const field of GOOGLE_IMPORT_FIELDS) {
    const v = (person as Record<string, unknown>)[field];
    const present = Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
    if (present) census.set(field, (census.get(field) ?? 0) + 1);
  }
}

const kinds = new Map<string, number>();
const labelsSeen = new Map<string, number>();
const reasons = new Map<string, { count: number; example: string }>();
const rescues = new Map<string, { count: number; example: string }>();
const fieldVerdicts = new Map<string, { same: number; rewritten: number; cleared: number }>();
const losers: { name: string; field: string; had: string }[] = [];

for (const contact of plan.contacts) {
  const source = connections.find((c) => c.resourceName === contact.resourceName)!;

  for (const cp of contact.contactPoints) {
    kinds.set(cp.kind, (kinds.get(cp.kind) ?? 0) + 1);
    if (cp.label) labelsSeen.set(`${cp.kind}:${cp.label}`, (labelsSeen.get(`${cp.kind}:${cp.label}`) ?? 0) + 1);
  }
  for (const r of contact.reasons) {
    const prev = reasons.get(r);
    reasons.set(r, { count: (prev?.count ?? 0) + 1, example: prev?.example ?? contact.displayName });
  }
  for (const r of contact.rescued) {
    const prev = rescues.get(r.key);
    rescues.set(r.key, {
      count: (prev?.count ?? 0) + 1,
      example: prev?.example ?? `${contact.displayName}: ${r.label} = ${r.value}`,
    });
  }

  // A rescued value is only preserved because the import also creates a mapping sending it
  // BACK to userDefined — without that it would be "kept" in Hearth and deleted from Google
  // on the next push, since userDefined is in the mask. So the probe has to build the same
  // definitions and mappings ensureRescueField would, or it reports a round trip that the
  // real import does not perform.
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

  const { person: pushed } = serializePerson(
    barePerson({
      ...contact.columns,
      birthday: contact.columns.birthday ? new Date(contact.columns.birthday) : null,
      displayName: contact.displayName,
      custom: Object.fromEntries(contact.rescued.map((r) => [r.key, r.value])),
      contactPoints: contact.contactPoints.map((cp, i) =>
        bareContactPoint({ ...cp, id: `cp${i}` }),
      ),
      googleEvents: contact.events,
      googleRelations: contact.relations,
    }),
    { customFields, mappings },
  );

  if (verbose) console.log(`\n──────────── ${contact.displayName} (${contact.action})`);

  for (const field of MANAGED_PERSON_FIELDS) {
    const before = canon(strip((source as Record<string, unknown>)[field] ?? null));
    const after = canon(strip((pushed as Record<string, unknown>)[field] ?? null));
    const had = Array.isArray(before) ? before.length > 0 : before !== null;
    const has = Array.isArray(after) ? after.length > 0 : after !== null;
    if (!had && !has) continue;

    const verdict = fieldVerdicts.get(field) ?? { same: 0, rewritten: 0, cleared: 0 };
    if (JSON.stringify(before) === JSON.stringify(after)) verdict.same += 1;
    else if (had && !has) {
      verdict.cleared += 1;
      losers.push({ name: contact.displayName, field, had: show(before) });
    } else verdict.rewritten += 1;
    fieldVerdicts.set(field, verdict);

    const differs = JSON.stringify(before) !== JSON.stringify(after);
    if (verbose) {
      const mark = !differs ? "=" : had && !has ? "✗" : "~";
      console.log(`     ${mark} ${field}: ${show(before)}${mark === "=" ? "" : `  →  ${show(after)}`}`);
    } else if (onlyField === field && differs) {
      console.log(`   ${contact.displayName}\n      was ${show(before)}\n      now ${show(after)}`);
    }
  }
}

console.log("\n── which of Google's field groups this address book uses");
for (const field of GOOGLE_IMPORT_FIELDS) {
  if (field === "metadata") continue;
  const n = census.get(field) ?? 0;
  console.log(`   ${n === 0 ? "·" : " "} ${field.padEnd(16)} ${n === 0 ? "never seen" : `${n} contacts`}`);
}

console.log("\n── what the import would store");
console.log(`   contact point kinds: ${[...kinds].map(([k, n]) => `${k}×${n}`).join(", ")}`);
console.log(`   distinct labels in use: ${labelsSeen.size}`);

console.log("\n── round trip, across every contact");
for (const [field, v] of fieldVerdicts) {
  const flag = v.cleared > 0 ? "✗" : v.rewritten > 0 ? "~" : "=";
  console.log(
    `   ${flag} ${field.padEnd(16)} ${v.same} unchanged, ${v.rewritten} rewritten, ${v.cleared} CLEARED`,
  );
}

if (reasons.size > 0) {
  console.log("\n── notes the plan reported");
  for (const [reason, { count, example }] of reasons) {
    console.log(`   ${count}× ${reason}\n        e.g. ${example}`);
  }
}

if (rescues.size > 0) {
  console.log("\n── values with no column, kept as custom fields");
  for (const [key, { count, example }] of rescues) {
    console.log(`   ${count}× ${key}\n        e.g. ${example}`);
  }
}

if (losers.length > 0) {
  console.log(`\n── ${losers.length} FIELD(S) A PUSH WOULD CLEAR`);
  for (const l of losers.slice(0, 40)) {
    console.log(`   ✗ ${l.name} — ${l.field} — Google has ${l.had}`);
  }
  if (losers.length > 40) console.log(`   … and ${losers.length - 40} more (see plan-${slot}.json)`);
}

writeFileSync(
  path.join(OUT_DIR, `plan-${slot}.json`),
  JSON.stringify(plan, null, 2),
);

const totalCleared = [...fieldVerdicts.values()].reduce((n, v) => n + v.cleared, 0);
const totalRewritten = [...fieldVerdicts.values()].reduce((n, v) => n + v.rewritten, 0);
console.log(
  `\n=== ${totalCleared} field group(s) would be cleared, ${totalRewritten} rewritten, ` +
    `across ${plan.contacts.length} contacts ===`,
);
console.log("Nothing was written to Google. `hearth_id` is expected under userDefined.\n");
