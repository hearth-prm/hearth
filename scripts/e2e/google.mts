/**
 * The half of docs/verify-0.5.0.md that needs real Google accounts: §3 in full, plus
 * 6.5, 7.20, 9.3, 9.4 and 9.7.
 *
 *   npm run e2e:google
 *
 * Reads two refresh tokens from .env.e2e (see `npm run token`). Drives Hearth's own
 * sync engine with real PeopleClients and then asks Google what actually happened —
 * which is the entire point, because a fake client can only ever confirm that Hearth
 * is self-consistent with my beliefs about the People API.
 *
 * DESTRUCTIVE. It deletes contacts and Hearth-created contact groups in both accounts
 * so each run starts from a known-empty state. The guard below refuses to touch an
 * account that looks like a real address book, since the cost of getting that wrong is
 * somebody's contacts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { createPeopleClient, type PeopleClient } from "@/lib/google/people-client";
import { GOOGLE_SCOPES } from "@/lib/google/scopes";
import { startDatabase, ok, section, report } from "./harness.mts";
import { makePng } from "./png.mts";

const ENV_FILE = path.join(process.cwd(), ".env.e2e");

/** An account that holds more than this is not a throwaway. Refuse rather than wipe. */
const MAX_EXISTING_CONTACTS = 25;
const MAX_EXISTING_GROUPS = 12;

function readEnv(): Map<string, string> {
  if (!existsSync(ENV_FILE)) {
    console.error(`No ${ENV_FILE}. Run \`npm run token -- A\` and \`-- B\` first.`);
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

const env = readEnv();
const clientId = env.get("E2E_GOOGLE_CLIENT_ID");
const clientSecret = env.get("E2E_GOOGLE_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error("E2E_GOOGLE_CLIENT_ID / _SECRET missing from .env.e2e");
  process.exit(1);
}

interface Account {
  slot: "A" | "B";
  email: string;
  people: PeopleClient;
}

async function buildAccount(slot: "A" | "B"): Promise<Account> {
  const token = env.get(`E2E_REFRESH_TOKEN_${slot}`);
  if (!token) {
    console.error(`E2E_REFRESH_TOKEN_${slot} missing. Run \`npm run token -- ${slot}\`.`);
    process.exit(1);
  }
  const auth = new google.auth.OAuth2({ clientId, clientSecret });
  auth.setCredentials({ refresh_token: token, scope: GOOGLE_SCOPES.join(" ") });
  return { slot, email: env.get(`E2E_EMAIL_${slot}`) ?? `account ${slot}`, people: createPeopleClient(auth) };
}

/**
 * Empty an account, refusing if it does not look disposable.
 *
 * Only user-created groups are listed by listContactGroups, so the system groups —
 * myContacts, starred — are out of reach here by construction.
 */
async function wipe(acct: Account): Promise<void> {
  const contacts = await acct.people.listConnections(["names", "metadata"]);
  const groups = await acct.people.listContactGroups();

  if (contacts.length > MAX_EXISTING_CONTACTS || groups.length > MAX_EXISTING_GROUPS) {
    console.error(`
REFUSING to run against ${acct.email}.

It holds ${contacts.length} contacts and ${groups.length} labels, which is more than a
throwaway test account should. This suite deletes contacts and labels, so it will not
touch an account that might be somebody's real address book.

If this really is a test account, clear it by hand and run again.
`);
    process.exit(1);
  }

  for (const c of contacts) {
    if (c.resourceName) await acct.people.deleteContact(c.resourceName).catch(() => {});
  }
  for (const g of groups) {
    await acct.people.deleteContactGroup(g.resourceName).catch(() => {});
  }
}

const A = await buildAccount("A");
const B = await buildAccount("B");

console.log(`\nA = ${A.email}\nB = ${B.email}`);
if (A.email === B.email) {
  console.error("\nBoth tokens point at the same account. §3 would pass while proving nothing.");
  process.exit(1);
}

console.log("\nClearing both accounts…");
await wipe(A);
await wipe(B);
console.log("Both accounts empty.\n");

const db = await startDatabase();
const { prisma } = db;

// Imported only now: the sync engine pulls in the app's shared Prisma client, which
// reads DATABASE_URL when its module is first evaluated. A static import at the top of
// this file would be evaluated before the database it needs exists.
const { syncContactsForUser, summarise } = await import("@/lib/sync/contacts");
// The app's own client is a separate instance from the harness's, and has to be closed
// before Postgres stops or teardown ends in a page of connection-reset noise.
const { prisma: appPrisma } = await import("@/lib/db");

/** Poll Google until a condition holds — writes are not instantly readable. */
async function eventually<T>(
  label: string,
  read: () => Promise<T>,
  holds: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> {
  const started = Date.now();
  let last = await read();
  while (!holds(last) && Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3_000));
    last = await read();
  }
  if (!holds(last)) console.log(`     (gave up waiting for ${label} after ${timeoutMs / 1000}s)`);
  return last;
}

try {
  // Users mirroring the accounts. Tokens are not stored on the Account rows: the
  // engine takes its client as an argument, so the real clients are injected instead.
  const userA = await prisma.user.create({ data: { email: A.email, name: "Account A" } });
  const userB = await prisma.user.create({ data: { email: B.email, name: "Account B" } });
  for (const u of [userA, userB]) {
    await prisma.userSettings.create({
      data: { userId: u.id, syncContactsEnabled: true, timeZone: "UTC" },
    });
  }

  const syncA = () => syncContactsForUser(userA.id, { people: A.people });
  const syncB = () => syncContactsForUser(userB.id, { people: B.people });

  const groupsOf = async (acct: Account) => acct.people.listContactGroups();
  const groupNamed = async (acct: Account, name: string) =>
    (await groupsOf(acct)).find((g) => g.name.toLowerCase() === name.toLowerCase());
  /** Which contacts are in a named group, by display name. */
  const membersOf = async (acct: Account, name: string): Promise<string[]> => {
    const g = await groupNamed(acct, name);
    if (!g) return [];
    const people = await acct.people.listConnections(["names", "memberships"]);
    return people
      .filter((p) =>
        (p.memberships ?? []).some(
          (m) => m.contactGroupMembership?.contactGroupResourceName === g.resourceName,
        ),
      )
      .map((p) => p.names?.[0]?.displayName ?? "?");
  };
  const inMyContacts = async (acct: Account, displayName: string): Promise<boolean> => {
    const people = await acct.people.listConnections(["names", "memberships"]);
    const person = people.find((p) => p.names?.[0]?.displayName === displayName);
    return (person?.memberships ?? []).some(
      (m) => m.contactGroupMembership?.contactGroupResourceName === "contactGroups/myContacts",
    );
  };

  // ════════════════════════════════════════════════════════════════════════
  section("§3 Labels in Google Contacts");

  const family = await prisma.label.create({ data: { ownerId: userA.id, name: "Family" } });
  const unused = await prisma.label.create({ data: { ownerId: userA.id, name: "Never Applied" } });

  const shared = await prisma.person.create({
    data: {
      ownerId: userA.id, displayName: "Shared Sam", givenName: "Shared", familyName: "Sam",
      addToGoogle: true,
      contactPoints: { create: [{ kind: "EMAIL", value: "shared-sam@example.test" }] },
      labels: { create: [{ labelId: family.id }] },
    },
  });
  await prisma.share.create({
    data: { ownerId: userA.id, withUserId: userB.id, personId: shared.id, scope: "PERSON", permission: "EDIT" },
  });

  let rA = await syncA();
  ok("3.1 sync reports no errors for A", rA.errors.length === 0, rA.errors);
  const famA = await eventually("A's Family group", () => groupNamed(A, "Family"), (g) => Boolean(g));
  ok("3.1b A's Google has a Family label", Boolean(famA), famA?.name);
  const famMembersA = await eventually("A's Family members", () => membersOf(A, "Family"), (m) => m.length === 1);
  ok("3.1c with the contact in it", famMembersA.includes("Shared Sam"), famMembersA);

  ok("3.2 the contact is STILL in My Contacts", await inMyContacts(A, "Shared Sam"));

  // 3.3 — a group Hearth has never heard of must survive a sync.
  const handMade = await A.people.createContactGroup("Made By Hand");
  const sammy = (await A.people.listConnections(["names", "metadata"]))
    .find((p) => p.names?.[0]?.displayName === "Shared Sam");
  await A.people.modifyGroupMembers({
    resourceName: handMade.resourceName,
    add: [sammy!.resourceName!],
    remove: [],
  });
  await prisma.person.update({ where: { id: shared.id }, data: { notes: "touched" } });
  await prisma.personSync.updateMany({ where: { personId: shared.id }, data: { googleSyncStatus: "PENDING" } });
  rA = await syncA();
  const handMembers = await membersOf(A, "Made By Hand");
  ok("3.3 a group Hearth did not create survives a sync", handMembers.includes("Shared Sam"), handMembers);
  ok("3.3b and Hearth's own group still holds the contact",
     (await membersOf(A, "Family")).includes("Shared Sam"));
  ok("3.3c still in My Contacts after a second push", await inMyContacts(A, "Shared Sam"));

  const rB = await syncB();
  ok("3.4 sync reports no errors for B", rB.errors.length === 0, rB.errors);
  const famB = await eventually("B's Family group", () => groupNamed(B, "Family"), (g) => Boolean(g));
  ok("3.4b B's Google has its OWN Family label", Boolean(famB), famB?.name);
  const famMembersB = await eventually("B's Family members", () => membersOf(B, "Family"), (m) => m.length === 1);
  ok("3.4c containing the shared contact", famMembersB.includes("Shared Sam"), famMembersB);

  ok("3.5 the two Family labels are different Google resources",
     Boolean(famA && famB) && famA!.resourceName !== famB!.resourceName,
     { a: famA?.resourceName, b: famB?.resourceName });
  const links = await prisma.labelGroup.findMany({ where: { labelId: family.id } });
  ok("3.5b one LabelGroup row per account", links.length === 2, links.length);

  ok("3.6 a label with no contacts creates no Google group",
     !(await groupNamed(A, "Never Applied")), (await groupsOf(A)).map((g) => g.name));

  // 3.7 — un-labelling removes membership.
  await prisma.personLabel.deleteMany({ where: { personId: shared.id } });
  await prisma.personSync.updateMany({ where: { personId: shared.id }, data: { googleSyncStatus: "PENDING" } });
  await syncA();
  const afterUnlabel = await eventually("Family to empty", () => membersOf(A, "Family"), (m) => m.length === 0);
  ok("3.7 removing a label removes group membership", afterUnlabel.length === 0, afterUnlabel);
  ok("3.7b the contact itself is still there",
     (await A.people.listConnections(["names"])).some((p) => p.names?.[0]?.displayName === "Shared Sam"));

  // 3.8 — renaming renames the Google group rather than duplicating it.
  await prisma.personLabel.create({ data: { personId: shared.id, labelId: family.id } });
  await prisma.label.update({ where: { id: family.id }, data: { name: "Household" } });
  await prisma.labelGroup.updateMany({ where: { labelId: family.id }, data: { googleSyncedAt: null } });
  await prisma.personSync.updateMany({ where: { personId: shared.id }, data: { googleSyncStatus: "PENDING" } });
  await syncA();
  const household = await eventually("the rename", () => groupNamed(A, "Household"), (g) => Boolean(g));
  ok("3.8 renaming a label renames the Google group", Boolean(household), (await groupsOf(A)).map((g) => g.name));
  ok("3.8b and leaves no group under the old name", !(await groupNamed(A, "Family")));

  // 3.9 — adoption. Create the group by hand FIRST, then let Hearth take it over.
  const preexisting = await B.people.createContactGroup("Neighbours");
  const neighbours = await prisma.label.create({ data: { ownerId: userA.id, name: "Neighbours" } });
  await prisma.personLabel.create({ data: { personId: shared.id, labelId: neighbours.id } });
  await prisma.personSync.updateMany({ where: { personId: shared.id }, data: { googleSyncStatus: "PENDING" } });
  await syncB();
  const adopted = await prisma.labelGroup.findFirst({ where: { labelId: neighbours.id, userId: userB.id } });
  ok("3.9 an existing Google label of the same name is adopted",
     adopted?.googleResourceName === preexisting.resourceName,
     { adopted: adopted?.googleResourceName, preexisting: preexisting.resourceName });
  ok("3.9b exactly one Neighbours group exists in B",
     (await groupsOf(B)).filter((g) => g.name === "Neighbours").length === 1,
     (await groupsOf(B)).map((g) => g.name));

  // 3.15 — several labels at once (done before deletion, which consumes 3.10).
  const extra = [];
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const l = await prisma.label.create({ data: { ownerId: userA.id, name } });
    extra.push(l);
    await prisma.personLabel.create({ data: { personId: shared.id, labelId: l.id } });
  }
  await prisma.personSync.updateMany({ where: { personId: shared.id }, data: { googleSyncStatus: "PENDING" } });
  await syncA();
  const allPresent = await eventually(
    "all five groups",
    async () => (await groupsOf(A)).map((g) => g.name),
    (names) => ["Household", "Neighbours", "Alpha", "Beta", "Gamma"].every((n) => names.includes(n)),
  );
  ok("3.15 five labels on one contact create five groups",
     ["Household", "Neighbours", "Alpha", "Beta", "Gamma"].every((n) => allPresent.includes(n)),
     allPresent);
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    ok(`3.15b the contact is in ${name}`, (await membersOf(A, name)).includes("Shared Sam"));
  }

  ok("3.12 the run summary reports label work",
     /label/i.test(summarise(rA)) || rA.groupsTouched > 0, summarise(rA));

  // 3.10 / 3.11 — deleting a label removes the Google group but keeps its contacts.
  const householdGroups = await prisma.labelGroup.findMany({ where: { labelId: family.id } });
  await prisma.$transaction(async (tx) => {
    for (const g of householdGroups) {
      await tx.syncTombstone.create({
        data: {
          ownerId: g.userId, target: "GOOGLE_CONTACT_GROUP",
          resourceId: g.googleResourceName, etag: g.googleEtag, reason: "deleted",
        },
      });
    }
    await tx.label.delete({ where: { id: family.id } });
  });
  await syncA();
  await syncB();
  const goneA = await eventually("Household to vanish", () => groupNamed(A, "Household"), (g) => !g);
  ok("3.10 deleting a Hearth label deletes the Google group in A", !goneA, goneA?.name);
  ok("3.10b and in B", !(await groupNamed(B, "Household")), (await groupsOf(B)).map((g) => g.name));
  ok("3.11 the contacts that were in it are still present",
     (await A.people.listConnections(["names"])).some((p) => p.names?.[0]?.displayName === "Shared Sam"));
  ok("3.11b and still in My Contacts", await inMyContacts(A, "Shared Sam"));
  ok("3.11c and still in the groups that were not deleted",
     (await membersOf(A, "Alpha")).includes("Shared Sam"));

  // 3.14 — a recipient who declines shared contacts gets no labels either.
  await prisma.userSettings.update({
    where: { userId: userB.id }, data: { syncSharedContacts: false },
  });
  const { reapSharedCopies } = await import("@/lib/sync/reap");
  await reapSharedCopies(userB.id);
  await syncB();
  const bContacts = await eventually(
    "B's copy to go",
    async () => (await B.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (names) => !names.includes("Shared Sam"),
  );
  ok("3.14 declining shared contacts removes B's copy", !bContacts.includes("Shared Sam"), bContacts);
  ok("3.14b A's copy is untouched",
     (await A.people.listConnections(["names"])).some((p) => p.names?.[0]?.displayName === "Shared Sam"));
  await prisma.userSettings.update({
    where: { userId: userB.id }, data: { syncSharedContacts: true },
  });

  // ════════════════════════════════════════════════════════════════════════
  section("§12 Photos reaching Google");

  /** Whether a contact in this account currently has a photo Google will serve. */
  const photoUrlOf = async (acct: Account, displayName: string): Promise<string | null> => {
    const people = await acct.people.listConnections(["names", "photos"]);
    const person = people.find((p) => p.names?.[0]?.displayName === displayName);
    // Google always reports a default silhouette; only a real upload is not "default".
    const real = (person?.photos ?? []).find((ph) => ph.default !== true);
    return real?.url ?? null;
  };

  const photoTarget = await prisma.person.create({
    data: {
      ownerId: userA.id, displayName: "Photo Pam", givenName: "Photo", familyName: "Pam",
      addToGoogle: true,
    },
  });
  await prisma.share.create({
    data: { ownerId: userA.id, withUserId: userB.id, personId: photoTarget.id, scope: "PERSON", permission: "EDIT" },
  });

  const ownerBytes = makePng(16, [10, 120, 220]);
  await prisma.personPhoto.create({
    data: {
      personId: photoTarget.id, userId: userA.id,
      data: new Uint8Array(ownerBytes), mimeType: "image/png",
      width: 16, height: 16, etag: "ownerphoto1",
    },
  });

  let r = await syncA();
  ok("12.1 the push reports no errors", r.errors.length === 0, r.errors);
  ok("12.1b and counts a photo", r.photosPushed >= 1, r.photosPushed);
  const pamA = await eventually("A's photo", () => photoUrlOf(A, "Photo Pam"), (u) => Boolean(u));
  ok("12.1c the contact has a real photo in A's Google", Boolean(pamA), pamA);

  await syncB();
  const pamB = await eventually("B's inherited photo", () => photoUrlOf(B, "Photo Pam"), (u) => Boolean(u));
  ok("12.2 the owner's photo flows through to a recipient's Google", Boolean(pamB), pamB);

  // An unchanged photo must not be re-uploaded on every run.
  const quietPhoto = await syncA();
  ok("12.3 an unchanged photo is not pushed again", quietPhoto.photosPushed === 0, quietPhoto.photosPushed);

  // B's own picture replaces it for B alone.
  await prisma.personPhoto.create({
    data: {
      personId: photoTarget.id, userId: userB.id,
      data: new Uint8Array(makePng(16, [230, 200, 20])), mimeType: "image/png",
      width: 16, height: 16, etag: "bphoto1",
    },
  });
  await prisma.personSync.updateMany({
    where: { personId: photoTarget.id }, data: { googleSyncStatus: "PENDING" },
  });
  const rb = await syncB();
  ok("12.4 a recipient's own photo is pushed to their account", rb.photosPushed >= 1, rb.photosPushed);
  const bSync = await prisma.personSync.findFirstOrThrow({
    where: { personId: photoTarget.id, userId: userB.id },
  });
  const aSync = await prisma.personSync.findFirstOrThrow({
    where: { personId: photoTarget.id, userId: userA.id },
  });
  ok("12.4b each account records a different photo etag",
     bSync.googlePhotoEtag === "bphoto1" && aSync.googlePhotoEtag === "ownerphoto1",
     { a: aSync.googlePhotoEtag, b: bSync.googlePhotoEtag });
  ok("12.4c and A's Google still has a photo", Boolean(await photoUrlOf(A, "Photo Pam")));

  // Removing a photo removes it from Google rather than leaving a stale one.
  await prisma.personPhoto.deleteMany({ where: { personId: photoTarget.id, userId: userB.id } });
  await prisma.personSync.updateMany({
    where: { personId: photoTarget.id, userId: userB.id }, data: { googleSyncStatus: "PENDING" },
  });
  await syncB();
  const backToOwner = await prisma.personSync.findFirstOrThrow({
    where: { personId: photoTarget.id, userId: userB.id },
  });
  ok("12.5 clearing an override falls back to the owner's photo in Google",
     backToOwner.googlePhotoEtag === "ownerphoto1", backToOwner.googlePhotoEtag);

  await prisma.personPhoto.deleteMany({ where: { personId: photoTarget.id } });
  await prisma.personSync.updateMany({
    where: { personId: photoTarget.id }, data: { googleSyncStatus: "PENDING" },
  });
  await syncA();
  const cleared = await eventually("A's photo to go", () => photoUrlOf(A, "Photo Pam"), (u) => !u);
  ok("12.6 removing the last photo removes it from Google", !cleared, cleared);
  ok("12.6b the contact itself survives",
     (await A.people.listConnections(["names"])).some((p) => p.names?.[0]?.displayName === "Photo Pam"));

  // ════════════════════════════════════════════════════════════════════════
  section("§9 Google-dependent regressions, and 6.5 / 7.20");

  // 9.7 — a second run with nothing changed must write nothing.
  const quiet = await syncA();
  ok("9.7 a no-change run creates and updates nothing",
     quiet.created === 0 && quiet.updated === 0, { created: quiet.created, updated: quiet.updated });
  ok("9.7b and touches no groups", quiet.groupsTouched === 0, quiet.groupsTouched);
  ok("9.7c and reports no errors", quiet.errors.length === 0, quiet.errors);

  // 9.3 — unticking Add to Google removes the contact from every account.
  const optOut = await prisma.person.create({
    data: {
      ownerId: userA.id, displayName: "Optout Olive", givenName: "Optout", familyName: "Olive",
      addToGoogle: true, labels: { create: [{ labelId: extra[0]!.id }] },
    },
  });
  await syncA();
  await eventually("Olive to appear",
    async () => (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (n) => n.includes("Optout Olive"));
  const { queueContactDeletionEverywhere } = await import("@/lib/sync/tombstones");
  await prisma.$transaction(async (tx) => {
    await queueContactDeletionEverywhere(tx, { personId: optOut.id, reason: "opted_out" });
    await tx.person.update({ where: { id: optOut.id }, data: { addToGoogle: false } });
  });
  await syncA();
  const afterOptOut = await eventually("Olive to go",
    async () => (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (n) => !n.includes("Optout Olive"));
  ok("9.3 unticking Add to Google removes the contact", !afterOptOut.includes("Optout Olive"), afterOptOut);
  ok("9.3b and from the label it was in", !(await membersOf(A, "Alpha")).includes("Optout Olive"));
  ok("9.3c the label itself survives", Boolean(await groupNamed(A, "Alpha")));

  // 9.4 — deleting a labelled contact removes it from Google, label intact.
  const doomed = await prisma.person.create({
    data: {
      ownerId: userA.id, displayName: "Doomed Dave", givenName: "Doomed", familyName: "Dave",
      addToGoogle: true, labels: { create: [{ labelId: extra[1]!.id }] },
    },
  });
  await syncA();
  await eventually("Dave to appear",
    async () => (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (n) => n.includes("Doomed Dave"));
  await prisma.$transaction(async (tx) => {
    await queueContactDeletionEverywhere(tx, { personId: doomed.id, reason: "deleted" });
    await tx.person.delete({ where: { id: doomed.id } });
  });
  await syncA();
  const afterDelete = await eventually("Dave to go",
    async () => (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (n) => !n.includes("Doomed Dave"));
  ok("9.4 deleting a labelled contact removes it from Google", !afterDelete.includes("Doomed Dave"), afterDelete);
  ok("9.4b the label survives the contact", Boolean(await groupNamed(A, "Beta")));

  // 6.5 / 7.20 — contacts that arrive by import reach Google, with their labels.
  const imported = await prisma.person.create({
    data: {
      ownerId: userA.id, displayName: "Imported Ivy", givenName: "Imported", familyName: "Ivy",
      addToGoogle: true, labels: { create: [{ labelId: extra[2]!.id }] },
      contactPoints: { create: [{ kind: "EMAIL", value: "ivy@example.test" }] },
    },
  });
  await syncA();
  const ivyNames = await eventually("Ivy to appear",
    async () => (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName),
    (n) => n.includes("Imported Ivy"));
  ok("7.20 a contact added outside the UI reaches Google", ivyNames.includes("Imported Ivy"), ivyNames);
  ok("7.20b with its label applied", (await membersOf(A, "Gamma")).includes("Imported Ivy"));

  const dupes = ivyNames.filter((n) => n === "Imported Ivy").length;
  ok("6.5 no duplicate was created", dupes === 1, dupes);
  await syncA();
  const afterSecond = (await A.people.listConnections(["names"])).map((p) => p.names?.[0]?.displayName);
  ok("6.5b nor by a second sync", afterSecond.filter((n) => n === "Imported Ivy").length === 1);
  void imported;
} finally {
  console.log("\nClearing both accounts…");
  await wipe(A).catch(() => {});
  await wipe(B).catch(() => {});
  await appPrisma.$disconnect().catch(() => {});
  await db.stop();
}

process.exit(report());
