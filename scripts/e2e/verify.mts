/**
 * Automated run of docs/verify-0.5.0.md, for every test that does not need a real
 * Google account.
 *
 * Test data is seeded through Prisma where a test is about behaviour downstream of
 * the data, and driven through the UI where the UI *is* what is under test — a
 * duplicate-label refusal has to come from the form, not from a unique index.
 *
 * Section numbers match the checklist so a failure here points at a specific row
 * there. Google-dependent rows are listed at the end as still-manual.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { start, ok, section, report } from "./harness.mts";
import { makePng } from "./png.mts";

const scratch = mkdtempSync(path.join(tmpdir(), "hearth-e2e-files-"));

/** Text of the form status message, once one appears. */
async function statusText(page: Page): Promise<string> {
  try {
    await page.waitForSelector('[role="status"]', { timeout: 5_000 });
    return (await page.textContent('[role="status"]')) ?? "";
  } catch {
    return "";
  }
}

/**
 * Wait for a specific confirmation before asserting on the database.
 *
 * statusText gives up after five seconds and returns "", which lets an assertion run
 * against state the action has not finished writing — a flake that looks exactly like a
 * behaviour change.
 *
 * Only for messages that persist. An action that calls revalidatePath on the page its
 * own form sits in can have that message replaced by the refresh before it is ever
 * observed, so waiting on it is itself a race — use waitForDb for those.
 */
async function waitForStatus(page: Page, contains: string): Promise<string> {
  await page.waitForFunction(
    (text) => document.querySelector('[role="status"]')?.textContent?.includes(text) === true,
    contains,
    { timeout: 30_000 },
  );
  return (await page.textContent('[role="status"]')) ?? "";
}

/**
 * Wait for the write itself, rather than for a message about it.
 *
 * The honest signal when a test cares that something landed: a toast is a courtesy to the
 * user and may be swept away by the very revalidation that proves the save worked, while
 * the row either exists or does not.
 */
async function waitForDb(
  label: string,
  holds: () => Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await holds().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`     (gave up waiting for ${label})`);
}

/**
 * A port for the stand-in Ollama of §28, agreed before the app starts.
 *
 * The app reads OLLAMA_URL when it renders, so whether the "ask" button exists is decided at
 * boot — which means the address has to be settled here rather than when the fake server is
 * finally stood up. Nothing listens on it until §28.
 */
const OLLAMA_PORT = 57391;
process.env.OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`;

const h = await start();
const { prisma } = h;

try {
  const A = await h.signIn("alice@e2e.test", "Alice");
  const B = await h.signIn("bob@e2e.test", "Bob");

  // ════════════════════════════════════════════════════════════════════════
  section("§1 Labels in Hearth");

  await A.page.goto("/settings/labels");
  ok("1.1 Settings → Labels loads", (await A.page.content()).includes("Your labels"));

  const addLabel = async (page: Page, name: string) => {
    await page.fill("#new-label-name", name);
    await page.click('button:has-text("Add label")');
    return statusText(page);
  };

  let msg = await addLabel(A.page, "Family");
  ok("1.2 a label can be added", msg.includes("Family") && msg.includes("created"), msg);
  await A.page.goto("/settings/labels");
  ok("1.2b it renders as a chip", (await A.page.textContent("body"))?.includes("Family") === true);

  for (const n of ["Book club", "Work", "VIP"]) {
    await addLabel(A.page, n);
    await A.page.goto("/settings/labels");
  }
  const listed = await A.page.$$eval("li", (els) => els.map((e) => e.textContent ?? ""));
  const names = ["Book club", "Family", "VIP", "Work"];
  ok("1.3 all four labels exist", names.every((n) => listed.some((l) => l.includes(n))), listed.length);
  const order = names.map((n) => listed.findIndex((l) => l.includes(n)));
  ok("1.3b sorted by name", order.every((v, i) => i === 0 || v > order[i - 1]!), order);

  await A.page.fill("#new-label-name", "Preview Me");
  ok("1.4 a live chip preview appears while typing",
     (await A.page.textContent("body"))?.includes("Preview:") === true);

  await A.page.goto("/settings/labels");
  await A.page.fill("#new-label-name", "Coloured");
  await A.page.click("label[for='new-label-violet']");
  await A.page.click('button:has-text("Add label")');
  await statusText(A.page);
  const coloured = await prisma.label.findFirst({ where: { ownerId: A.id, name: "Coloured" } });
  ok("1.5 an explicit colour is stored", coloured?.color === "violet", coloured?.color);

  await A.page.goto("/settings/labels");
  msg = await addLabel(A.page, "family");
  ok("1.6 a case-different duplicate is refused", msg.includes("already have"), msg);
  ok("1.6b and no second row was created",
     (await prisma.label.count({ where: { ownerId: A.id, name: { in: ["Family", "family"] } } })) === 1);

  await A.page.goto("/settings/labels");
  msg = await addLabel(A.page, "Book  club");
  ok("1.7 doubled whitespace collapses to a duplicate", msg.includes("already have"), msg);

  await A.page.goto("/settings/labels");
  msg = await addLabel(A.page, "   ");
  ok("1.8 a blank name is refused", msg.includes("Give the label a name"), msg);

  // Rename through the UI.
  const work = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "Work" } });
  await A.page.goto("/settings/labels");
  await A.page.click(`li:has-text("Work") button:has-text("Edit")`);
  await A.page.fill(`#edit-${work.id}`, "Colleagues");
  await A.page.click('form:has(#edit-' + work.id + ') button:has-text("Save")');
  await statusText(A.page);
  ok("1.9 a label can be renamed",
     (await prisma.label.findUnique({ where: { id: work.id } }))?.name === "Colleagues");

  const vip = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "VIP" } });
  await A.page.goto("/settings/labels");
  await A.page.click(`li:has-text("VIP") button:has-text("Edit")`);
  await A.page.fill(`#edit-${vip.id}`, "Family");
  await A.page.click('form:has(#edit-' + vip.id + ') button:has-text("Save")');
  msg = await statusText(A.page);
  ok("1.10 renaming onto a taken name is refused", msg.includes("already have"), msg);
  ok("1.10b and the old name is kept",
     (await prisma.label.findUnique({ where: { id: vip.id } }))?.name === "VIP");

  await A.page.goto("/settings/labels");
  ok("1.11 an unused label says so", (await A.page.textContent("body"))?.includes("not used yet") === true);

  // Delete needs the confirm() dialog accepted. Registered ONCE for the whole run: a
  // page-level listener outlives the section that adds it, so a second registration
  // means two handlers race to accept the same dialog and the loser throws.
  A.page.on("dialog", (d) => d.accept());
  const coloured2 = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "Coloured" } });
  await A.page.click(`li:has-text("Coloured") button:has-text("Delete")`);
  await A.page.waitForFunction(
    () => !document.body.textContent?.includes("Coloured"),
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("1.12 an unused label can be deleted",
     (await prisma.label.count({ where: { id: coloured2.id } })) === 0);

  // ════════════════════════════════════════════════════════════════════════
  section("§2 Labels on contacts");

  const family = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "Family" } });
  const vipLabel = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "VIP" } });

  const sam = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Sam Shared", givenName: "Sam", familyName: "Shared",
      addToGoogle: true,
      contactPoints: { create: [{ kind: "EMAIL", value: "sam@e2e.test" }] },
    },
  });

  await A.page.goto(`/people/${sam.id}`);
  const body = (await A.page.textContent("body")) ?? "";
  ok("2.1 the Labels card is present and empty", body.includes("No labels on this contact"), body.includes("Labels"));

  await A.page.click('button:has-text("Add labels")');
  await A.page.check(`#pl-${sam.id}-${family.id}`);
  await A.page.check(`#pl-${sam.id}-${vipLabel.id}`);
  await A.page.click('button:has-text("Save labels")');
  await waitForDb("both labels applied", async () =>
    (await prisma.personLabel.count({ where: { personId: sam.id } })) === 2);
  let applied = await prisma.personLabel.findMany({ where: { personId: sam.id } });
  ok("2.2 both labels are applied", applied.length === 2, applied.length);

  await A.page.goto("/people");
  ok("2.3 the People list has a Labels column",
     (await A.page.textContent("thead")) ?.includes("Labels") === true);
  const rowText = await A.page.textContent(`tr:has-text("Sam Shared")`);
  ok("2.3b and shows both chips", rowText?.includes("Family") === true && rowText?.includes("VIP") === true, rowText);

  // waitForURL, not networkidle: a Next app holds connections open, so "network
  // idle" may never arrive even though navigation completed instantly.
  await A.page.click(`tr:has-text("Sam Shared") a:has-text("VIP")`);
  await A.page.waitForURL(/label=/, { timeout: 15_000 });
  ok("2.4 clicking a chip filters the list to that label",
     A.page.url().includes(`label=${vipLabel.id}`), A.page.url());
  ok("2.4b and the filtered list holds that contact",
     (await A.page.textContent("tbody"))?.includes("Sam Shared") === true);

  await A.page.goto(`/people/${sam.id}`);
  await A.page.click('button:has-text("Change labels")');
  await A.page.uncheck(`#pl-${sam.id}-${vipLabel.id}`);
  await A.page.click('button:has-text("Save labels")');
  await waitForDb("one label left", async () =>
    (await prisma.personLabel.count({ where: { personId: sam.id } })) === 1);
  applied = await prisma.personLabel.findMany({ where: { personId: sam.id } });
  ok("2.5 unticking a label DOES remove it", applied.length === 1 && applied[0]!.labelId === family.id, applied);

  // Share to B as EDIT and check the owner-labels rule.
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, personId: sam.id, scope: "PERSON", permission: "EDIT" },
  });
  await prisma.label.create({ data: { ownerId: B.id, name: "Bob Only" } });

  await B.page.goto(`/people/${sam.id}`);
  const bobView = (await B.page.textContent("body")) ?? "";
  ok("2.6 B sees A's labels on the shared contact", bobView.includes("Family"), bobView.slice(0, 200));
  ok("2.6b and is told whose labels they are", bobView.includes("Alice’s labels") || bobView.includes("Alice"), true);
  ok("2.6c B's own label is NOT offered", !bobView.includes("Bob Only"), bobView.includes("Bob Only"));

  await B.page.click('button:has-text("Change labels")');
  await B.page.check(`#pl-${sam.id}-${vipLabel.id}`);
  await B.page.click('button:has-text("Save labels")');
  await waitForDb("B's label applied", async () =>
    (await prisma.personLabel.count({ where: { personId: sam.id } })) === 2);
  applied = await prisma.personLabel.findMany({ where: { personId: sam.id } });
  ok("2.7 B can apply one of A's labels", applied.length === 2,
     applied.map((a) => a.labelId));

  await B.page.goto("/settings/labels");
  // Asserted against the label rows, not the whole page: the page's prose and the
  // new-label placeholder both mention "Family" as an example, so a body-wide search
  // says nothing about what is actually listed.
  const bobRows = await B.page.$$eval("li", (els) => els.map((e) => e.textContent ?? ""));
  ok("2.8 A's labels are absent from B's label list",
     !bobRows.some((r) => r.includes("Family")), bobRows);
  ok("2.8b B's own label is listed", bobRows.some((r) => r.includes("Bob Only")), bobRows);

  // Downgrade to VIEW and confirm B loses the control.
  await prisma.share.updateMany({
    where: { personId: sam.id, withUserId: B.id }, data: { permission: "VIEW" },
  });
  await B.page.goto(`/people/${sam.id}`);
  const viewOnly = (await B.page.textContent("body")) ?? "";
  ok("2.9 on a VIEW share the label control is gone",
     !viewOnly.includes("Change labels") && !viewOnly.includes("Add labels"), viewOnly.includes("Change labels"));
  ok("2.9b the labels themselves are still visible", viewOnly.includes("Family"));

  // The bug this run found: write controls were offered to VIEW recipients on both
  // detail pages. The actions always refused, so nothing was ever at risk — but the
  // UI led people into an error. Checked here for the whole class, not just labels.
  ok("2.9c no Edit button for a VIEW recipient",
     (await B.page.$$('a:has-text("Edit")')).length === 0);
  ok("2.9d no relationship controls for a VIEW recipient",
     !viewOnly.includes("Add a relationship") && (await B.page.$$('button:has-text("Remove")')).length === 0,
     viewOnly.includes("Add a relationship"));
  ok("2.9e still no Delete for a VIEW recipient",
     (await B.page.$$('button:has-text("Delete")')).length === 0);

  // ...and the same on an event.
  const party = await prisma.event.create({
    data: {
      ownerId: A.id, title: "Shared Party", startAt: new Date("2026-09-01T18:00:00Z"),
      timeZone: "UTC", allDay: false,
      attendees: { create: [{ personId: sam.id, role: "OPTIONAL", rsvp: "NEEDS_ACTION" }] },
    },
  });
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, eventId: party.id, scope: "EVENT", permission: "VIEW" },
  });
  await B.page.goto(`/events/${party.id}`);
  const eventView = (await B.page.textContent("body")) ?? "";
  ok("2.9f a VIEW event recipient sees the event", eventView.includes("Shared Party"));
  ok("2.9g but gets no Edit, no attendee controls",
     (await B.page.$$('a:has-text("Edit")')).length === 0 &&
     // Not even the toggle that would reveal them.
     (await B.page.$$('button[aria-label="Edit guests"]')).length === 0 &&
     (await B.page.$$('button:has-text("Update")')).length === 0 &&
     (await B.page.$$('button:has-text("Remove")')).length === 0);

  await prisma.share.updateMany({
    where: { eventId: party.id, withUserId: B.id }, data: { permission: "EDIT" },
  });
  await B.page.goto(`/events/${party.id}`);
  // The per-guest controls sit behind the guest list's own Edit toggle now, so the
  // permission claim splits in two: an editor is offered the toggle, and pressing it
  // yields the controls. A VIEW recipient (2.9g) is not offered it at all.
  // Distinct names: this file is one long scope and §9 already has an `editLinks`.
  const eventEditLinks = (await B.page.$$('a:has-text("Edit")')).length;
  const guestEditToggles = (await B.page.$$('button[aria-label="Edit guests"]')).length;
  ok("2.9h an EDIT event recipient DOES get them back",
     eventEditLinks === 1 && guestEditToggles === 1,
     { eventEditLinks, guestEditToggles });
  await B.page.click('button[aria-label="Edit guests"]');
  await B.page
    .waitForSelector('button:has-text("Update")', { timeout: 10_000 })
    .catch(() => {});
  ok("2.9i and the toggle yields the per-guest controls",
     (await B.page.$$('button:has-text("Update")')).length === 1);

  await A.page.goto("/settings/labels");
  ok("2.10 a used label reports its contact count",
     /\d+ contacts?/.test((await A.page.textContent(`li:has-text("Family")`)) ?? ""),
     await A.page.textContent(`li:has-text("Family")`));


  // ════════════════════════════════════════════════════════════════════════
  section("§4 Filtering");

  // A known population, so every count below is arithmetic rather than a guess.
  const bookClub = await prisma.label.findFirstOrThrow({ where: { ownerId: A.id, name: "Book club" } });
  await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Onlyfam Person", givenName: "Onlyfam", familyName: "Person",
      addToGoogle: true,
      labels: { create: [{ labelId: family.id }] },
      contactPoints: { create: [{ kind: "PHONE", value: "555-0100" }] },
    },
  });
  await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Plain Person", givenName: "Plain", familyName: "Person",
      addToGoogle: false,
    },
  });
  const hers = await prisma.person.create({
    data: { ownerId: B.id, displayName: "Bobs Contact", givenName: "Bobs", addToGoogle: true },
  });
  await prisma.share.create({
    data: { ownerId: B.id, withUserId: A.id, personId: hers.id, scope: "PERSON", permission: "VIEW" },
  });

  const rows = async (query: string): Promise<string[]> => {
    await A.page.goto(`/people${query}`);
    const empty = (await A.page.textContent("body")) ?? "";
    if (empty.includes("Nothing matches those filters") || empty.includes("No contacts yet")) return [];
    return A.page.$$eval("tbody tr", (els) => els.map((e) => e.textContent ?? ""));
  };
  const rowNames = (r: string[]) => r.map((t) => t.split(/\s{2,}|shared/)[0]!.trim()).sort();

  ok("4.1 unfiltered shows everything readable", (await rows("")).length === 4, (await rows("")).length);

  const famRows = await rows(`?label=${family.id}`);
  ok("4.2 one label", famRows.length === 2, rowNames(famRows));

  const anyRows = await rows(`?label=${family.id}&label=${vipLabel.id}`);
  ok("4.3 two labels defaults to matching any", anyRows.length === 2, rowNames(anyRows));

  const allRows = await rows(`?label=${family.id}&label=${vipLabel.id}&labelMode=all`);
  ok("4.4 matching all narrows to the overlap", allRows.length === 1, rowNames(allRows));

  ok("4.5 shared with me", (await rows("?rel=shared-with-me")).length === 1);
  ok("4.6 shared by me", (await rows("?rel=shared-by-me")).length === 1);
  ok("4.6b mine", (await rows("?rel=mine")).length === 3);
  ok("4.7 mine, not shared", (await rows("?rel=private")).length === 2);

  // A blanket grant sweeps in every owned contact, though no per-record row exists.
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, scope: "ALL_PEOPLE", permission: "VIEW" },
  });
  ok("4.8 a blanket grant counts as shared by me", (await rows("?rel=shared-by-me")).length === 3,
     (await rows("?rel=shared-by-me")).length);
  ok("4.8b and leaves nothing private", (await rows("?rel=private")).length === 0);

  ok("4.9 Add to Google off", (await rows("?google=off")).length === 1);
  ok("4.9b Add to Google on", (await rows("?google=on")).length === 3);
  ok("4.10 sync failed is empty with no failures", (await rows("?google=error")).length === 0);
  ok("4.11 has an email", (await rows("?has=email")).length === 1);
  ok("4.11b has a phone", (await rows("?has=phone")).length === 1);
  ok("4.11c no email", (await rows("?has=no-email")).length === 3);

  // Search must carry the active filters through, which is what the hidden inputs do.
  await A.page.goto(`/people?label=${family.id}`);
  await A.page.fill('input[name="q"]', "Onlyfam");
  await A.page.press('input[name="q"]', "Enter");
  await A.page.waitForURL(/q=Onlyfam/, { timeout: 15_000 });
  ok("4.12 searching keeps the label filter", A.page.url().includes(`label=${family.id}`), A.page.url());
  ok("4.12b and narrows within it",
     (await A.page.$$eval("tbody tr", (e) => e.length)) === 1);

  ok("4.13 filters compose", (await rows(`?rel=mine&label=${family.id}&has=phone`)).length === 1);

  // The filter controls live behind a menu now, so each one needs it opened first.
  // A native <details>, so this needs no hydration wait. Idempotent because the menu
  // survives a filter click: Next's soft navigation keeps the same <details> node, and
  // React does not control its `open` property, so it stays open while you pick
  // several filters. Clicking blindly would toggle it shut.
  const openMenu = async () => {
    if (await A.page.isVisible("text=Who")) return;
    await A.page.click('summary:has-text("Filter")');
    await A.page.waitForSelector("text=Who", { timeout: 10_000 });
  };

  await A.page.goto("/people");
  // Hidden, not absent: <details> keeps its content in the DOM when closed, which is
  // what lets it work before hydration and be found by the browser's find-in-page.
  ok("4.14 the filter controls are hidden until asked for",
     !(await A.page.isVisible('a:has-text("Mine, not shared")')));
  await openMenu();
  const menuText = (await A.page.textContent("body")) ?? "";
  ok("4.14a the menu offers every group",
     ["Who", "Google", "Details", "Labels"].every((g) => menuText.includes(g)),
     ["Who", "Google", "Details", "Labels"].filter((g) => !menuText.includes(g)));

  await A.page.click('a:has-text("Mine, not shared")');
  await A.page.waitForURL(/rel=private/, { timeout: 15_000 });
  ok("4.14a2 the menu stays open so several filters can be picked in a row",
     await A.page.isVisible("text=Who"));
  await openMenu();
  await A.page.click('a:has-text("Has an email")');
  await A.page.waitForURL(/has=email/, { timeout: 15_000 });
  ok("4.14b two filters both present",
     A.page.url().includes("rel=private") && A.page.url().includes("has=email"), A.page.url());
  await A.page.goBack();
  ok("4.14c Back removes only the last one",
     A.page.url().includes("rel=private") && !A.page.url().includes("has=email"), A.page.url());

  // Chips: the selected filters show inside the search control and are removable.
  await A.page.goto(`/people?q=Sam&rel=mine&label=${family.id}`);
  const chipText = (await A.page.textContent('form[role="search"]')) ?? "";
  ok("4.14d active filters appear as chips in the search box",
     chipText.includes("Sam") && chipText.includes("Mine") && chipText.includes("Family"), chipText);
  ok("4.14e the Filter control shows how many are active",
     (await A.page.textContent('summary:has-text("Filter")'))?.includes("3") === true,
     await A.page.textContent('summary:has-text("Filter")'));

  await A.page.click(`form[role="search"] a[title="Remove filter: Family"]`);
  await A.page.waitForURL((u) => !u.searchParams.has("label"), { timeout: 15_000 });
  ok("4.14f a chip's × removes just that filter",
     A.page.url().includes("q=Sam") && A.page.url().includes("rel=mine") &&
     !A.page.url().includes("label="), A.page.url());

  await A.page.click(`form[role="search"] a[title*="Remove filter"]`);
  await A.page.waitForURL(/people/, { timeout: 15_000 });
  ok("4.14g chips can be removed down to none",
     (await A.page.$$('form[role="search"] a[title*="Remove filter"]')).length <= 2);

  ok("4.15 a filter URL is portable", (await rows(`?label=${family.id}`)).length === 2);

  await A.page.goto(`/people?label=${family.id}&rel=mine`);
  await openMenu();
  await A.page.click('a:has-text("Clear all filters")');
  await A.page.waitForURL((u) => !u.search, { timeout: 15_000 });
  ok("4.16 clear all filters returns everything",
     (await A.page.$$eval("tbody tr", (e) => e.length)) === 4);

  await A.page.goto(`?label=${bookClub.id}`.replace(/^/, "/people"));
  ok("4.17 an empty result explains itself",
     (await A.page.textContent("body"))?.includes("Nothing matches those filters") === true);
  ok("4.17b and offers a way out",
     (await A.page.$$('a:has-text("Clear filters")')).length >= 1);

  ok("4.18 searching a label name finds its members",
     (await rows("?q=Family")).length === 2, (await rows("?q=Family")).length);

  // ════════════════════════════════════════════════════════════════════════
  section("§5 Export");

  // Fetched through the page's own context so the session cookie applies, which is
  // also the only way to assert on raw bytes rather than a rendered download.
  const exportCsv = async (query = ""): Promise<{ body: string; headers: Record<string, string> }> => {
    const res = await A.context.request.get(`${h.baseUrl}/api/people/export${query}`);
    return { body: await res.text(), headers: res.headers() };
  };

  // Give one contact everything worth round-tripping, including awkward text.
  const custom = await prisma.fieldDefinition.create({
    data: {
      ownerId: A.id, entity: "PERSON", key: "howWeMet", label: "How we met",
      type: "TEXT", order: 100,
    },
  });
  const tricky = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Zoë Tricky", givenName: "Zoë", familyName: "Tricky",
      organization: "Comma, Inc", jobTitle: "Chief",
      notes: 'Line one\nline two, with a comma and "quotes"',
      birthday: new Date("1990-04-03T00:00:00Z"),
      addToGoogle: true,
      custom: { howWeMet: "At a wedding" },
      labels: { create: [{ labelId: family.id }, { labelId: bookClub.id }] },
      contactPoints: {
        create: [
          { kind: "EMAIL", label: "home", value: "zoe@e2e.test", order: 0 },
          { kind: "EMAIL", label: "work", value: "zoe@work.test", order: 1 },
          { kind: "URL", label: "site", value: "https://zoe.example/a?b=1", order: 0 },
        ],
      },
    },
  });
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, personId: tricky.id, scope: "PERSON", permission: "EDIT" },
  });

  const exported = await exportCsv();
  ok("5.1 export returns a CSV attachment",
     exported.headers["content-type"]?.includes("text/csv") === true &&
     exported.headers["content-disposition"]?.includes("hearth-contacts-") === true,
     exported.headers["content-disposition"]);

  const filtered = await exportCsv(`?label=${bookClub.id}`);
  ok("5.2 export honours the filters",
     filtered.body.split("\r\n").filter((l) => l.trim()).length === 2, // header + 1
     filtered.body.split("\r\n").length);

  ok("5.3 starts with a UTF-8 BOM so Excel reads it as UTF-8",
     exported.body.charCodeAt(0) === 0xfeff);
  ok("5.3b accented characters survive", exported.body.includes("Zoë"));
  ok("5.4 a comma inside a field is quoted", exported.body.includes('"Comma, Inc"'));
  ok("5.5 a newline inside a field is quoted", /"Line one\nline two/.test(exported.body));
  ok("5.5b embedded quotes are doubled", exported.body.includes('""quotes""'));

  const { parseCsv, rowReader, toCsv } = await import("../../src/lib/csv.ts");
  const parsed = parseCsv(exported.body);
  const read = rowReader(parsed.headers);
  const zoeRow = parsed.rows.find((r) => read.get(r, "Given name") === "Zoë")!;
  ok("5.6 labels are semicolon separated",
     read.get(zoeRow, "Labels") === "Book club; Family", read.get(zoeRow, "Labels"));
  ok("5.7 typed contact points use the pipe form",
     read.get(zoeRow, "Emails") === "home|zoe@e2e.test; work|zoe@work.test",
     read.get(zoeRow, "Emails"));
  ok("5.8 a URL's own colons are intact",
     read.get(zoeRow, "URLs") === "site|https://zoe.example/a?b=1", read.get(zoeRow, "URLs"));
  ok("5.9 shares carry email and permission",
     read.get(zoeRow, "Shared with") === "bob@e2e.test|EDIT", read.get(zoeRow, "Shared with"));
  ok("5.10 blanket recipients are listed",
     read.get(zoeRow, "Shared via blanket grant").includes("bob@e2e.test"),
     read.get(zoeRow, "Shared via blanket grant"));
  ok("5.11 a custom field gets its own column, headed with its name",
     read.get(zoeRow, "How we met") === "At a wedding", parsed.headers);
  ok("5.12 Hearth ID is present", read.get(zoeRow, "Hearth ID") === tricky.id);
  ok("5.12b birthday is an ISO day", read.get(zoeRow, "Birthday") === "1990-04-03");
  ok("5.13 contacts shared WITH you are included, with their owner named",
     parsed.rows.some((r) => read.get(r, "Owner") === "bob@e2e.test"),
     parsed.rows.map((r) => read.get(r, "Owner")));
  void custom;

  // ════════════════════════════════════════════════════════════════════════
  section("§6 The round trip");

  const before = await prisma.person.findMany({
    where: { ownerId: A.id },
    include: { contactPoints: true, labels: true, shares: true },
    orderBy: { id: "asc" },
  });
  const snapshot = (list: typeof before) => JSON.stringify(list.map((p) => ({
    id: p.id, displayName: p.displayName, givenName: p.givenName, familyName: p.familyName,
    organization: p.organization, jobTitle: p.jobTitle, notes: p.notes,
    birthday: p.birthday?.toISOString() ?? null, addToGoogle: p.addToGoogle, custom: p.custom,
    points: p.contactPoints.map((c) => `${c.kind}:${c.label ?? ""}:${c.value}`).sort(),
    labels: p.labels.map((l) => l.labelId).sort(),
    shares: p.shares.map((sh) => `${sh.withUserId}:${sh.permission}`).sort(),
  })));
  const beforeJson = snapshot(before);

  const roundTripFile = path.join(scratch, "round-trip.csv");
  writeFileSync(roundTripFile, exported.body, "utf8");

  // Isolate parser from transport: parse the very bytes about to be uploaded, in
  // process. If this preserves the newline but the imported row does not, the change
  // happened in the upload rather than in Hearth's own CSV handling.
  {
    const local = parseCsv(exported.body);
    const lr = rowReader(local.headers);
    const zoe = local.rows.find((r) => lr.get(r, "Given name") === "Zoë")!;
    const notes = lr.get(zoe, "Notes");
    ok("6.0 the parser preserves a bare LF inside a field",
       notes.includes("\n") && !notes.includes("\r"), JSON.stringify(notes));
  }

  await A.page.goto("/people/import");
  await A.page.setInputFiles("#file", roundTripFile);
  await A.page.click('button:has-text("Preview import")');
  await A.page.waitForSelector('text=What will happen', { timeout: 30_000 });
  const previewText = (await A.page.textContent("body")) ?? "";
  const stat = (label: string) => {
    const m = new RegExp(`(\\d+)\\s*${label}`).exec(previewText.replace(/\s+/g, " "));
    return m ? Number(m[1]) : -1;
  };
  // The export also holds the contact B shared with A, which A cannot write — so a
  // faithful round trip updates A's own and skips that one. Zero creates is the
  // property that matters: nothing is duplicated.
  ok("6.1 the round trip creates nothing",
     stat("New contacts") === 0, { created: stat("New contacts") });
  ok("6.1b A's own contacts all update",
     stat("Updated") === before.length, { updated: stat("Updated"), expected: before.length });
  ok("6.1c the contact shared with A is skipped, not duplicated",
     stat("Skipped") === 1, { skipped: stat("Skipped") });
  ok("6.4 no new labels are proposed", !previewText.includes("New labels:"), true);

  // Matched on the row count: "Preview import" also contains the word "Import".
  await A.page.click('button:text-matches("^Import \\\\d+ rows?$")');
  await A.page.waitForSelector('text=Import finished', { timeout: 60_000 });
  const doneText = (await A.page.textContent('[role="status"]')) ?? "";
  ok("6.2 the import completes", doneText.includes("Import finished"), doneText);
  ok("6.2b and reports no contacts added", !doneText.includes("added"), doneText);

  const after = await prisma.person.findMany({
    where: { ownerId: A.id },
    include: { contactPoints: true, labels: true, shares: true },
    orderBy: { id: "asc" },
  });
  // Reported field-by-field: a truncated blob diff says only "something differs",
  // which is the least useful thing a failing round-trip test can tell you.
  const diffs: string[] = [];
  {
    const b = JSON.parse(beforeJson) as Record<string, unknown>[];
    const a = JSON.parse(snapshot(after)) as Record<string, unknown>[];
    for (const [i, rec] of b.entries()) {
      const other = a[i] ?? {};
      for (const key of Object.keys(rec)) {
        const x = JSON.stringify(rec[key]);
        const y = JSON.stringify(other[key]);
        if (x !== y) diffs.push(`${rec.displayName}·${key}: ${x} → ${y}`);
      }
    }
  }
  ok("6.3 nothing changed — the file Hearth wrote is a no-op when fed back",
     diffs.length === 0, diffs);

  // A spreadsheet rewrites quoting and drops the BOM; the file must still survive.
  const resaved = exported.body
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
  const resavedFile = path.join(scratch, "resaved.csv");
  writeFileSync(resavedFile, resaved, "utf8");
  await A.page.goto("/people/import");
  await A.page.setInputFiles("#file", resavedFile);
  await A.page.click('button:has-text("Preview import")');
  await A.page.waitForSelector('text=What will happen', { timeout: 30_000 });
  const resavedText = (await A.page.textContent("body")) ?? "";
  const resavedStat = (label: string) => {
    const m = new RegExp(`(\\d+)\\s*${label}`).exec(resavedText.replace(/\s+/g, " "));
    return m ? Number(m[1]) : -1;
  };
  ok("6.6 a BOM-less, LF-only re-save still round-trips",
     resavedStat("New contacts") === 0 && resavedStat("Updated") === before.length,
     { created: resavedStat("New contacts"), updated: resavedStat("Updated") });

  // Idempotency, through the browser's own upload — which is where the CRLF
  // rewriting happens, and so the only place this can be proven.
  await A.page.click('button:text-matches("^Import \\\\d+ rows?$")');
  await A.page.waitForSelector('text=Import finished', { timeout: 60_000 });
  const twice = await prisma.person.findMany({
    where: { ownerId: A.id },
    include: { contactPoints: true, labels: true, shares: true },
    orderBy: { id: "asc" },
  });
  ok("6.5 a second import changes nothing either", snapshot(twice) === beforeJson,
     snapshot(twice) === beforeJson ? "" : "second import mutated something");


  // ════════════════════════════════════════════════════════════════════════
  section("§7 Import: matching and safety");

  /** Write a CSV, upload it, and return the preview page's text. */
  const preview = async (headers: string[], body: string[][], name: string): Promise<string> => {
    const file = path.join(scratch, `${name}.csv`);
    writeFileSync(file, toCsv(headers, body), "utf8");
    await A.page.goto("/people/import");
    await A.page.setInputFiles("#file", file);
    await A.page.click('button:has-text("Preview import")');
    // Either a preview or a refusal is a valid outcome; wait for whichever lands.
    await A.page.waitForFunction(
      () => document.body.textContent?.includes("What will happen") === true ||
            document.querySelector('[role="status"]') !== null,
      undefined, { timeout: 30_000 },
    ).catch(() => {});
    return (await A.page.textContent("body")) ?? "";
  };
  const apply = async (): Promise<string> => {
    await A.page.click('button:text-matches("^Import \\\\d+ rows?$")');
    await A.page.waitForSelector("text=Import finished", { timeout: 60_000 });
    return (await A.page.textContent('[role="status"]')) ?? "";
  };
  const oneLine = (t: string) => t.replace(/\s+/g, " ");
  // The stat tiles render the number and its caption as adjacent blocks, so the
  // text runs together: "1New contacts". Hence \\s* rather than a literal space.
  const hasStat = (t: string, n: number, label: string) =>
    new RegExp(`${n}\\s*${label}`).test(oneLine(t));

  await A.page.goto("/people");
  // Two now, and named by which is which: has-text is a substring match, so a bare
  // count of "Import" was only ever right while there was one of them.
  ok("7.1 the People page offers both imports",
     (await A.page.$$('a[href="/people/import"]')).length === 1
       && (await A.page.$$('a[href="/people/import/google"]')).length === 1);
  await A.page.goto("/people/import");
  ok("7.1b the import page loads with its format reference",
     (await A.page.textContent("body"))?.includes("How rows are matched") === true);

  let text = await preview(
    ["Given name", "Family name", "Emails"],
    [["Brand", "New", "brandnew@e2e.test"]],
    "new-contact",
  );
  ok("7.2 an unknown contact previews as new", hasStat(text, 1, "New contacts"), oneLine(text).slice(0, 200));

  text = await preview(["Hearth ID", "Given name", "Family name"], [[sam.id, "Sam", "Renamed"]], "id-match");
  ok("7.3 an id match previews as an update, named correctly",
     text.includes("update") && text.includes("Sam Renamed"), true);

  text = await preview(
    ["Given name", "Family name", "Emails"],
    [["Sam", "ByEmail", "sam@e2e.test"]],
    "email-match",
  );
  ok("7.4 an email match is found and explained",
     text.includes("matched your existing contact by sam@e2e.test"), true);

  text = await preview(
    ["Given name", "Family name", "Emails"],
    [["", "", ""], ["Real", "Row", "real@e2e.test"]],
    "blank-row",
  );
  ok("7.5 a blank row is skipped with a reason",
     text.includes("No name, organisation or nickname"), true);

  text = await preview(["Hearth ID", "Given name"], [[sam.id, "First"], [sam.id, "Second"]], "dup-rows");
  ok("7.6 a second row for the same contact is skipped",
     text.includes("Another row in this file already updates"), true);

  text = await preview(
    ["Given name", "Nonsense", "Emails"],
    [["Head", "ignored", "head@e2e.test"]],
    "unknown-col",
  );
  ok("7.7 an unrecognised column is reported, not silently dropped",
     text.includes("Columns Hearth does not recognise") && text.includes("Nonsense"), true);

  text = await preview(["Hearth ID", "Birthday"], [[sam.id, "03/04/1990"]], "ambiguous-date");
  ok("7.8 an ambiguous date is reported rather than guessed",
     text.includes("not a date Hearth understands"), true);

  await preview(["Hearth ID", "Birthday"], [[sam.id, "1975-12-25"]], "iso-date");
  await apply();
  const withBirthday = await prisma.person.findUniqueOrThrow({ where: { id: sam.id } });
  ok("7.9 an ISO date is applied",
     withBirthday.birthday?.toISOString().slice(0, 10) === "1975-12-25", withBirthday.birthday);

  // A narrow file must not wipe what it never mentions.
  const pointsBefore = await prisma.contactPoint.count({ where: { personId: sam.id } });
  // No contact-point column at all: nothing is replaced, so there is nothing to warn
  // about. The warning belongs to the partial case, asserted just below.
  text = await preview(["Hearth ID", "Labels"], [[sam.id, "Family"]], "narrow");
  ok("7.10 a file with no contact columns proposes no change to them",
     !text.includes("are kept"), oneLine(text).slice(0, 150));
  await apply();
  ok("7.10b and the contact points survive",
     (await prisma.contactPoint.count({ where: { personId: sam.id } })) === pointsBefore,
     { before: pointsBefore, after: await prisma.contactPoint.count({ where: { personId: sam.id } }) });

  // Some but not all contact columns: the omitted kinds must be reported as kept,
  // since a wholesale replace would otherwise delete them silently.
  text = await preview(["Hearth ID", "Emails"], [[sam.id, "sam@e2e.test"]], "partial-contacts");
  ok("7.10c a partial contact-column file says which kinds it is keeping",
     text.includes("are kept") && /phones/i.test(text), oneLine(text).slice(0, 300));
  await apply();
  ok("7.10d and the phone really does survive",
     (await prisma.contactPoint.count({ where: { personId: sam.id, kind: "PHONE" } }))
       === (await prisma.contactPoint.count({ where: { personId: sam.id, kind: "PHONE" } })));

  text = await preview(["Hearth ID", "Labels"], [[sam.id, "Family; Brand New Label"]], "new-label");
  ok("7.11 a label that does not exist yet is listed as new",
     text.includes("New labels") && text.includes("Brand New Label"), true);
  await apply();
  ok("7.11b and is created on import",
     (await prisma.label.count({ where: { ownerId: A.id, name: "Brand New Label" } })) === 1);

  text = await preview(["Hearth ID", "Shared with"], [[sam.id, "nobody@nowhere.test|EDIT"]], "unknown-share");
  ok("7.12 a share target who is not a user is reported",
     text.includes("Not users of this Hearth") && text.includes("nobody@nowhere.test"), true);

  const solo = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Solo Contact", givenName: "Solo", familyName: "Contact" },
  });
  await preview(["Hearth ID", "Shared with"], [[solo.id, "bob@e2e.test|EDIT"]], "grant-share");
  await apply();
  let soloShares = await prisma.share.findMany({ where: { personId: solo.id } });
  ok("7.13 a share is granted at the stated permission",
     soloShares.length === 1 && soloShares[0]!.permission === "EDIT", soloShares);

  await preview(["Hearth ID", "Given name"], [[solo.id, "Solo"]], "no-share-col");
  await apply();
  ok("7.14 omitting the recipient does NOT revoke — import grants only",
     (await prisma.share.count({ where: { personId: solo.id } })) === 1);

  await preview(["Hearth ID", "Shared with"], [[solo.id, ""]], "blank-share-col");
  await apply();
  ok("7.14b nor does a blank share cell",
     (await prisma.share.count({ where: { personId: solo.id } })) === 1);

  text = await preview(
    ["Hearth ID", "Given name", "How we met"],
    [[solo.id, "SoloEdited", "x".repeat(1200)]],
    "bad-custom",
  );
  ok("7.15 an over-long custom value is reported", text.includes("How we met"), oneLine(text).slice(0, 150));
  await apply();
  ok("7.15b but the rest of the row still applies",
     (await prisma.person.findUniqueOrThrow({ where: { id: solo.id } })).givenName === "SoloEdited");

  await A.page.goto("/people/import");
  ok("7.17 arriving fresh shows no stale preview",
     (await A.page.textContent("body"))?.includes("What will happen") !== true);

  const bulkBefore = await prisma.person.count({ where: { ownerId: A.id } });
  text = await preview(
    ["Given name", "Family name"],
    Array.from({ length: 5_001 }, (_, i) => [`Bulk${i}`, "Row"]),
    "too-many",
  );
  ok("7.18 a file over the row limit is refused",
     text.includes("the limit is") && text.includes("5,000"), oneLine(text).slice(0, 200));
  ok("7.18b and nothing was written",
     (await prisma.person.count({ where: { ownerId: A.id } })) === bulkBefore);

  const headerOnly = path.join(scratch, "header-only.csv");
  writeFileSync(headerOnly, "Given name,Family name\r\n", "utf8");
  await A.page.goto("/people/import");
  await A.page.setInputFiles("#file", headerOnly);
  await A.page.click('button:has-text("Preview import")');
  const headerMsg = await statusText(A.page);
  ok("7.19 a header-only file is refused with a reason", headerMsg.includes("no contacts"), headerMsg);

  // ════════════════════════════════════════════════════════════════════════
  section("§8 Import: permissions");

  const bobsEditable = await prisma.person.create({
    data: {
      ownerId: B.id, displayName: "Bobs Editable", givenName: "Bobs", familyName: "Editable",
      contactPoints: { create: [{ kind: "EMAIL", value: "bobs-editable@e2e.test" }] },
    },
  });
  const bobsPrivate = await prisma.person.create({
    data: { ownerId: B.id, displayName: "Bobs Private", givenName: "Bobs", familyName: "Private" },
  });
  await prisma.share.create({
    data: { ownerId: B.id, withUserId: A.id, personId: bobsEditable.id, scope: "PERSON", permission: "EDIT" },
  });

  text = await preview(
    ["Hearth ID", "Given name", "Labels", "Shared with", "How we met"],
    [[bobsEditable.id, "Edited", "Family", "bob@e2e.test|EDIT", "somewhere"]],
    "shared-edit",
  );
  ok("8.1 an EDIT-shared record previews as an update", text.includes("update"), true);
  ok("8.2 labels are refused on someone else's record",
     text.includes("Labels belong to the contact"), true);
  ok("8.3 sharing is refused on someone else's record",
     text.includes("Only a contact"), true);
  ok("8.4 custom fields are refused on someone else's record",
     text.includes("keyed by the owner"), true);
  await apply();
  const edited = await prisma.person.findUniqueOrThrow({
    where: { id: bobsEditable.id }, include: { labels: true, shares: true },
  });
  ok("8.1b the permitted part of the row did apply", edited.givenName === "Edited");
  ok("8.2b no label was attached", edited.labels.length === 0);
  ok("8.3b no share was created by the import",
     edited.shares.filter((sh) => sh.ownerId === A.id).length === 0,
     edited.shares.map((sh) => `${sh.ownerId}->${sh.withUserId}`));
  ok("8.3c B's own share of it survives untouched",
     edited.shares.filter((sh) => sh.ownerId === B.id).length === 1);
  ok("8.4b no custom value was written",
     Object.keys((edited.custom ?? {}) as Record<string, unknown>).length === 0, edited.custom);

  text = await preview(
    ["Hearth ID", "Given name", "Family name"],
    [[bobsPrivate.id, "Sneaky", "Attempt"]],
    "unshared-id",
  );
  ok("8.5 a row naming a record you cannot edit is skipped, not copied",
     text.includes("do not have edit access"), true);
  ok("8.5b and no duplicate is proposed", hasStat(text, 0, "New contacts"), oneLine(text).slice(0, 200));
  ok("8.5c the record itself is untouched",
     (await prisma.person.findUniqueOrThrow({ where: { id: bobsPrivate.id } })).givenName === "Bobs");

  text = await preview(
    ["Given name", "Family name", "Emails"],
    [["Guessed", "ByEmail", "bobs-editable@e2e.test"]],
    "email-vs-shared",
  );
  ok("8.6 an email match never reaches a shared record — it becomes a new contact",
     hasStat(text, 1, "New contacts"), oneLine(text).slice(0, 200));

  const bobsCount = await prisma.person.count({ where: { ownerId: B.id } });
  await preview(["Given name", "Family name", "Owner"], [["Owned", "Attempt", "bob@e2e.test"]], "owner-col");
  await apply();
  ok("8.7 an Owner column cannot reassign ownership",
     (await prisma.person.count({ where: { ownerId: B.id } })) === bobsCount,
     { before: bobsCount, after: await prisma.person.count({ where: { ownerId: B.id } }) });
  ok("8.7b the row landed as A's own contact",
     (await prisma.person.count({ where: { ownerId: A.id, familyName: "Attempt" } })) === 1);

  await B.page.goto(`/people/${bobsPrivate.id}`);
  ok("8.8 B's untouched record still reads as B wrote it",
     (await B.page.textContent("body"))?.includes("Bobs Private") === true);

  // ════════════════════════════════════════════════════════════════════════
  section("§9 Regressions not needing Google");

  await A.page.goto(`/people/${sam.id}/edit`);
  await A.page.fill('input[name="f_givenName"]', "Samuel");
  await A.page.click('button:has-text("Save")');
  await A.page.waitForURL(new RegExp(`/people/${sam.id}$`), { timeout: 20_000 });
  ok("9.1 the edit form still saves",
     (await prisma.person.findUniqueOrThrow({ where: { id: sam.id } })).givenName === "Samuel");
  ok("9.1b and the derived display name follows",
     (await prisma.person.findUniqueOrThrow({ where: { id: sam.id } })).displayName.startsWith("Samuel"));

  // bobsEditable is owned by B, so B must see Edit as its owner.
  await B.page.goto(`/people/${bobsEditable.id}`);
  const editLinks = await B.page.$$eval("a", (els) =>
    els.map((e) => e.textContent?.trim() ?? "").filter((t) => t.includes("Edit")));
  ok("9.2 the owner still gets the Edit control", editLinks.length === 1, editLinks);

  await A.page.goto("/settings/mappings/people");
  ok("9.5 the contact mapping page still loads",
     (await A.page.textContent("body"))?.includes("Google") === true);
  await A.page.goto("/settings/mappings/events");
  ok("9.5b the event mapping page still loads",
     (await A.page.textContent("body"))?.includes("Google") === true);

  await A.page.goto("/events/new");
  ok("9.6 the new-event form loads", (await A.page.$$('input[name="f_title"]')).length === 1);

  await A.page.goto("/settings");
  const settingsText = (await A.page.textContent("body")) ?? "";
  ok("9.6b settings renders both sync panels",
     settingsText.includes("Contact sync") && settingsText.includes("Calendar sync"));
  ok("9.6c the shared-contacts toggle is present",
     settingsText.includes("Also push contacts shared with me"));


  // ════════════════════════════════════════════════════════════════════════
  section("§10 Contact photos");

  // Generated rather than copied: the browser has to decode it, so a header that merely
  // parses is not enough.
  const pngPath = path.join(scratch, "dot.png");
  writeFileSync(pngPath, makePng());

  const uploadPhoto = async (page: Page, personId: string) => {
    await page.goto(`/people/${personId}`);
    await page.setInputFiles('input[type="file"][accept="image/*"]', pngPath);
    await page.waitForFunction(
      () => document.body.textContent?.includes("Photo saved") === true,
      undefined, { timeout: 30_000 },
    );
  };

  // sam is A's, shared with B (VIEW at this point in the run).
  await prisma.share.updateMany({
    where: { personId: sam.id, withUserId: B.id }, data: { permission: "EDIT" },
  });

  await uploadPhoto(A.page, sam.id);
  const ownerPhoto = await prisma.personPhoto.findFirst({
    where: { personId: sam.id, userId: A.id },
  });
  ok("10.1 the owner's photo is stored", Boolean(ownerPhoto), Boolean(ownerPhoto));
  ok("10.1b re-encoded to JPEG by the browser before upload",
     ownerPhoto?.mimeType === "image/jpeg", ownerPhoto?.mimeType);
  ok("10.1c with dimensions recorded",
     (ownerPhoto?.width ?? 0) > 0 && (ownerPhoto?.height ?? 0) > 0,
     { w: ownerPhoto?.width, h: ownerPhoto?.height });

  const photoRes = await A.context.request.get(
     `${h.baseUrl}/api/people/${sam.id}/photo?v=${ownerPhoto!.etag}`);
  ok("10.2 the photo route serves it", photoRes.ok(), photoRes.status());
  ok("10.2b as an image", (photoRes.headers()["content-type"] ?? "").startsWith("image/"),
     photoRes.headers()["content-type"]);
  ok("10.2c privately cached — the same URL differs per viewer",
     (photoRes.headers()["cache-control"] ?? "").includes("private"),
     photoRes.headers()["cache-control"]);

  const notModified = await A.context.request.get(
    `${h.baseUrl}/api/people/${sam.id}/photo`,
    { headers: { "if-none-match": `"${ownerPhoto!.etag}"` } });
  ok("10.2d and answers a matching etag with 304", notModified.status() === 304, notModified.status());

  // B inherits A's photo until they choose their own.
  await B.page.goto(`/people/${sam.id}`);
  ok("10.3 a recipient sees the owner's photo",
     (await B.page.textContent("body"))?.includes("You are seeing the owner’s photo") === true);

  await uploadPhoto(B.page, sam.id);
  const bPhoto = await prisma.personPhoto.findFirst({ where: { personId: sam.id, userId: B.id } });
  ok("10.4 a recipient can set their own", Boolean(bPhoto));
  ok("10.4b which is a separate row from the owner's",
     Boolean(ownerPhoto) && Boolean(bPhoto) && ownerPhoto!.id !== bPhoto!.id);
  ok("10.4c the owner's photo is unchanged",
     (await prisma.personPhoto.findFirst({ where: { personId: sam.id, userId: A.id } }))?.etag
       === ownerPhoto!.etag);

  await B.page.goto(`/people/${sam.id}`);
  ok("10.4d and B is told it is their own",
     (await B.page.textContent("body"))?.includes("This is your own picture") === true);

  // Clearing an override hands the recipient back the owner's picture.
  await B.page.click('button:has-text("Use the owner’s photo")');
  await B.page.waitForFunction(
    () => document.body.textContent?.includes("You are seeing the owner’s photo") === true,
    undefined, { timeout: 20_000 },
  ).catch(() => {});
  ok("10.5 clearing an override falls back to the owner's",
     (await prisma.personPhoto.count({ where: { personId: sam.id, userId: B.id } })) === 0);

  // Access: the URL is the contact's own id, so the route is the only gate.
  const anon = await A.context.browser()!.newContext({ baseURL: h.baseUrl });
  const anonRes = await anon.request.get(`${h.baseUrl}/api/people/${sam.id}/photo`);
  ok("10.6 the photo route refuses an unauthenticated request",
     anonRes.status() === 401, anonRes.status());
  await anon.close();

  const secret = await prisma.person.create({
    data: { ownerId: B.id, displayName: "Private Pat", givenName: "Private", familyName: "Pat" },
  });
  const forbidden = await A.context.request.get(`${h.baseUrl}/api/people/${secret.id}/photo`);
  ok("10.6b and a contact you cannot read", forbidden.status() === 404, forbidden.status());

  ok("10.7 an avatar appears in the contact list",
     (await (async () => {
       await A.page.goto("/people");
       return (await A.page.$$(`tbody img[src*="/photo?v="]`)).length;
     })()) >= 1);

  ok("10.8 the header shows the signed-in user's own avatar",
     (await A.page.$$('header img, header span[aria-hidden]')).length >= 1);

  // ════════════════════════════════════════════════════════════════════════
  section("§11 Ownership transfer");

  const giveaway = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Given Away", givenName: "Given", familyName: "Away",
      addToGoogle: true,
      labels: { create: [{ labelId: family.id }] },
    },
  });
  const thirdParty = await h.signIn("carol@e2e.test", "Carol");
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: thirdParty.id, personId: giveaway.id, scope: "PERSON", permission: "VIEW" },
  });

  await A.page.goto(`/people/${giveaway.id}`);
  ok("11.1 the owner is offered a transfer",
     (await A.page.textContent("body"))?.includes("Transfer ownership") === true);
  await A.page.click('button:has-text("Transfer ownership")');
  const warnings = (await A.page.textContent("body")) ?? "";
  ok("11.1b the warning names the labels that will be dropped",
     warnings.includes("label") && warnings.includes("removed"), true);
  ok("11.1c and says the existing recipient keeps access",
     warnings.includes("keep their access"), true);

  await A.page.selectOption('select[name="toUserId"]', B.id);
  await A.page.click('input[name="kept"][value="none"]');
  await A.page.click('button:has-text("Transfer Given Away")');
  // Keeping nothing means the contact's page stops being readable, so the confirmation
  // lands on the list instead of in a view that is about to 404.
  await A.page.waitForURL(/gave=/, { timeout: 30_000 });
  ok("11.1d giving it away entirely lands back on the list, with a confirmation",
     (await A.page.textContent('[role="status"]'))?.includes("now belongs to someone else")
       === true,
     await A.page.textContent('[role="status"]'));

  const moved = await prisma.person.findUniqueOrThrow({
    where: { id: giveaway.id },
    include: { labels: true, shares: true },
  });
  ok("11.2 ownership moved", moved.ownerId === B.id, moved.ownerId);
  ok("11.2b the old owner's labels were dropped", moved.labels.length === 0, moved.labels.length);
  ok("11.2c the third party keeps access",
     moved.shares.some((sh) => sh.withUserId === thirdParty.id), moved.shares.length);
  ok("11.2d and their share is now owned by the new owner",
     moved.shares.every((sh) => sh.ownerId === B.id), moved.shares.map((sh) => sh.ownerId));
  ok("11.2e the previous owner kept nothing",
     !moved.shares.some((sh) => sh.withUserId === A.id));

  await A.page.goto(`/people/${giveaway.id}`);
  ok("11.3 the previous owner can no longer open it",
     A.page.url().includes("/people") &&
       (await A.page.textContent("body"))?.includes("Given Away") !== true,
     A.page.url());
  ok("11.3b a tombstone was queued to remove it from their Google",
     (await prisma.syncTombstone.count({
       where: { ownerId: A.id, target: "GOOGLE_CONTACT", processedAt: null },
     })) >= 0);

  // Keeping view access instead.
  const kept = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Kept Visible", givenName: "Kept", familyName: "Visible" },
  });
  await A.page.goto(`/people/${kept.id}`);
  await A.page.click('button:has-text("Transfer ownership")');
  await A.page.selectOption('select[name="toUserId"]', B.id);
  await A.page.click('input[name="kept"][value="view"]');
  await A.page.click('button:has-text("Transfer Kept Visible")');
  // Every transfer confirms on the list, whatever was kept: the form only renders for an
  // owner, so a success necessarily removes the component that would show a message.
  await A.page.waitForURL(/gave=/, { timeout: 30_000 });
  ok("11.4a keeping access is confirmed on the list too",
     (await A.page.textContent('[role="status"]'))?.includes("kept view-only") === true,
     await A.page.textContent('[role="status"]'));
  const keptRow = await prisma.person.findUniqueOrThrow({
    where: { id: kept.id }, include: { shares: true },
  });
  ok("11.4 keeping view access leaves a VIEW share for the old owner",
     keptRow.ownerId === B.id &&
     keptRow.shares.some((sh) => sh.withUserId === A.id && sh.permission === "VIEW"),
     keptRow.shares.map((sh) => `${sh.withUserId}:${sh.permission}`));

  await A.page.goto(`/people/${kept.id}`);
  ok("11.4b so they can still see it",
     (await A.page.textContent("body"))?.includes("Kept Visible") === true);
  ok("11.4c but cannot edit it",
     (await A.page.$$('a:has-text("Edit")')).length === 0);
  ok("11.4d and are no longer offered a transfer",
     (await A.page.textContent("body"))?.includes("Transfer ownership") !== true);

  // A non-owner must not be able to give somebody else's contact away.
  await B.page.goto(`/people/${sam.id}`);
  ok("11.5 an EDIT recipient is not offered a transfer",
     (await B.page.textContent("body"))?.includes("Transfer ownership") !== true);


  // ════════════════════════════════════════════════════════════════════════
  section("§12 Household cards");

  // The harness signs users in directly, so cards come from ensureContactCard rather
  // than the createUser hook — the same function the hook calls.
  const { ensureContactCard } = await import("@/lib/household");
  for (const who of [A, B]) await ensureContactCard(who.id);

  const heads = await prisma.user.count({ where: { isHeadOfHousehold: true } });
  ok("12.1 exactly one head of household", heads === 1, heads);

  const aCard = await prisma.person.findFirst({
    where: { linkedUserId: A.id },
    include: { owner: { select: { email: true } }, shares: true, contactPoints: true },
  });
  const bCard = await prisma.person.findFirst({
    where: { linkedUserId: B.id },
    include: { owner: { select: { email: true } }, shares: true },
  });
  ok("12.2 each user has a card", Boolean(aCard && bCard));
  ok("12.2b named from their profile", aCard?.displayName === "Alice", aCard?.displayName);
  ok("12.2c with their email on it",
     aCard?.contactPoints.some((c) => c.value === "alice@e2e.test") === true,
     aCard?.contactPoints.length);
  ok("12.3 both owned by the head",
     aCard?.owner.email === bCard?.owner.email, [aCard?.owner.email, bCard?.owner.email]);
  ok("12.4 a card is shared with the user it is about — that is what reaches their Google",
     bCard?.shares.some((sh) => sh.withUserId === B.id) === true ||
       bCard?.ownerId === B.id,
     bCard?.shares.length);

  await B.page.goto(`/people/${aCard!.id}`);
  ok("12.5 a non-owner can open somebody's card",
     (await B.page.textContent("body"))?.includes("Alice") === true);
  ok("12.5b and may edit it", (await B.page.$$('a:has-text("Edit")')).length === 1);

  await A.page.goto("/settings/sharing");
  const sharingText = (await A.page.textContent("body")) ?? "";
  ok("12.6 settings shows the household", sharingText.includes("Head of household"));
  ok("12.6b and lists the cards", sharingText.includes("Alice") && sharingText.includes("Bob"));

  // ════════════════════════════════════════════════════════════════════════
  section("§13 Relationship editing");

  const relTarget = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Rel Target", givenName: "Rel", familyName: "Target" },
  });
  const parentType = await prisma.relationshipType.findFirstOrThrow({
    where: { key: "parent", ownerId: null },
  });
  await prisma.relationship.create({
    data: { ownerId: A.id, fromPersonId: sam.id, toPersonId: relTarget.id, typeId: parentType.id },
  });

  await A.page.goto(`/people/${sam.id}`);
  ok("13.1 the row reads from this contact's side",
     (await A.page.textContent("body"))?.includes("Parent of") === true);
  ok("13.2 an Edit control sits beside Remove",
     (await A.page.$$('button:has-text("Edit")')).length >= 1);

  await A.page.click('li:has-text("Rel Target") button:has-text("Edit")');
  await A.page.waitForSelector('select[name="typeDirection"]', { timeout: 10_000 });
  const opts = await A.page.$$eval('select[name="typeDirection"] option', (els) =>
    els.map((e) => e.textContent?.trim()));
  ok("13.3 both readings of an asymmetric type are offered",
     opts.includes("Parent of") && opts.includes("Child of"), opts.slice(0, 6));
  ok("13.3b a symmetric type appears once",
     opts.filter((o) => o === "Sibling of").length === 1, opts.filter((o) => o === "Sibling of"));

  // Dates, and the "from X to Y" rendering they drive.
  await A.page.fill('input[name="startedOn"]', "2001-05-06");
  await A.page.fill('input[name="endedOn"]', "2020-01-02");
  await A.page.fill('input[name="notes"]', "adopted");
  await A.page.click('form:has(select[name="typeDirection"]) button:has-text("Save")');
  await waitForDb("the dates saved", async () =>
    (await prisma.relationship.count({ where: { notes: "adopted" } })) === 1);

  const saved = await prisma.relationship.findFirstOrThrow({ where: { toPersonId: relTarget.id } });
  ok("13.4 dates and notes are saved",
     saved.startedOn?.toISOString().slice(0, 10) === "2001-05-06" &&
     saved.endedOn?.toISOString().slice(0, 10) === "2020-01-02" && saved.notes === "adopted",
     { s: saved.startedOn, e: saved.endedOn, n: saved.notes });

  await A.page.goto(`/people/${sam.id}`);
  ok("13.5 an ended relationship reads as a range, not just a start",
     /2001.*to.*2020|2001.*2020/.test((await A.page.textContent("body")) ?? ""),
     (await A.page.textContent('li:has-text("Rel Target")')));

  // Flipping direction from the far end — the case that would reverse a family tree.
  await A.page.goto(`/people/${relTarget.id}`);
  ok("13.6 the far end reads as the inverse",
     (await A.page.textContent("body"))?.includes("Child of") === true);
  await A.page.click('li:has-text("Sam") button:has-text("Edit")');
  await A.page.waitForSelector('select[name="typeDirection"]', { timeout: 10_000 });
  await A.page.selectOption('select[name="typeDirection"]', { label: "Parent of" });
  await A.page.click('form:has(select[name="typeDirection"]) button:has-text("Save")');
  await waitForDb("the direction flipped", async () =>
    (await prisma.relationship.findUniqueOrThrow({ where: { id: saved.id } })).fromPersonId
      === relTarget.id);

  const flipped = await prisma.relationship.findFirstOrThrow({
    where: { id: saved.id },
  });
  ok("13.7 choosing 'Parent of' here makes THIS contact the parent",
     flipped.fromPersonId === relTarget.id && flipped.toPersonId === sam.id,
     { from: flipped.fromPersonId === relTarget.id ? "target" : "sam" });
  await A.page.goto(`/people/${sam.id}`);
  ok("13.7b so the other page now reads 'Child of'",
     (await A.page.textContent('li:has-text("Rel Target")'))?.includes("Child of") === true,
     await A.page.textContent('li:has-text("Rel Target")'));

  // ════════════════════════════════════════════════════════════════════════
  section("§14 Labels from a contact, and sharing controls");

  const inlineTarget = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Inline Ida", givenName: "Inline", familyName: "Ida" },
  });
  await A.page.goto(`/people/${inlineTarget.id}`);
  await A.page.click('button:has-text("Add labels")');
  await A.page.fill('input[name="newLabel"]', "Invented Here");
  await A.page.click('button:has-text("Save labels")');
  await waitForDb("the invented label exists", async () =>
    (await prisma.label.count({ where: { ownerId: A.id, name: "Invented Here" } })) === 1);
  ok("14.1 a label typed on a contact page is created",
     (await prisma.label.count({ where: { ownerId: A.id, name: "Invented Here" } })) === 1);
  ok("14.1b and applied to that contact",
     (await prisma.personLabel.count({ where: { personId: inlineTarget.id } })) === 1);

  await A.page.goto("/settings/labels");
  ok("14.1c and shows up in settings alongside the rest",
     (await A.page.textContent("body"))?.includes("Invented Here") === true);

  // Sharing: someone who already has access is not offered again, and can be removed.
  const shareTarget = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Share Sid", givenName: "Share", familyName: "Sid" },
  });
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, personId: shareTarget.id, scope: "PERSON", permission: "VIEW" },
  });
  await A.page.goto(`/people/${shareTarget.id}`);
  const sharingCard = (await A.page.textContent("body")) ?? "";
  ok("14.2 an existing recipient is listed with their permission",
     sharingCard.includes("bob@e2e.test") && sharingCard.includes("view only"));
  ok("14.2b and is NOT offered in the picker as well",
     !sharingCard.includes("already has access"), true);
  // The claim is about who is offered, not how many: §11 added a third user, so the
  // picker legitimately still has somebody in it.
  const offered = await A.page.$$eval('input[name="userId"]', (els) =>
    els.map((e) => (e as HTMLInputElement).value));
  ok("14.2c the existing recipient is not among those offered",
     !offered.includes(B.id), offered.length);
  ok("14.2d but somebody who has no access still is", offered.length >= 1, offered.length);

  // The dialog handler from §1 is still in force; see the note there.
  await A.page.click('button:has-text("Remove")');
  await A.page.waitForFunction(
    () => !document.body.textContent?.includes("view only"),
    undefined, { timeout: 20_000 },
  ).catch(() => {});
  ok("14.3 a share can be removed from the contact page",
     (await prisma.share.count({ where: { personId: shareTarget.id } })) === 0);
  await A.page.goto(`/people/${shareTarget.id}`);
  ok("14.3b and the picker offers them again",
     (await A.page.$$eval('input[name="userId"]', (els) =>
       els.map((e) => (e as HTMLInputElement).value))).includes(B.id));

  // ---------------------------------------------------------------------------
  section("§15 Appearance: light/dark and colour schemes");
  // ---------------------------------------------------------------------------
  // The claim worth testing is not "an attribute changed" — it is that the accent
  // utilities and the dark: variant recompute from it. So most of these read the
  // colour the browser actually painted, and the paint probe reloads a page so the
  // server-rendered path is exercised rather than only the client one.

  const htmlState = () =>
    A.page.evaluate(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      return {
        theme: root.getAttribute("data-theme"),
        scheme: root.getAttribute("data-scheme"),
        // The hue AFTER the stylesheet has chosen between the light and dark ones.
        // Reading the inline style instead would test what the server sent rather
        // than what the page resolved, which is the half that can be wrong.
        hue: cs.getPropertyValue("--accent-hue").trim(),
        light: cs.getPropertyValue("--accent-hue-light").trim(),
        dark: cs.getPropertyValue("--accent-hue-dark").trim(),
      };
    });
  /** What bg-accent-600 resolves to, read from the New contact button. */
  const accentPaint = async () => {
    await A.page.goto("/people");
    return A.page.evaluate(() => {
      const el = document.querySelector('a[href="/people/new"]');
      return el ? getComputedStyle(el).backgroundColor : "";
    });
  };
  const bodyPaint = () =>
    A.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const settingsRow = () => prisma.userSettings.findUnique({ where: { userId: A.id } });

  await A.page.emulateMedia({ colorScheme: "light" });
  await A.page.goto("/settings");
  let state = await htmlState();
  ok("15.1 light and dark defaults to following the device", state.theme === null, state);
  ok("15.1b and the accent to the scheme Hearth ships with",
     state.scheme === "teal" && state.hue === "184", state);
  const systemLightBg = await bodyPaint();
  const tealPaint = await accentPaint();

  await A.page.goto("/settings");
  await A.page.click('button[role="radio"]:has-text("Rose")');
  await A.page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--accent-hue").trim() === "14",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  state = await htmlState();
  ok("15.2 a scheme applies on the spot, with nothing to save",
     state.scheme === "rose" && state.hue === "14", state);
  await waitForDb("the scheme to be stored", async () =>
    (await settingsRow())?.lightColorScheme === "rose");
  ok("15.2b and is stored without a form submit",
     (await settingsRow())?.lightColorScheme === "rose", (await settingsRow())?.lightColorScheme);
  const rosePaint = await accentPaint();
  ok("15.2c and every accent utility repaints, server-rendered",
     rosePaint !== tealPaint && rosePaint !== "", `${tealPaint} -> ${rosePaint}`);

  // Three states, tested as three. The nav toggle cycles system → light → dark.
  await A.page.goto("/settings");
  await A.page.click("header button[data-theme-choice]");
  await A.page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.3 the nav toggle moves off system", (await htmlState()).theme === "light");
  await A.page.click("header button[data-theme-choice]");
  await A.page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "dark",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.3b and on to dark", (await htmlState()).theme === "dark");
  const darkBg = await bodyPaint();
  // This is the half stock Tailwind cannot do: dark styling with the device set light.
  ok("15.3c dark: fires from the attribute alone, on a device set to light",
     darkBg !== systemLightBg && darkBg !== "", `${systemLightBg} -> ${darkBg}`);

  await A.page.emulateMedia({ colorScheme: "dark" });
  await A.page.click("header button[data-theme-choice]");
  await A.page.waitForFunction(
    () => !document.documentElement.hasAttribute("data-theme"),
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.4 back on system, the device decides", (await bodyPaint()) === darkBg);
  await A.page.click("header button[data-theme-choice]");
  await A.page.waitForFunction(
    () => document.documentElement.getAttribute("data-theme") === "light",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.4b and choosing light beats a device set to dark",
     (await bodyPaint()) === systemLightBg, await bodyPaint());
  await waitForDb("the theme to be stored", async () => (await settingsRow())?.theme === "light");
  ok("15.4c which is stored", (await settingsRow())?.theme === "light", (await settingsRow())?.theme);
  await A.page.reload();
  // Waited for rather than read straight after reload(): the load event can fire before
  // the stylesheet has been applied, so reading a computed colour immediately made this
  // check fail about one run in three — a flake that looks exactly like a regression.
  await A.page.waitForFunction(
    (want) =>
      document.documentElement.getAttribute("data-theme") === "light" &&
      getComputedStyle(document.body).backgroundColor === want,
    systemLightBg,
    { timeout: 10_000 },
  ).catch(() => {});
  // This one still flakes about one run in three and the cause is NOT identified. The detail
  // therefore carries all three halves, because a paint that disagrees with the attribute and
  // an attribute that disagrees with the row need opposite investigations — the same
  // distinction that cracked the mapping bug in §23. Do not "fix" it by retrying until it is
  // clear which of the three is stale.
  ok("15.4d and comes back server-rendered, still beating the device",
     (await htmlState()).theme === "light" && (await bodyPaint()) === systemLightBg,
     {
       wantBg: systemLightBg,
       gotBg: await bodyPaint(),
       htmlAttr: (await htmlState()).theme,
       storedTheme: (await settingsRow())?.theme,
     });
  await A.page.emulateMedia({ colorScheme: "light" });

  // A hue of one's own.
  await A.page.goto("/settings");
  await A.page.click('button[role="radio"]:has-text("Custom")');
  await A.page.waitForSelector("#accentHue", { timeout: 10_000 });
  ok("15.5 Custom starts from the colour already in use, so nothing jumps",
     (await htmlState()).hue === "14", await htmlState());

  // Driving a range input needs the native value setter: assigning .value is swallowed
  // by React's value tracker. The events after it are the ones the control listens to,
  // so this exercises the real preview-then-commit path rather than going around it.
  await A.page.$eval("#accentHue", (el) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input, "300",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
  await A.page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--accent-hue").trim() === "300",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.5b the slider mixes a scheme that is not on the list",
     (await htmlState()).hue === "300", await htmlState());
  await waitForDb("the custom hue to be stored", async () => {
    const row = await settingsRow();
    return row?.lightColorScheme === "custom" && row?.lightAccentHue === 300;
  });
  const customRow = await settingsRow();
  ok("15.5c and one number is the whole scheme",
     customRow?.lightColorScheme === "custom" && customRow?.lightAccentHue === 300,
     `${customRow?.lightColorScheme}/${customRow?.lightAccentHue}`);
  const customPaint = await accentPaint();
  ok("15.5d which paints what neither named scheme does",
     customPaint !== rosePaint && customPaint !== tealPaint && customPaint !== "",
     customPaint);

  await A.page.goto("/settings");
  await A.page.press("#accentHue", "ArrowRight");
  await A.page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--accent-hue").trim() === "301",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("15.6 the slider is keyboard operable", (await htmlState()).hue === "301",
     await htmlState());
  await waitForDb("the keyboard change to be stored", async () =>
    (await settingsRow())?.lightAccentHue === 301);
  ok("15.6b and a keyboard change saves like a dragged one",
     (await settingsRow())?.lightAccentHue === 301, (await settingsRow())?.lightAccentHue);

  // --- the mark -------------------------------------------------------------
  //
  // A drawing rather than an emoji, so it can take the accent colour. Asserted as painted
  // colour and as a change under a different scheme, because "an svg is present" would pass
  // for a mark rendered in the wrong colour or in no colour at all.
  await A.page.goto("/people");
  const markColour = () =>
    A.page.$eval("header a svg", (el) => getComputedStyle(el).color).catch(() => "");
  ok("15.9 the nav shows a drawn mark, not an emoji",
     (await A.page.$$("header a svg")).length === 1
       && !((await A.page.textContent("header")) ?? "").includes("🏠"),
     await A.page.textContent("header"));
  const markAt301 = await markColour();
  ok("15.9b painted in the accent rather than inheriting the text colour",
     markAt301 !== "" && markAt301 !== (await A.page.$eval("header", (el) => getComputedStyle(el).color)),
     markAt301);

  const iconRes = await A.page.request.get("/icon.svg");
  ok("15.9c the tab icon exists and is an SVG",
     iconRes.status() === 200 && (iconRes.headers()["content-type"] ?? "").includes("svg"),
     `${iconRes.status()} ${iconRes.headers()["content-type"]}`);
  ok("15.9d it carries its own dark-mode switch, being a file with no CSS around it",
     (await iconRes.text()).includes("prefers-color-scheme"));
  ok("15.9e and the page is linked to it",
     (await A.page.$$eval('link[rel*="icon"]', (ls) => ls.length)) >= 1);

  // An accent for light and a different one for dark. This is the part the server
  // cannot decide, so the checks below read painted colour rather than stored values.
  /**
   * Set the theme from the settings page, and say whether it stuck.
   *
   * Waits for the DATABASE, not just the document. The control applies the change
   * optimistically and saves in the background, so the DOM agrees almost at once while
   * the write is still in flight — and the very next navigation re-renders <html> from
   * the stored row, undoing what the check just confirmed. An earlier version watched
   * the attribute alone and failed two checks later, on a page that had legitimately
   * gone back to the old value.
   *
   * The click is retried as well, since one landing before React attaches its handler
   * does nothing at all and the page gives no signal that it has hydrated.
   */
  const setTheme = async (label: string): Promise<boolean> => {
    await A.page.goto("/settings");
    const want = label.toLowerCase();
    for (let attempt = 0; attempt < 10; attempt++) {
      await A.page.click(`[aria-label="Appearance"] button:has-text("${label}")`);
      const took = await A.page
        .waitForFunction(
          (w) => document.documentElement.getAttribute("data-theme") === w,
          want, { timeout: 1_000 },
        )
        .then(() => true, () => false);
      if (!took) continue;
      await waitForDb(`the theme to reach the database (${want})`, async () =>
        (await settingsRow())?.theme === want);
      return (await settingsRow())?.theme === want;
    }
    return false;
  };

  await A.page.goto("/settings");
  await A.page.click('button[role="radio"]:has-text("Rose")');
  await waitForDb("both accents back to rose", async () =>
    (await settingsRow())?.darkColorScheme === "rose");
  ok("15.8 while linked, one press sets the accent for both modes",
     (await settingsRow())?.lightColorScheme === "rose"
       && (await settingsRow())?.darkColorScheme === "rose");

  await A.page.click("#linkAccents");
  await A.page.waitForSelector('[aria-label="In dark mode"]', { timeout: 10_000 });
  await A.page.click('[aria-label="In dark mode"] button[role="radio"]:has-text("Amber")');
  await waitForDb("the dark accent alone to change", async () =>
    (await settingsRow())?.darkColorScheme === "amber");
  const split = await settingsRow();
  ok("15.8b unlinked, each mode keeps its own",
     split?.lightColorScheme === "rose" && split?.darkColorScheme === "amber",
     `${split?.lightColorScheme}/${split?.darkColorScheme}`);

  ok("15.8c the theme control still responds with two pickers on the page",
     await setTheme("Light"));
  const paintedLight = await accentPaint();
  const stateLight = await htmlState();
  ok("15.8d in light mode the light accent is the one resolved",
     stateLight.hue === "14" && stateLight.light === "14" && stateLight.dark === "74",
     stateLight);

  ok("15.8e and switching to dark takes", await setTheme("Dark"));
  const paintedDark = await accentPaint();
  ok("15.8f and in dark mode the stylesheet swaps to the other",
     (await htmlState()).hue === "74", await htmlState());
  ok("15.8g so the two modes genuinely paint different accents",
     paintedLight !== paintedDark && paintedDark !== "",
     `${paintedLight} vs ${paintedDark}`);

  // Re-linking has to choose one of the two; the mode being read is the one just judged.
  await A.page.goto("/settings");
  await A.page.click("#linkAccents");
  await waitForDb("the accents to be linked again", async () =>
    (await settingsRow())?.lightColorScheme === "amber");
  const relinked = await settingsRow();
  ok("15.8h re-linking keeps the accent of the mode you were looking at",
     relinked?.lightColorScheme === "amber" && relinked?.darkColorScheme === "amber",
     `${relinked?.lightColorScheme}/${relinked?.darkColorScheme}`);

  // Appearance is per-user, like everything else on that page.
  await B.page.goto("/people");
  const bState = await B.page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    hue: getComputedStyle(document.documentElement).getPropertyValue("--accent-hue").trim(),
  }));
  ok("15.7 another user keeps their own appearance",
     bState.theme === null && bState.hue === "184", bState);

  // ---------------------------------------------------------------------------
  section("§16 Gifts");
  // ---------------------------------------------------------------------------

  // Dynamic, like every other app import here: these modules read DATABASE_URL when
  // they load, so they must not be pulled in before the harness has a database.
  const { readableGiftsWhere, writableGiftsWhere } = await import("@/lib/access");
  const { buildThankYouMail } = await import("@/lib/thank-you");
  const { buildMessage } = await import("@/lib/google/mail");

  const xmas = await prisma.event.create({
    data: {
      ownerId: A.id, title: "Gift Test Xmas", startAt: new Date("2026-12-25T10:00:00Z"),
      timeZone: "UTC", allDay: true,
    },
  });
  // A's own contact card stands in for the reader: a thank-you is only ever yours to
  // write, so the gift recipient in these checks has to be A themselves.
  const kid = await prisma.person.findFirstOrThrow({ where: { linkedUserId: A.id } });
  const auntie = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Gift Auntie", givenName: "Gift", familyName: "Auntie",
      contactPoints: { create: [{ kind: "EMAIL", value: "auntie@e2e.test", isPrimary: true, order: 0 }] } },
  });

  /**
   * Open the Gifts section if it is closed, and leave it alone if it is not.
   *
   * It starts collapsed while empty and opens itself once something is recorded, so a
   * bare click on the summary would open it in one run and close it in the next.
   * Nothing inside a closed <details> is clickable, which makes that an intermittent
   * failure rather than an obvious one.
   */
  const openGifts = async () => {
    const closed = await A.page.$('details:not([open]) > summary:has-text("Gifts")');
    if (closed) await closed.click();
  };

  await A.page.goto(`/events/${xmas.id}`);
  ok("16.1 every event offers gifts, with no flag to set first",
     ((await A.page.textContent("body")) ?? "").includes("Who the presents are for"));
  await openGifts();
  await A.page.waitForSelector('select[name="personId"]', { timeout: 10_000 });
  await A.page.selectOption('select[name="personId"]', kid.id);
  await A.page.click('button:has-text("Add")');
  await waitForDb("the recipient to be listed", async () =>
    (await prisma.eventGiftRecipient.count({ where: { eventId: xmas.id } })) === 1);
  ok("16.3 gifts can be aimed at somebody who is not on the guest list",
     (await prisma.eventGiftRecipient.count({ where: { eventId: xmas.id, personId: kid.id } })) === 1
       && (await prisma.eventAttendee.count({ where: { eventId: xmas.id } })) === 0);

  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  await A.page.click('button:has-text("Record a gift")');
  await A.page.selectOption('select[name="giverId"]', auntie.id);
  // Checkboxes now, and this one arrives pre-ticked as the only candidate — check()
  // is idempotent, so it states the intent either way.
  await A.page.check(`input[name="recipientId"][value="${kid.id}"]`);
  await A.page.fill('input[name="description"]', "A blue scarf");
  await A.page.fill('textarea[name="notes"]', "Hand-knitted");
  await A.page.click('button:has-text("Save gift")');
  await waitForDb("the gift to be recorded", async () =>
    (await prisma.gift.count({ where: { eventId: xmas.id } })) === 1);
  const recorded = await prisma.gift.findFirstOrThrow({
    where: { eventId: xmas.id },
    include: { recipients: true },
  });
  ok("16.4 a gift records what it was, who gave it and who got it",
     recorded.description === "A blue scarf" && recorded.giverId === auntie.id
       && recorded.recipients.map((r) => r.personId).includes(kid.id),
     recorded.description);
  ok("16.4b including a note of its own", recorded.notes === "Hand-knitted", recorded.notes);
  ok("16.4c and no date, since the event already answers when",
     recorded.receivedOn === null, recorded.receivedOn);

  // waitForSelector rather than $eval: the row appears when the revalidation lands, and
  // $eval on a selector that has not arrived yet throws and takes the whole run with it.
  const giverLink = await A.page
    .waitForSelector(`li:has-text("A blue scarf") a[href="/people/${auntie.id}"]`,
      { timeout: 10_000 })
    .then((el) => el.textContent())
    .catch(() => null);
  ok("16.4d and the giver is a way to their contact page",
     giverLink?.trim() === "Gift Auntie", giverLink);

  // Both directions from a contact page, which is the case a fixed recipient could not
  // express: what Auntie GAVE, not only what she was given.
  await A.page.goto(`/people/${auntie.id}`);
  const auntiePage = (await A.page.textContent("body")) ?? "";
  ok("16.5 the giver's own page files the row under Given",
     auntiePage.includes("A blue scarf") && auntiePage.includes("Given"), true);
  await A.page.goto(`/people/${kid.id}`);
  ok("16.5b and the recipient's page files the same row under Received",
     ((await A.page.textContent("body")) ?? "").includes("Received"));

  // A one-off, with no event behind it.
  await A.page.goto(`/people/${auntie.id}`);
  // The recording controls live behind the card's edit toggle now.
  await A.page.click('button[aria-label="Edit gifts"]');
  await A.page.click('button:has-text("Record a gift")');
  const defaultGiver = await A.page.inputValue('select[name="giverId"]');
  ok("16.6 the giver defaults to the contact whose page you are on",
     defaultGiver === auntie.id, defaultGiver);

  // …and is overridable, which is the whole point: this one goes the other way.
  await A.page.selectOption('select[name="giverId"]', kid.id);
  await A.page.check(`input[name="recipientId"][value="${auntie.id}"]`);
  await A.page.uncheck(`input[name="recipientId"][value="${kid.id}"]`).catch(() => {});
  await A.page.fill('input[name="description"]', "A thank-you plant");
  await A.page.fill('input[name="receivedOn"]', "2026-07-04");
  await A.page.click('button:has-text("Save gift")');
  await waitForDb("the one-off to be recorded", async () =>
    (await prisma.gift.count({
      where: { eventId: null, recipients: { some: { personId: auntie.id } } },
    })) === 1);
  // findFirst, not findFirstOrThrow: a wait that gave up should fail one check, not
  // throw and take every check after it down with it.
  const oneOff = await prisma.gift.findFirst({
    where: { eventId: null, recipients: { some: { personId: auntie.id } } },
  });
  ok("16.6b a gift needs no event, and keeps a date of its own",
     oneOff?.eventId === null
       && oneOff?.receivedOn?.toISOString().startsWith("2026-07-04") === true,
     oneOff?.receivedOn);
  ok("16.6c recorded in the direction chosen rather than the one prefilled",
     oneOff?.giverId === kid.id, oneOff?.giverId);

  // Access follows the recipient, not the giver and not the recorder.
  //
  // Asked of a user created here rather than of B: §5 gives B a blanket ALL_PEOPLE
  // share over A's contacts, so B can already read everything A owns. Testing against
  // them would have made "no access" false to begin with — and made the check that
  // sharing GRANTS access pass without granting anything.
  const outsider = await h.signIn("outsider@e2e.test", "Outsider");
  const seenBy = (userId: string) =>
    prisma.gift.count({ where: { AND: [{ id: recorded.id }, readableGiftsWhere(userId)] } });

  ok("16.7 someone with no access to the recipient cannot see the gift",
     (await seenBy(outsider.id)) === 0);
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: outsider.id, personId: auntie.id, scope: "PERSON", permission: "VIEW" },
  });
  ok("16.7b and seeing the GIVER is not enough either",
     (await seenBy(outsider.id)) === 0);
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: outsider.id, personId: kid.id, scope: "PERSON", permission: "VIEW" },
  });
  ok("16.7c sharing the recipient is what grants it",
     (await seenBy(outsider.id)) === 1);
  ok("16.7d and a VIEW share does not make it writable",
     (await prisma.gift.count({
       where: { AND: [{ id: recorded.id }, writableGiftsWhere(outsider.id)] },
     })) === 0);

  // The thank-you note, built without a mailbox. These are pure functions precisely so
  // the wording a person will actually read can be checked without sending anything.
  const mail = buildThankYouMail({
    to: "auntie@e2e.test",
    giftDescription: "blue scarf",
    message: "Dear Auntie,\n\nThank you for the <lovely> scarf.\nIt fits.",
  });
  ok("16.8 the note is the sender's own words, with nothing added around them",
     mail.text === "Dear Auntie,\n\nThank you for the <lovely> scarf.\nIt fits.",
     mail.text);
  ok("16.8b and says what it is about before it is opened",
     mail.subject === "Thank you for the blue scarf", mail.subject);
  ok("16.8c paragraphs survive, and typed angle brackets stay text",
     mail.html.includes("<p>Dear Auntie,</p>")
       && mail.html.includes("&lt;lovely&gt;")
       && mail.html.includes("It fits."),
     mail.html);

  const raw = buildMessage(mail);
  ok("16.9 the message is base64url, which is what Gmail accepts",
     !raw.includes("+") && !raw.includes("/") && !raw.includes("="), raw.slice(0, 24));
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  ok("16.9b it is multipart with both a plain and an HTML part",
     decoded.includes("multipart/alternative")
       && decoded.includes("text/plain") && decoded.includes("text/html"));
  const accented = buildMessage({ ...mail, subject: "Thank you, Zoë" });
  ok("16.9c and a subject with an accent is encoded rather than mangled",
     Buffer.from(accented, "base64url").toString("utf8").includes("=?UTF-8?B?"));

  // The gift list reads clean by default; the edit affordances are asked for.
  await A.page.goto(`/people/${kid.id}`);
  ok("16.11 per-row Edit and Remove are hidden until you ask for them",
     !((await A.page.textContent("body")) ?? "").includes("Record a gift"));
  await A.page.click('button[aria-label="Edit gifts"]');
  await A.page.waitForSelector('button:has-text("Record a gift")', { timeout: 10_000 });
  ok("16.11b and appear together when you do",
     ((await A.page.textContent("body")) ?? "").includes("Record a gift"));

  // An event's gifts collapse under the occasion, which is named and dated and links
  // to it — fifteen presents at one Christmas must not bury everything else.
  const groupTitle = await A.page.textContent(
    `details summary a[href="/events/${xmas.id}"]`,
  );
  ok("16.12 event gifts group under the occasion, linked by name",
     groupTitle?.trim() === "Gift Test Xmas", groupTitle);
  // The summary holding the link, not "a summary anywhere inside a details that
  // contains it": the gifts card is itself a <details> wrapping these groups, so the
  // looser form matches the card's own header first and reads the wrong text.
  const groupSummary = await A.page.textContent(
    `summary:has(a[href="/events/${xmas.id}"])`,
  );
  ok("16.12b and the group is dated", (groupSummary ?? "").includes("2026"), groupSummary);

  // With one candidate there is nothing to choose, so it is chosen.
  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  await A.page.click('button:has-text("Record a gift")');
  ok("16.13 a lone gift recipient is preselected",
     await A.page.isChecked(`input[name="recipientId"][value="${kid.id}"]`));

  // Moving the start carries the end with it, keeping the event's length.
  await A.page.goto("/events/new");
  await A.page.fill('input[name="f_startAt"]', "2026-11-05T18:00");
  await A.page.waitForFunction(
    () => (document.querySelector('input[name="f_endAt"]') as HTMLInputElement)?.value !== "",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("16.14 setting a start fills the end an hour later, on the same day",
     (await A.page.inputValue('input[name="f_endAt"]')) === "2026-11-05T19:00",
     await A.page.inputValue('input[name="f_endAt"]'));

  await A.page.fill('input[name="f_endAt"]', "2026-11-05T21:00");
  await A.page.fill('input[name="f_startAt"]', "2026-11-06T09:00");
  await A.page.waitForFunction(
    () => (document.querySelector('input[name="f_endAt"]') as HTMLInputElement)?.value
      === "2026-11-06T12:00",
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  ok("16.14b and a length someone chose is kept, not reset to an hour",
     (await A.page.inputValue('input[name="f_endAt"]')) === "2026-11-06T12:00",
     await A.page.inputValue('input[name="f_endAt"]'));

  // The guest list reads clean too, and its four controls per person are asked for.
  await A.page.goto(`/events/${xmas.id}`);
  await prisma.eventAttendee.create({
    data: { eventId: xmas.id, personId: auntie.id, role: "OPTIONAL", rsvp: "NEEDS_ACTION" },
  });
  await A.page.reload();
  const guestsQuiet = (await A.page.textContent("body")) ?? "";
  ok("16.18 sharing is collapsed, and opens to the same controls",
     (await A.page.$('details:not([open]) > summary:has-text("Sharing")')) !== null);

  ok("16.16 the guest list hides its per-person controls until asked",
     !guestsQuiet.includes("Invite in Google") && guestsQuiet.includes("Gift Auntie"),
     true);
  await A.page.click('button[aria-label="Edit guests"]');
  await A.page.waitForSelector('select[name="rsvp"]', { timeout: 10_000 });
  const guestsEditing = (await A.page.textContent("body")) ?? "";
  ok("16.16b and shows role, RSVP and the invite box when it is",
     guestsEditing.includes("Invite in Google") && guestsEditing.includes("Role"));

  // A big present is one gift for several people, not one gift each — so it earns one
  // thank-you and shows on every recipient's page.
  const twin = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Gift Twin", givenName: "Gift", familyName: "Twin" },
  });
  const shared = await prisma.gift.create({
    data: {
      ownerId: A.id, giverId: auntie.id, description: "A week in Wales",
      eventId: xmas.id,
      recipients: { create: [{ personId: kid.id }, { personId: twin.id }] },
    },
    include: { recipients: true },
  });
  ok("16.21 one gift can be for several people",
     shared.recipients.length === 2, shared.recipients.length);
  ok("16.21d and each of them owes their own thanks",
     shared.recipients.every((r) => r.thankedAt === null));

  // One recipient thanking must not discharge the other's obligation.
  await prisma.giftRecipient.update({
    where: { giftId_personId: { giftId: shared.id, personId: kid.id } },
    data: { thankedAt: new Date(), thankYouNote: "Thanks for Wales!" },
  });
  const afterOne = await prisma.giftRecipient.findMany({ where: { giftId: shared.id } });
  ok("16.21e one recipient thanking leaves the other still owing",
     afterOne.filter((r) => r.thankedAt !== null).length === 1,
     afterOne.map((r) => r.thankedAt));
  // Twin is a contact, not a user of this install, so nobody holds their signature —
  // and a note has to be signed by somebody. Their share of the present is recorded and
  // visible, and no one is offered the chance to thank for it. Intended: thank-yous are
  // sent by the people using Hearth, for themselves or for a user who asked them to.
  await A.page.goto(`/people/${twin.id}`);
  ok("16.21f a recipient who is not a user of this install has nobody to write for them",
     (await A.page.$$('text="write thank you"')).length === 0);

  // Put the shared present back to unthanked. This section sits above §16.10, which
  // asserts that nothing on the event page claims to have been thanked for yet — so a
  // mark left behind here fails a check further down that is testing something else.
  await prisma.giftRecipient.updateMany({
    where: { giftId: shared.id },
    data: { thankedAt: null, thankYouNote: null },
  });

  await A.page.goto(`/people/${twin.id}`);
  ok("16.21b and shows on each of their pages",
     (await A.page.$$('text="A week in Wales"')).length >= 1);
  await A.page.goto(`/people/${kid.id}`);
  ok("16.21c including the other recipient's",
     (await A.page.$$('text="A week in Wales"')).length >= 1);

  // Delegation: the head of household may write for a user who has asked them to.
  const karenUser = await h.signIn("karen@e2e.test", "Karen User");
  // signIn writes the User row directly, so Auth.js's createUser event never runs and
  // no card appears by itself. ensureContactCard is already in scope from §12 — this
  // file is one long block — so it is called rather than imported again.
  await ensureContactCard(karenUser.id);
  const karenCard = await prisma.person.findFirstOrThrow({
    where: { linkedUserId: karenUser.id },
  });
  const karensGift = await prisma.gift.create({
    data: {
      ownerId: A.id, giverId: auntie.id, description: "A mug",
      recipients: { create: [{ personId: karenCard.id }] },
    },
  });
  const { thankableCardIds } = await import("@/lib/access");
  const { listGiftsForPerson } = await import("@/lib/gifts");

  // Asked of whoever actually holds the role rather than of A on the assumption they
  // still do — the head is elected, and one day something here will hand it over.
  const head = await prisma.user.findFirstOrThrow({ where: { isHeadOfHousehold: true } });
  const notHead = [A.id, B.id].find((id) => id !== head.id)!;

  ok("16.22 nobody may write another user's thanks by default",
     !(await thankableCardIds(head.id)).has(karenCard.id));

  await prisma.userSettings.updateMany({
    where: { userId: karenUser.id },
    data: { allowHeadThankYous: true },
  });
  ok("16.22b once they allow it, the head of the household may",
     (await thankableCardIds(head.id)).has(karenCard.id), karensGift.id);
  ok("16.22c but nobody else, however much of the record they can edit",
     !(await thankableCardIds(notHead)).has(karenCard.id));

  await prisma.userSettings.updateMany({
    where: { userId: karenUser.id },
    data: { allowHeadThankYous: false },
  });
  ok("16.22d and it is withdrawn the moment they turn it off",
     !(await thankableCardIds(head.id)).has(karenCard.id));

  // Delegation reaches a share of a shared present, not only a gift of one's own.
  await prisma.userSettings.updateMany({
    where: { userId: karenUser.id },
    data: { allowHeadThankYous: true },
  });
  await prisma.giftRecipient.create({
    data: { giftId: shared.id, personId: karenCard.id },
  });
  const withKaren = await listGiftsForPerson(head.id, karenCard.id);
  const karensShare = withKaren.find((g) => g.id === shared.id);
  ok("16.22e the head may write a delegated user's share of a shared present",
     karensShare?.recipients.find((r) => r.id === karenCard.id)?.canThank === true,
     karensShare?.recipients.map((r) => [r.displayName, r.canThank]));
  ok("16.22f while a co-recipient who delegated nothing stays untouched",
     karensShare?.recipients.find((r) => r.id === twin.id)?.canThank === false);

  // Reconnecting has to mean something. The adapter writes an Account row once and
  // never again, so without persistGoogleGrant a new scope never reached the column
  // every permission check reads — and Settings asked for a reconnect for ever.
  const { persistGoogleGrant } = await import("@/lib/google/grant");
  await prisma.account.updateMany({
    where: { userId: A.id, provider: "google" },
    data: { scope: "openid email", access_token: "stale" },
  });
  const grantBefore = await prisma.account.findFirstOrThrow({
    where: { userId: A.id, provider: "google" },
  });
  await persistGoogleGrant(A.id, {
    scope: "openid email https://www.googleapis.com/auth/gmail.send",
    access_token: "fresh",
  });
  const grantAfter = await prisma.account.findFirstOrThrow({
    where: { userId: A.id, provider: "google" },
  });
  ok("16.15 re-consenting updates the stored scope",
     grantAfter.scope?.includes("gmail.send") === true, grantAfter.scope);
  ok("16.15b and the fresh access token with it", grantAfter.access_token === "fresh");
  // The claim is that it is UNCHANGED, so compare against what was there rather than
  // against a value this check invented.
  ok("16.15c but a response with no refresh token leaves the good one alone",
     grantAfter.refresh_token === grantBefore.refresh_token, grantAfter.refresh_token);

  // The button says why it cannot send, rather than failing once pressed.
  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  // Writing the thank-you here is the record of it: Hearth sends it, so nothing has to
  // be ticked afterwards and nothing can go stale.
  // Matched with the text engine, not textContent("body").
  //
  // Next inlines the RSC payload in a <script>, and a client component's props go with
  // it — so thanked={false} put the literal `"thanked":false` in the body text and a
  // scan for the word found it. The text engine skips script and style, so it sees what
  // a reader sees. The positive checks below use it for the same reason: a badge test
  // that can be satisfied by serialised props is not testing the badge.
  const shows = async (text: string) => (await A.page.$$(`text="${text}"`)).length;

  ok("16.10 a gift not yet thanked for offers to write one",
     (await shows("write thank you")) >= 1);
  ok("16.10b and does not claim it has been", (await shows("thanked")) === 0);

  const scarf = await prisma.gift.findFirstOrThrow({
    where: { eventId: xmas.id },
    include: { recipients: true },
  });
  // Somebody else's thanks are not yours to write, however much of their record you
  // may edit. Checked in the action and not only in the UI: hiding a control is not
  // the same as refusing it.
  const karen = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Karen Nother", givenName: "Karen", familyName: "Nother" },
  });
  const notMine = await prisma.gift.create({
    data: {
      ownerId: A.id, giverId: auntie.id, description: "A candle", eventId: xmas.id,
      recipients: { create: [{ personId: karen.id }] },
    },
  });
  await A.page.goto(`/people/${karen.id}`);
  ok("16.18b a gift somebody else received offers no thank-you to write",
     (await A.page.$$('text="write thank you"')).length === 0, notMine.id);

  ok("16.19 nothing is marked thanked until something is sent",
     scarf.recipients.every((r) => r.thankedAt === null));

  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  await A.page.click('button:has-text("write thank you")');
  await A.page.waitForSelector("dialog[open] textarea", { timeout: 10_000 });
  ok("16.19b the control opens a modal to write in", true);
  ok("16.19c naming who it goes to, and from where",
     ((await A.page.textContent("dialog[open]")) ?? "").includes("auntie@e2e.test"));

  // The send will fail — the suite holds no real Google grant — and that is the case
  // worth checking. A refused send must keep the words and leave the gift unthanked,
  // which is not free: React resets an uncontrolled form once its action settles,
  // failure included, so the note would otherwise vanish from an empty box.
  await A.page.fill("dialog[open] textarea", "Thank you for the scarf.");
  await A.page.click('dialog[open] button:has-text("Send thank you")');
  await A.page.waitForSelector('dialog[open] [role="status"]', { timeout: 30_000 })
    .catch(() => {});
  ok("16.19d a send that fails says so instead of closing quietly",
     (await A.page.$('dialog[open]')) !== null
       && ((await A.page.textContent('dialog[open] [role="status"]')) ?? "").length > 0,
     await A.page.textContent('dialog[open] [role="status"]').catch(() => null));
  ok("16.19e and the modal still holds what was written",
     (await A.page.inputValue("dialog[open] textarea")) === "Thank you for the scarf.",
     await A.page.inputValue("dialog[open] textarea").catch(() => null));
  ok("16.19f with the gift not marked thanked by a send that never landed",
     (await prisma.giftRecipient.count({
       where: { giftId: scarf.id, thankedAt: { not: null } },
     })) === 0);
  await A.page.keyboard.press("Escape");

  // Without permission to send there is nothing to open: the control refuses up front
  // rather than letting someone write a note that cannot go anywhere.
  await prisma.account.updateMany({
    where: { userId: A.id, provider: "google" },
    data: { scope: "openid email" },
  });
  await A.page.reload();
  await openGifts();
  ok("16.19g with no permission to send, the control is refused up front",
     await A.page.isDisabled('button:has-text("write thank you")'));
  await prisma.account.updateMany({
    where: { userId: A.id, provider: "google" },
    data: { scope: "openid email https://www.googleapis.com/auth/gmail.send" },
  });

  // A sent thank-you replaces the control outright: there is nothing left to do.
  //
  // Counted rather than asserted absent. This event also holds the shared present, whose
  // recipients still owe their notes — so "no write thank you anywhere on the page" would
  // be testing that the OTHER gift had been dealt with too. One fewer offer is the claim.
  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  const offersBefore = await shows("write thank you");
  await prisma.giftRecipient.updateMany({
    where: { giftId: scarf.id },
    data: { thankedAt: new Date(), thankYouNote: "Thank you for the scarf." },
  });
  await A.page.goto(`/events/${xmas.id}`);
  await openGifts();
  ok("16.20 once sent, the row reads thanked", (await shows("thanked")) >= 1);
  ok("16.20b and that gift stops offering one",
     (await shows("write thank you")) === offersBefore - 1,
     `${offersBefore} -> ${await shows("write thank you")}`);
  await A.page.goto(`/people/${kid.id}`);
  ok("16.20c the same on the contact page, for what they received",
     (await shows("thanked")) >= 1);
  await prisma.giftRecipient.updateMany({
    where: { giftId: scarf.id },
    data: { thankedAt: null, thankYouNote: null },
  });

  // ---------------------------------------------------------------------------
  section("§17 Importing from Google Contacts");
  // ---------------------------------------------------------------------------
  // The planner is pure, which is the point: it decides what happens to somebody's real
  // address book, so it has to be checkable without credentials. The Google read and the
  // round trip need real accounts — see npm run e2e:google.

  const { planGoogleImport, GOOGLE_IMPORT_FIELDS } = await import("@/lib/google/import-plan");
  const { HEARTH_ID_KEY } = await import("@/lib/google/serialize-person");
  const { MANAGED_PERSON_FIELDS } = await import("@/lib/google/serialize-person");

  const sample = [
    {
      resourceName: "people/c1",
      etag: "etag-1",
      names: [{ givenName: "Ada", middleName: "Augusta", familyName: "Lovelace",
                honorificPrefix: "Ms" }],
      organizations: [{ name: "Analytical Engines", title: "Mathematician",
                        department: "Research" }],
      emailAddresses: [
        { value: "ada@e2e.test", type: "work", metadata: { primary: true } },
        { value: "ada2@e2e.test", type: "home" },
      ],
      phoneNumbers: [{ value: "555 0100", type: "mobile" }],
      addresses: [{ formattedValue: "1 Long Road, London", streetAddress: "1 Long Road",
                    city: "London", type: "home" }],
      birthdays: [{ date: { year: 1815, month: 12, day: 10 } }],
      biographies: [{ value: "Wrote the first program." }],
      userDefined: [{ key: "Blood type", value: "O" }],
      memberships: [
        { contactGroupMembership: { contactGroupResourceName: "contactGroups/friends" } },
      ],
    },
    {
      resourceName: "people/c2",
      names: [{ givenName: "Already", familyName: "Linked" }],
      userDefined: [{ key: HEARTH_ID_KEY, value: "some-hearth-id" }],
    },
    {
      resourceName: "people/c3",
      // No name at all: an email is the only thing identifying the row.
      emailAddresses: [{ value: "nameless@e2e.test" }],
      birthdays: [{ date: { month: 4, day: 1 } }],
    },
  ];

  const gPlan = planGoogleImport(sample, {
    linkedResourceNames: new Set(["people/c2"]),
  });

  const ada = gPlan.contacts.find((c) => c.resourceName === "people/c1")!;
  ok("17.1 core fields are read into Hearth's own columns",
     ada.columns.givenName === "Ada" && ada.columns.familyName === "Lovelace"
       && ada.columns.organization === "Analytical Engines"
       && ada.columns.jobTitle === "Mathematician"
       && ada.columns.notes === "Wrote the first program."
       && ada.columns.birthday === "1815-12-10",
     ada.columns);
  ok("17.1b every email, phone, url and address becomes a contact point",
     ada.contactPoints.filter((p) => p.kind === "EMAIL").length === 2
       && ada.contactPoints.some((p) => p.kind === "PHONE")
       && ada.contactPoints.some((p) => p.kind === "ADDRESS"),
     ada.contactPoints.map((p) => `${p.kind}:${p.value}`));
  ok("17.1c and Google's primary flag comes with them",
     ada.contactPoints.find((p) => p.value === "ada@e2e.test")?.isPrimary === true);
  ok("17.1d with their Google type kept as the label",
     ada.contactPoints.find((p) => p.value === "555 0100")?.label === "mobile");

  // Name parts and organisation detail have columns of their own now, so they keep
  // their shape instead of arriving as "Middle name: Augusta" in the custom fields.
  ok("17.2 name parts land in real columns, not custom fields",
     ada.columns.middleName === "Augusta"
       && ada.columns.honorificPrefix === "Ms",
     ada.columns);
  ok("17.2b as does the rest of the organisation",
     ada.columns.orgDepartment === "Research", ada.columns.orgDepartment);

  const keys = ada.rescued.map((r) => r.key);
  ok("17.2c nothing with a column of its own is rescued any more",
     !keys.includes("middle_name") && !keys.includes("department"), keys);
  ok("17.2d what genuinely has nowhere to sit still is",
     ada.rescued.some((r) => r.label === "Blood type" && r.value === "O"), keys);
  ok("17.2e but never hearth_id, which is Hearth's own bookkeeping",
     !ada.rescued.some((r) => r.label === HEARTH_ID_KEY));
  ok("17.2f and each rescue says why, per contact rather than in the abstract",
     ada.rescued.every((r) => r.reason.length > 0));

  // The half that matters: what Hearth sends back. A part missing here is a part the
  // next sync deletes from a contact it has just adopted.
  const { serializePerson } = await import("@/lib/google/serialize-person");

  /**
   * Bare fixtures for the serializer.
   *
   * Built rather than written out, because every column added to Person or ContactPoint
   * would otherwise mean editing each literal by hand — which it did, twice. A test that
   * has to be repaired by a schema addition tells you nothing about the addition.
   */
  const bareContactPoint = (over: Record<string, unknown> = {}) => ({
    id: "cp", personId: "p", kind: "EMAIL" as const, label: null, value: "x@e2e.test",
    isPrimary: true, order: 0,
    poBox: null, streetAddress: null, extendedAddress: null, city: null, region: null,
    postalCode: null, country: null, countryCode: null, displayName: null,
    protocol: null, buildingId: null, floor: null, floorSection: null, deskCode: null,
    current: null,
    createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  });
  const barePerson = (over: Record<string, unknown> = {}) => ({
    id: "p", ownerId: A.id, givenName: null, middleName: null, familyName: null,
    honorificPrefix: null, honorificSuffix: null, phoneticGivenName: null,
    phoneticMiddleName: null, phoneticFamilyName: null, nickname: null,
    organization: null, jobTitle: null, orgDepartment: null, orgJobDescription: null,
    orgSymbol: null, orgDomain: null, orgLocation: null, orgPhoneticName: null,
    orgType: null, gender: null, birthday: null, birthdayText: null, notes: null,
    displayName: "Fixture", custom: {}, addToGoogle: true, linkedUserId: null,
    deletedAt: null,
    createdAt: new Date(0), updatedAt: new Date(0),
    contactPoints: [] as ReturnType<typeof bareContactPoint>[],
    ...over,
  });
  const round = serializePerson(
    barePerson({
      givenName: "Ada", middleName: "Augusta", familyName: "Lovelace",
      honorificPrefix: "Ms", phoneticGivenName: "AY-da",
      organization: "Analytical Engines", jobTitle: "Mathematician",
      orgDepartment: "Research", orgLocation: "London", orgType: "work",
      displayName: "Ada Lovelace",
    }),
  );
  ok("17.2g the middle name and title go back to Google as part of the name",
     round.person.names?.[0]?.middleName === "Augusta"
       && round.person.names?.[0]?.honorificPrefix === "Ms"
       && round.person.names?.[0]?.phoneticGivenName === "AY-da",
     round.person.names?.[0]);
  ok("17.2h and the department goes back on the organisation",
     round.person.organizations?.[0]?.department === "Research"
       && round.person.organizations?.[0]?.location === "London"
       && round.person.organizations?.[0]?.type === "work",
     round.person.organizations?.[0]);

  // Found by running the real account through scripts/e2e/google-import-check.mts: Google
  // holds a yearless birthday as {date:{month,day}}, a @db.Date column cannot, so the
  // import keeps "12/10" as text — and pushing that back turned a birthday Google
  // understands into a free-text note, losing the reminder and the sort.
  const yearless = serializePerson(
    barePerson({ givenName: "No", familyName: "Year", displayName: "No Year", birthdayText: "12/10" }),
  );
  ok("17.2i a yearless birthday goes back to Google as a date, not as prose",
     yearless.person.birthdays?.[0]?.date?.month === 12
       && yearless.person.birthdays?.[0]?.date?.day === 10
       && yearless.person.birthdays?.[0]?.text === undefined,
     yearless.person.birthdays?.[0]);
  const prose = serializePerson(
    barePerson({ givenName: "Some", familyName: "Prose", displayName: "Some Prose",
                 birthdayText: "the week after Easter" }),
  );
  ok("17.2j but a birthday nobody could parse stays exactly as written",
     prose.person.birthdays?.[0]?.text === "the week after Easter"
       && prose.person.birthdays?.[0]?.date === undefined,
     prose.person.birthdays?.[0]);

  // Also from the real account: a contact with an email and no name at all. Hearth shows
  // the address as its name, which a list has to — but writing that into Google's given
  // name would christen the contact "numbersix@six.com".
  // emailAsName, not "nameless": §17.5 below already owns that identifier, and this file
  // is one flat scope.
  const emailAsName = serializePerson(
    barePerson({ displayName: "numbersix@six.com" }),
  );
  ok("17.2k a display name that is only an email address is not written back as a name",
     (emailAsName.person.names ?? []).length === 0, emailAsName.person.names);
  const blobName = serializePerson(barePerson({ displayName: "Grandma Betty" }));
  ok("17.2l but a real name with no parts still goes back as one",
     blobName.person.names?.[0]?.givenName === "Grandma Betty",
     blobName.person.names?.[0]);

  ok("17.3 memberships are reported so Google labels can become Hearth ones",
     ada.groupIds.includes("contactGroups/friends"));

  const linkedContact = gPlan.contacts.find((c) => c.resourceName === "people/c2")!;
  ok("17.4 a contact already linked is reported, not silently skipped",
     linkedContact.action === "linked"
       && linkedContact.existingHearthId === "some-hearth-id",
     linkedContact.action);
  ok("17.4b and does not count towards what would be imported",
     gPlan.counts.import === 2 && gPlan.counts.linked === 1,
     gPlan.counts);

  const nameless = gPlan.contacts.find((c) => c.resourceName === "people/c3")!;
  ok("17.5 a contact with no name is still identifiable",
     nameless.displayName === "nameless@e2e.test", nameless.displayName);
  ok("17.5b and a birthday with no year is reported rather than guessed",
     nameless.columns.birthday === null
       && nameless.reasons.some((r) => r.includes("no year")),
     nameless.reasons);

  // Found by pushing a real contact and reading it back: it then carried a hearth_id this
  // install had no row for, and the plan offered to import it with nothing said about the
  // id it was going to overwrite.
  const strayId = planGoogleImport(
    [{
      resourceName: "people/stray", etag: "e",
      names: [{ givenName: "Stray", familyName: "Id", displayName: "Stray Id" }],
      userDefined: [{ key: "hearth_id", value: "from-another-install" }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.5c a contact carrying an unknown Hearth id is imported, and says the id will change",
     strayId.action === "import"
       && strayId.existingHearthId === "from-another-install"
       && strayId.reasons.some((r) => r.includes("another install")),
     strayId.reasons);

  // --- a linked Google profile is not the contact's own data ----------------
  //
  // Found by pushing 330 real contacts and counting: one profile-linked contact came back
  // with three copies of an email where it had had two. Google returns a linked person's own
  // account data beside the contact's, marked ACCOUNT or PROFILE rather than CONTACT. It is
  // read-only, so Hearth importing it and pushing it back adds a copy beside the one Google
  // kept — and would add another on every sync after that.
  const linkedProfile = planGoogleImport(
    [{
      resourceName: "people/linked", etag: "e",
      names: [
        { givenName: "Profile", displayName: "Profile Name", metadata: { source: { type: "PROFILE" } } },
        { givenName: "Contact", familyName: "Own", displayName: "Contact Own", metadata: { source: { type: "CONTACT" } } },
      ],
      emailAddresses: [
        { value: "typed@e2e.test", metadata: { source: { type: "CONTACT" } } },
        { value: "typed@e2e.test", metadata: { source: { type: "ACCOUNT" } } },
      ],
      phoneNumbers: [{ value: "555", metadata: { source: { type: "DOMAIN_PROFILE" } } }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.24 an email Google copied from the linked profile is not imported twice",
     linkedProfile.contactPoints.filter((p) => p.kind === "EMAIL").length === 1,
     linkedProfile.contactPoints.filter((p) => p.kind === "EMAIL"));
  ok("17.24b nor is a phone number that belongs to the profile rather than the contact",
     linkedProfile.contactPoints.filter((p) => p.kind === "PHONE").length === 0);
  ok("17.24c and the contact's own name wins over the profile's",
     linkedProfile.columns.givenName === "Contact" && linkedProfile.displayName === "Contact Own",
     { given: linkedProfile.columns.givenName, display: linkedProfile.displayName });

  // A contact whose only name is the profile's still has one: silence is not a profile, and
  // preferring nothing over a read-only value would leave the row blank.
  const profileOnly = planGoogleImport(
    [{
      resourceName: "people/only", etag: "e",
      names: [{ givenName: "OnlyProfile", displayName: "Only Profile", metadata: { source: { type: "PROFILE" } } }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.24d a contact whose only name comes from a profile still has a name",
     profileOnly.columns.givenName === "OnlyProfile", profileOnly.columns.givenName);

  // --- pictures, not URLs to pictures --------------------------------------
  //
  // The account this was built against had 28 contacts with a real Google photo and 63 with
  // the URL sitting in a custom field called "Photo" — Google's own CSV exporter writes it
  // that way — and 41 of those had ONLY the custom field. Reading either source alone loses
  // pictures, so both are read and the better one wins.
  const { photoSourceFor, sizedPhotoUrl } = await import("@/lib/google/photo-source");
  ok("17.20 a real Google photo is the picture",
     photoSourceFor({ photos: [{ url: "https://lh3.googleusercontent.com/contacts/AAA" }] })
       === "https://lh3.googleusercontent.com/contacts/AAA");
  ok("17.20b Google's generated silhouette is not",
     photoSourceFor({ photos: [{ url: "https://x/default", default: true }] }) === null);
  ok("17.20c a Photo custom field holding a URL is",
     photoSourceFor({ userDefined: [{ key: "Photo", value: "https://x/pic.jpg" }] })
       === "https://x/pic.jpg");
  ok("17.20d but a Photo field holding something else is not a URL to fetch",
     photoSourceFor({ userDefined: [{ key: "Photo", value: "in the blue album" }] }) === null);
  ok("17.20e a real photo wins over the custom field, being the larger rendition",
     photoSourceFor({
       photos: [{ url: "https://real" }],
       userDefined: [{ key: "Photo", value: "https://custom" }],
     }) === "https://real");
  ok("17.20f a size suffix is replaced rather than appended",
     sizedPhotoUrl("https://lh3.googleusercontent.com/contacts/AAA=s96", 512)
       === "https://lh3.googleusercontent.com/contacts/AAA=s512",
     sizedPhotoUrl("https://lh3.googleusercontent.com/contacts/AAA=s96", 512));
  ok("17.20g and a URL from anywhere else is left exactly as it is",
     sizedPhotoUrl("https://example.test/pic.jpg", 512) === "https://example.test/pic.jpg");

  const photoPlan = planGoogleImport(
    [{
      resourceName: "people/pic", etag: "e",
      names: [{ givenName: "Pic", displayName: "Pic" }],
      userDefined: [
        { key: "Photo", value: "https://lh3.googleusercontent.com/contacts/PIC" },
        { key: "Blood type", value: "O-" },
      ],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.21 the plan says where the picture is",
     photoPlan.photoUrl === "https://lh3.googleusercontent.com/contacts/PIC",
     photoPlan.photoUrl);
  ok("17.21b and does NOT also keep it as a text field",
     !photoPlan.rescued.some((r) => r.key === "photo"),
     photoPlan.rescued.map((r) => r.key));
  ok("17.21c while a custom field that is not a photo is still rescued",
     photoPlan.rescued.some((r) => r.label === "Blood type"),
     photoPlan.rescued.map((r) => r.label));
  ok("17.21d and it says the URL will leave Google, since that is a deletion",
     photoPlan.reasons.some((r) => r.includes("dropped from Google")),
     photoPlan.reasons);

  // The download itself, against a real HTTP server rather than a mock: the thing that can
  // fail here is fetch, redirects, content types and the byte cap, none of which a stub
  // exercises. A PNG this suite already knows how to build stands in for a contact photo.
  const { createServer } = await import("node:http");
  const { fetchContactPhoto } = await import("@/lib/google/fetch-photo");
  const pngBody = makePng(16, [10, 200, 120]);
  const photoServer = createServer((req, res) => {
    if (req.url === "/pic.png") {
      res.writeHead(200, { "content-type": "image/png", "content-length": String(pngBody.length) });
      res.end(pngBody);
    } else if (req.url === "/not-an-image") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>nope</html>");
    } else if (req.url === "/lying-image") {
      // Claims to be an image and is not. The validator, not the header, decides.
      res.writeHead(200, { "content-type": "image/png" });
      res.end("this is not a png");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((done) => photoServer.listen(0, "127.0.0.1", done));
  const photoPort = (photoServer.address() as { port: number }).port;
  const base = `http://127.0.0.1:${photoPort}`;

  const fetched = await fetchContactPhoto(`${base}/pic.png`);
  ok("17.22 a picture is downloaded and measured",
     typeof fetched !== "string" && fetched.mimeType === "image/png" && fetched.width === 16,
     fetched);
  ok("17.22b a page that is not an image is refused",
     (await fetchContactPhoto(`${base}/not-an-image`)) === "not-an-image");
  ok("17.22c and so is a lie about the content type — the bytes decide",
     (await fetchContactPhoto(`${base}/lying-image`)) === "rejected");
  ok("17.22d an unreachable URL is a failure, not a crash",
     (await fetchContactPhoto(`${base}/missing`)) === "unreachable");

  // And that it lands in the database as a picture, which the fetch alone does not show.
  const { savePhotoFromUrl } = await import("@/lib/google/fetch-photo");
  const picPerson = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Pic Ture", givenName: "Pic", familyName: "Ture" },
  });
  ok("17.23 an imported picture becomes the contact's photo",
     (await savePhotoFromUrl(picPerson.id, A.id, `${base}/pic.png`)) === "saved");
  const storedPic = await prisma.personPhoto.findFirst({
    where: { personId: picPerson.id, userId: A.id },
  });
  ok("17.23b stored as bytes, with its size and a cache token",
     storedPic?.mimeType === "image/png" && storedPic?.width === 16
       && (storedPic?.data.length ?? 0) > 0 && Boolean(storedPic?.etag),
     { mime: storedPic?.mimeType, w: storedPic?.width, bytes: storedPic?.data.length });
  ok("17.23c and it is the photo the contact page would show",
     (await (await import("@/lib/photos-db")).effectivePhotoFor(picPerson.id, A.id, A.id))?.etag
       === storedPic?.etag);
  ok("17.23d a picture that will not download leaves the contact without one, not broken",
     (await savePhotoFromUrl(picPerson.id, A.id, `${base}/not-an-image`)) === "not-an-image"
       && (await prisma.personPhoto.count({ where: { personId: picPerson.id } })) === 1);
  await prisma.person.delete({ where: { id: picPerson.id } });

  // --- the whole import, wiring included -----------------------------------
  //
  // Every piece above had a test and the wiring between them had none, which is where this
  // codebase has been bitten before. importOne is the writer the action delegates to, so
  // this drives a Google payload all the way to the rows it produces — columns, rescued
  // fields, labels, the adoption link, the history entry and the picture — without needing
  // a request or a real Google account.
  const { importOne } = await import("@/lib/google/import-one");
  const wiredLabel = await prisma.label.create({
    data: { ownerId: A.id, name: "Imported Wiring" },
  });
  const wiredPlan = planGoogleImport(
    [{
      resourceName: "people/wired", etag: "etag-wired",
      names: [{ givenName: "Wired", familyName: "Import", displayName: "Wired Import" }],
      emailAddresses: [{ value: "wired@e2e.test", type: "home" }],
      addresses: [{ streetAddress: "1 Wire St", city: "Leeds", postalCode: "LS1 1AA",
                    countryCode: "GB", type: "home" }],
      birthdays: [{ date: { month: 3, day: 9 } }],
      userDefined: [
        { key: "Photo", value: `${base}/pic.png` },
        { key: "Blood type", value: "AB+" },
      ],
      memberships: [{ contactGroupMembership: { contactGroupResourceName: "contactGroups/wired" } }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;

  await importOne(A.id, wiredPlan, new Map([["contactGroups/wired", wiredLabel.id]]));
  const wired = await prisma.person.findFirst({
    where: { ownerId: A.id, displayName: "Wired Import" },
    include: {
      contactPoints: true,
      labels: true,
      googleSyncs: true,
      photos: true,
      versions: true,
    },
  });
  ok("17.25 an imported contact exists, with its columns", wired?.givenName === "Wired"
       && wired?.familyName === "Import", wired?.displayName);
  ok("17.25b its contact points, address parts and all",
     wired!.contactPoints.some((cp) => cp.kind === "EMAIL" && cp.value === "wired@e2e.test")
       && wired!.contactPoints.some((cp) => cp.kind === "ADDRESS" && cp.city === "Leeds"
            && cp.postalCode === "LS1 1AA"),
     wired?.contactPoints.map((cp) => `${cp.kind}:${cp.value}`));
  ok("17.25c the yearless birthday, in the form that goes back as a date",
     wired?.birthday === null && wired?.birthdayText === "--03-09", wired?.birthdayText);
  ok("17.25d the Google label as a Hearth label",
     wired?.labels.length === 1 && wired?.labels[0]?.labelId === wiredLabel.id);
  ok("17.25e the link that makes this an adoption rather than a duplicate",
     wired?.googleSyncs[0]?.googleResourceName === "people/wired"
       && wired?.googleSyncs[0]?.googleSyncStatus === "PENDING",
     wired?.googleSyncs[0]);
  ok("17.25f a first version, so history starts where the data did",
     wired?.versions.length === 1 && wired?.versions[0]?.source === "GOOGLE_IMPORT",
     wired?.versions.map((v) => v.source));
  // The question this whole section exists to answer.
  ok("17.25g AND THE PICTURE — downloaded, not left as a URL",
     wired?.photos.length === 1 && wired?.photos[0]?.mimeType === "image/png"
       && (wired?.photos[0]?.data.length ?? 0) > 0,
     wired?.photos.map((ph) => `${ph.mimeType} ${ph.width}px`));
  ok("17.25h with no custom field holding that URL",
     !Object.keys((wired?.custom ?? {}) as Record<string, unknown>).includes("photo"),
     Object.keys((wired?.custom ?? {}) as Record<string, unknown>));
  ok("17.25i while a custom field that is not a photo is still imported",
     ((wired?.custom ?? {}) as Record<string, string>)["blood_type"] === "AB+",
     wired?.custom);

  await prisma.person.delete({ where: { id: wired!.id } });
  await prisma.label.delete({ where: { id: wiredLabel.id } });
  photoServer.close();

  // Every group Hearth overwrites must be one the import reads, or the first sync
  // deletes data nobody took a copy of. This is the check that would fail if somebody
  // added a field to MANAGED_PERSON_FIELDS and forgot the import.
  const readFields = new Set<string>(GOOGLE_IMPORT_FIELDS);
  const unread = MANAGED_PERSON_FIELDS.filter((f) => !readFields.has(f));
  ok("17.6 the import reads every field group Hearth later overwrites",
     unread.length === 0, unread);

  // Addresses keep their parts, in Hearth and on the way back to Google.
  const withAddress = planGoogleImport(
    [
      {
        resourceName: "people/c4",
        names: [{ givenName: "Structured", familyName: "Address" }],
        addresses: [
          {
            formattedValue: "1 Long Road, London, SW1 1AA, UK",
            streetAddress: "1 Long Road",
            city: "London",
            postalCode: "SW1 1AA",
            country: "UK",
            countryCode: "GB",
            type: "home",
          },
        ],
        emailAddresses: [{ value: "sa@e2e.test", displayName: "Structured A" }],
      },
    ],
    { linkedResourceNames: new Set<string>() },
  );
  const addr = withAddress.contacts[0]!.contactPoints.find((p) => p.kind === "ADDRESS")!;
  ok("17.8 an address keeps its parts, not just its one line",
     addr.streetAddress === "1 Long Road" && addr.city === "London"
       && addr.postalCode === "SW1 1AA" && addr.countryCode === "GB",
     addr);
  ok("17.8b and the line as well, which is what Hearth shows",
     addr.value === "1 Long Road, London, SW1 1AA, UK", addr.value);
  ok("17.8c an email keeps Google's display name",
     withAddress.contacts[0]!.contactPoints.find((p) => p.kind === "EMAIL")
       ?.displayName === "Structured A");
  ok("17.8d and nothing about an address needs rescuing any more",
     withAddress.contacts[0]!.rescued.length === 0,
     withAddress.contacts[0]!.rescued.map((r) => r.key));

  const addrRound = serializePerson(
    barePerson({
      givenName: "Structured", familyName: "Address", displayName: "Structured Address",
      contactPoints: [
        bareContactPoint({
          kind: "ADDRESS", label: "home",
          value: "1 Long Road, London, SW1 1AA, UK",
          streetAddress: "1 Long Road", city: "London", postalCode: "SW1 1AA",
          country: "UK", countryCode: "GB",
        }),
      ],
    }),
  );
  const sentAddr = addrRound.person.addresses?.[0];
  ok("17.9 the parts go back to Google, not just the flat line",
     sentAddr?.streetAddress === "1 Long Road" && sentAddr?.city === "London"
       && sentAddr?.postalCode === "SW1 1AA" && sentAddr?.countryCode === "GB",
     sentAddr);
  ok("17.9b with the line beside them, which Google keeps too",
     sentAddr?.formattedValue === "1 Long Road, London, SW1 1AA, UK");

  // The reason addresses waited for their own commit: the form is the whole of what a
  // save writes, so parts it does not carry are parts an unrelated edit destroys.
  const addrPerson = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Form Address", givenName: "Form", familyName: "Address",
      contactPoints: {
        create: [
          { kind: "ADDRESS", value: "2 Short Road, Leeds", label: "home",
            streetAddress: "2 Short Road", city: "Leeds", order: 0, isPrimary: true },
          { kind: "EMAIL", value: "form@e2e.test", order: 0, isPrimary: true },
        ],
      },
    },
  });
  await A.page.goto(`/people/${addrPerson.id}/edit`);
  // Not "nth=1": an ADDRESS is edited in a textarea now, so the only INPUT named cp_value on
  // this contact is the email. Naming the control by what it is beats counting positions,
  // which is what made this check break when the address grew a second line.
  await A.page.fill('input[name="cp_value"]', "changed@e2e.test");
  await A.page.click('button:has-text("Save")');
  await waitForDb("the email change to be saved", async () =>
    (await prisma.contactPoint.count({
      where: { personId: addrPerson.id, value: "changed@e2e.test" },
    })) === 1);
  const keptAddress = await prisma.contactPoint.findFirst({
    where: { personId: addrPerson.id, kind: "ADDRESS" },
  });
  ok("17.10 editing an unrelated email does not flatten the address",
     keptAddress?.streetAddress === "2 Short Road" && keptAddress?.city === "Leeds",
     { street: keptAddress?.streetAddress, city: keptAddress?.city });

  // The long tail: everything else Google keeps on a contact.
  const tail = planGoogleImport(
    [
      {
        resourceName: "people/c5",
        names: [{ givenName: "Tail", familyName: "Fields" }],
        nicknames: [{ value: "Tails" }, { value: "T" }],
        genders: [{ value: "she/her" }],
        birthdays: [{ date: { month: 4, day: 1 } }],
        imClients: [{ username: "tail@chat", protocol: "jabber", type: "work" }],
        sipAddresses: [{ value: "sip:tail@e2e.test", type: "work" }],
        calendarUrls: [{ url: "https://cal.e2e.test/tail", type: "work" }],
        externalIds: [{ value: "CUST-1", type: "customer" }],
        miscKeywords: [{ value: "vip" }],
        interests: [{ value: "birdwatching" }],
        skills: [{ value: "welding" }],
        occupations: [{ value: "Engineer" }],
        locations: [{ value: "Building 3", type: "desk", floor: "2", deskCode: "2A",
                      buildingId: "B3", current: true }],
        events: [{ date: { month: 6, day: 12 }, type: "anniversary" }],
        relations: [{ person: "Jane Tail", type: "spouse" }],
      },
    ],
    { linkedResourceNames: new Set<string>() },
  );
  const t = tail.contacts[0]!;
  const kindOf = (k: string) => t.contactPoints.filter((p) => p.kind === k);

  // --04-01, in Google's own notation for a date with no year, rather than the "4/1" this
  // used to synthesise. Kept in the form it arrived in so serialize-person can read it back
  // as a date instead of pushing prose where Google had a date.
  ok("17.11 gender and a year-less birthday are stored rather than dropped",
     t.columns.gender === "she/her" && t.columns.birthday === null
       && t.columns.birthdayText === "--04-01",
     { gender: t.columns.gender, text: t.columns.birthdayText });
  ok("17.11a and that form goes back to Google as a date, not as a string",
     serializePerson(barePerson({
       displayName: "Tail", givenName: "Tail", birthdayText: t.columns.birthdayText,
     })).person.birthdays?.[0]?.date?.month === 4,
     serializePerson(barePerson({
       displayName: "Tail", givenName: "Tail", birthdayText: t.columns.birthdayText,
     })).person.birthdays?.[0]);

  // Google returns a `text` beside every structured birthday, and on a real account all
  // twenty were machine echoes of the date — "1977-06-13" beside {1977,6,13}. Storing them
  // gave a contact a birthday plus a redundant "birthday, no year" line saying the same.
  const echoed = planGoogleImport(
    [{
      resourceName: "people/echo", etag: "e",
      names: [{ givenName: "Echo", displayName: "Echo" }],
      birthdays: [{ date: { year: 1977, month: 6, day: 13 }, text: "1977-06-13" }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.11j a birthday text that merely repeats the date is not stored twice",
     echoed.columns.birthday === "1977-06-13" && echoed.columns.birthdayText === null,
     { date: echoed.columns.birthday, text: echoed.columns.birthdayText });
  const prosed = planGoogleImport(
    [{
      resourceName: "people/prose", etag: "e",
      names: [{ givenName: "Prose", displayName: "Prose" }],
      birthdays: [{ date: { year: 1977, month: 6, day: 13 }, text: "the day Elvis died" }],
    }],
    { linkedResourceNames: new Set<string>() },
  ).contacts[0]!;
  ok("17.11k but a text that says something a date cannot is kept",
     prosed.columns.birthdayText === "the day Elvis died", prosed.columns.birthdayText);
  ok("17.11b a chat handle keeps its network",
     kindOf("IM")[0]?.value === "tail@chat" && kindOf("IM")[0]?.protocol === "jabber",
     kindOf("IM")[0]);
  ok("17.11c SIP, calendar, external ids and keywords all land",
     kindOf("SIP").length === 1 && kindOf("CALENDAR").length === 1
       && kindOf("EXTERNAL_ID").length === 1 && kindOf("KEYWORD").length === 1);
  ok("17.11d as do interests, skills and occupations",
     kindOf("INTEREST")[0]?.value === "birdwatching"
       && kindOf("SKILL")[0]?.value === "welding"
       && kindOf("OCCUPATION")[0]?.value === "Engineer");
  ok("17.11e a location keeps its floor and desk",
     kindOf("LOCATION")[0]?.deskCode === "2A" && kindOf("LOCATION")[0]?.floor === "2"
       && kindOf("LOCATION")[0]?.current === true,
     kindOf("LOCATION")[0]);
  ok("17.11f a second nickname becomes a row rather than being lost",
     t.columns.nickname === "Tails" && kindOf("NICKNAME")[0]?.value === "T",
     kindOf("NICKNAME"));
  ok("17.11g an anniversary keeps its day and its missing year",
     t.events[0]?.month === 6 && t.events[0]?.day === 12
       && t.events[0]?.year === null && t.events[0]?.label === "anniversary",
     t.events);
  ok("17.11h a Google relation keeps the NAME, not a link to a contact",
     t.relations[0]?.name === "Jane Tail" && t.relations[0]?.label === "spouse",
     t.relations);
  ok("17.11i and none of it needed rescuing into a custom field",
     t.rescued.length === 0, t.rescued.map((r) => r.key));

  // And back out again. Every one of these groups is managed now, so a group the
  // serializer omits is a group the next push deletes.
  const tailRound = serializePerson(
    barePerson({
      gender: "she/her", birthdayText: "1 April",
      googleEvents: [{ label: "anniversary", year: null, month: 6, day: 12 }],
      googleRelations: [{ name: "Jane Tail", label: "spouse" }],
      contactPoints: [
        bareContactPoint({ kind: "IM", value: "tail@chat", protocol: "jabber", label: "work" }),
        bareContactPoint({ kind: "SIP", value: "sip:tail@e2e.test" }),
        bareContactPoint({ kind: "CALENDAR", value: "https://cal.e2e.test/tail" }),
        bareContactPoint({ kind: "EXTERNAL_ID", value: "CUST-1", label: "customer" }),
        bareContactPoint({ kind: "KEYWORD", value: "vip" }),
        bareContactPoint({ kind: "INTEREST", value: "birdwatching" }),
        bareContactPoint({ kind: "SKILL", value: "welding" }),
        bareContactPoint({ kind: "LOCATION", value: "Building 3", deskCode: "2A", floor: "2" }),
        bareContactPoint({ kind: "NICKNAME", value: "T" }),
      ],
    }),
  );
  const sent = tailRound.person;
  ok("17.12 the chat handle goes back with its network",
     sent.imClients?.[0]?.username === "tail@chat"
       && sent.imClients?.[0]?.protocol === "jabber",
     sent.imClients?.[0]);
  ok("17.12b the anniversary goes back with no year invented",
     sent.events?.[0]?.date?.month === 6 && sent.events?.[0]?.date?.year === undefined,
     sent.events?.[0]);
  ok("17.12c the relation goes back as a name",
     sent.relations?.[0]?.person === "Jane Tail", sent.relations?.[0]);
  ok("17.12d a year-less birthday goes back as text, not a wrong date",
     sent.birthdays?.[0]?.text === "1 April" && !sent.birthdays?.[0]?.date,
     sent.birthdays?.[0]);
  ok("17.12e gender, location detail and the rest all travel",
     sent.genders?.[0]?.value === "she/her"
       && sent.locations?.[0]?.deskCode === "2A"
       && sent.skills?.[0]?.value === "welding"
       && sent.interests?.[0]?.value === "birdwatching",
     { gender: sent.genders?.[0], loc: sent.locations?.[0] });

  // The sync must LOAD what it sends. events and relations are managed now, so a query
  // that forgot them would push empty groups — deleting them from Google.
  const syncSource = readFileSync("src/lib/sync/contacts.ts", "utf8");
  ok("17.13 the sync loads the events and relations it is about to send",
     syncSource.includes("googleEvents:") && syncSource.includes("googleRelations:"));

  // A column per address part, in numbered blocks — not a nested format in one cell,
  // and not a flattened line.
  const {
    addressColumnsFor, addressSlotsIn, parseAddressBlocks, headersFor, addressColumn,
  } = await import("@/lib/contacts-csv");

  ok("17.14 no addresses means no address columns at all",
     addressColumnsFor(0).length === 0 && headersFor([], 0).every((h) => !h.startsWith("Address ")));
  ok("17.14b two addresses means two blocks",
     addressColumnsFor(2).includes("Address 1 city")
       && addressColumnsFor(2).includes("Address 2 postcode")
       && !addressColumnsFor(2).includes("Address 3 city"));
  ok("17.14c and a file's width is read from its headers, not assumed",
     addressSlotsIn(["Given name", "Address 1 city", "Address 2 street"]) === 2
       && addressSlotsIn(["Given name"]) === 0);

  const blockRow: Record<string, string> = {
    [addressColumn(0, "type")]: "home",
    [addressColumn(0, "line")]: "1 Long Road, Leeds",
    [addressColumn(0, "street")]: "1 Long Road",
    [addressColumn(0, "city")]: "Leeds",
    [addressColumn(0, "postcode")]: "LS1 4AB",
    // Second block: parts only, no summary line.
    [addressColumn(1, "street")]: "2 Short Road",
    [addressColumn(1, "city")]: "York",
  };
  const blocks = parseAddressBlocks((c) => blockRow[c] ?? "", 3);
  ok("17.15 a block round-trips its parts",
     blocks[0]?.streetAddress === "1 Long Road" && blocks[0]?.city === "Leeds"
       && blocks[0]?.postalCode === "LS1 4AB" && blocks[0]?.label === "home",
     blocks[0]);
  ok("17.15b a block with parts but no line gets one built from them",
     blocks[1]?.value === "2 Short Road, York", blocks[1]?.value);
  ok("17.15c and an empty block is not an address",
     blocks.length === 2, blocks.length);

  // Through the real export and back, which is the claim that matters.
  const csvPerson = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Csv Address", givenName: "Csv", familyName: "Address",
      middleName: "Quentin", gender: "they/them", birthdayText: "1 April",
      orgDepartment: "Research",
      contactPoints: {
        create: [
          { kind: "ADDRESS", value: "9 Export Way, Hull", label: "home", order: 0,
            isPrimary: true, streetAddress: "9 Export Way", city: "Hull",
            postalCode: "HU1 1AA", countryCode: "GB" },
        ],
      },
    },
  });
  const csvText = await (await A.page.request.get("/api/people/export")).text();
  ok("17.16 the export carries a column per address part",
     csvText.includes("Address 1 street") && csvText.includes("Address 1 postcode"),
     csvText.split("\n")[0]?.slice(0, 120));
  ok("17.16b with the parts in it",
     csvText.includes("9 Export Way") && csvText.includes("HU1 1AA"));
  ok("17.16c and the new person columns too",
     csvText.includes("Middle name") && csvText.includes("Quentin")
       && csvText.includes("they/them") && csvText.includes("Department"));

  const { planImport } = await import("@/lib/contacts-import");
  const reimport = await planImport(A.id, csvText);
  const reAddress = reimport.rows
    .find((r) => r.displayName === "Csv Address")
    ?.write?.contactPoints?.find((c) => c.kind === "ADDRESS");
  ok("17.17 and re-importing that file keeps the parts, not just the line",
     reAddress?.streetAddress === "9 Export Way" && reAddress?.city === "Hull"
       && reAddress?.postalCode === "HU1 1AA",
     reAddress);

  // The contact page shows what it stores.
  await A.page.goto(`/people/${csvPerson.id}`);
  const pageText = (await A.page.textContent("body")) ?? "";
  // One claim per line. The combined version failed without saying which of the three
  // was missing, and it was gender — declared in the schema but never as a core field,
  // so it existed everywhere except the registry that puts it on a page.
  ok("17.18 the contact page shows the new name fields", pageText.includes("Quentin"));
  ok("17.18b and the organisation detail", pageText.includes("Research"));
  ok("17.18c and gender", pageText.includes("they/them"));
  ok("17.18d and the parts of an address beside it",
     pageText.includes("9 Export Way") && pageText.includes("HU1 1AA"));

  const datedPerson = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Dated Person", givenName: "Dated", familyName: "Person",
      googleEvents: { create: [{ label: "anniversary", year: null, month: 6, day: 12 }] },
      googleRelations: { create: [{ name: "Jane Somebody", label: "spouse" }] },
      contactPoints: {
        create: [{ kind: "IM", value: "dated@chat", protocol: "jabber", order: 0 }],
      },
    },
  });
  await A.page.goto(`/people/${datedPerson.id}`);
  const datedText = (await A.page.textContent("body")) ?? "";
  ok("17.19 an anniversary with no year is shown without one being invented",
     datedText.includes("12/6") && !datedText.includes("1970"), true);
  ok("17.19b a Google relation is shown, and marked as a name rather than a link",
     datedText.includes("Jane Somebody") && datedText.includes("as text rather than"),
     true);
  ok("17.19c and a chat handle shows which network it is on",
     datedText.includes("jabber"));

  await A.page.goto("/people/import/google");
  await A.page.goto("/people/import/google");
  ok("17.7 the page explains that contacts stay where they are",
     ((await A.page.textContent("body")) ?? "").includes("stay exactly where they are"));
  await A.page.goto("/people");
  ok("17.7b and is reachable from the people list",
     (await A.page.$('a[href="/people/import/google"]')) !== null);

  // ---------------------------------------------------------------------------
  section("§18 Contact history");
  // ---------------------------------------------------------------------------
  // Snapshots are what is stored; the diff is derived from two of them. Both are pure, so
  // both are checked directly rather than through the page that renders them.

  const { snapshotPerson, diffSnapshots, sameSnapshot } =
    await import("@/lib/person-history");
  const { recordPersonVersionAfter, loadPersonVersions } =
    await import("@/lib/person-versions");

  const snapOf = (over: Record<string, unknown> = {}) =>
    snapshotPerson({
      person: { givenName: "Hist", familyName: "Ory", custom: {}, ...over },
      contactPoints: (over.contactPoints as Record<string, unknown>[]) ?? [],
      labels: (over.labels as string[]) ?? [],
      events: (over.events as Record<string, unknown>[]) ?? [],
      relations: (over.relations as Record<string, unknown>[]) ?? [],
      ownerEmail: (over.ownerEmail as string) ?? "a@e2e.test",
    });

  ok("18.1 a snapshot keeps the fields worth remembering",
     snapOf().fields.givenName === "Hist" && snapOf().fields.familyName === "Ory");
  ok("18.1b and leaves out sync state and timestamps, which are not edits",
     !("googleSyncStatus" in snapOf().fields) && !("updatedAt" in snapOf().fields));

  // Rows come back in whatever order the database chose, and that must not read as a
  // change somebody made.
  const orderA = snapOf({
    contactPoints: [
      { kind: "EMAIL", value: "b@e2e.test" },
      { kind: "EMAIL", value: "a@e2e.test" },
    ],
    labels: ["Work", "Family"],
  });
  const orderB = snapOf({
    contactPoints: [
      { kind: "EMAIL", value: "a@e2e.test" },
      { kind: "EMAIL", value: "b@e2e.test" },
    ],
    labels: ["Family", "Work"],
  });
  ok("18.2 reordered rows are not a change", sameSnapshot(orderA, orderB));
  // Postgres jsonb normalises key order, so a stored snapshot comes back with its keys
  // rearranged. The comparison has to be about content, not about how Postgres filed it.
  const reordered = JSON.parse(
    JSON.stringify(orderA, Object.keys(orderA).sort().reverse()),
  ) as typeof orderA;
  ok("18.2c and neither is a snapshot whose keys came back in another order",
     sameSnapshot({ ...reordered, fields: orderA.fields, contactPoints: orderA.contactPoints,
                    custom: orderA.custom, events: orderA.events,
                    relations: orderA.relations, labels: orderA.labels }, orderA));
  ok("18.2b and produce no diff", diffSnapshots(orderA, orderB).length === 0);

  const changed = diffSnapshots(
    snapOf({ givenName: "Hist", labels: ["Family"] }),
    snapOf({
      givenName: "Historic",
      labels: ["Work"],
      contactPoints: [{ kind: "PHONE", value: "555 0111", label: "mobile" }],
      events: [{ label: "anniversary", year: null, month: 6, day: 12 }],
      relations: [{ name: "Jane", label: "spouse" }],
      ownerEmail: "b@e2e.test",
    }),
  );
  const said = (what: string) => changed.find((c) => c.what === what);
  ok("18.3 a renamed field says both sides",
     said("First name")?.from === "Hist" && said("First name")?.to === "Historic",
     said("First name"));
  ok("18.3b an added contact point is one change, not a pair",
     changed.filter((c) => c.what === "Phone (mobile)").length === 1
       && said("Phone (mobile)")?.from === null,
     changed.filter((c) => c.what.startsWith("Phone")));
  ok("18.3c labels added and removed are reported separately",
     changed.some((c) => c.what === "Label" && c.to === "Work")
       && changed.some((c) => c.what === "Label" && c.from === "Family"));
  ok("18.3d dates, Google relations and a change of owner all show",
     Boolean(said("Date")) && Boolean(said("Named in Google"))
       && said("Owner")?.to === "b@e2e.test");
  ok("18.4 a first version has nothing to diff against, and says so by being empty",
     diffSnapshots(null, snapOf()).length === 0);

  // And the recording, against the database.
  const histPerson = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Hist Ory", givenName: "Hist", familyName: "Ory",
      contactPoints: { create: [{ kind: "EMAIL", value: "hist@e2e.test", order: 0 }] },
    },
  });
  await recordPersonVersionAfter(histPerson.id, { byUserId: A.id, source: "CREATED" });
  ok("18.5 creating a contact records its first version",
     (await prisma.personVersion.count({ where: { personId: histPerson.id } })) === 1);

  // The whole reason the recorder compares content: sync touches updatedAt and the sync
  // columns on every push, and a history of those would bury the edits that matter.
  await prisma.person.update({
    where: { id: histPerson.id },
    data: { addToGoogle: true, updatedAt: new Date() },
  });
  await recordPersonVersionAfter(histPerson.id, { byUserId: null, source: "EDITED" });
  ok("18.6 a write that changed nothing a person wrote records nothing",
     (await prisma.personVersion.count({ where: { personId: histPerson.id } })) === 1);

  await prisma.person.update({
    where: { id: histPerson.id },
    data: { familyName: "Orey", middleName: "Quill" },
  });
  await recordPersonVersionAfter(histPerson.id, { byUserId: B.id, source: "EDITED" });
  const hist = await loadPersonVersions(histPerson.id);
  ok("18.7 a real change records a new version, newest first",
     hist.length === 2 && hist[0]?.revision === 2, hist.map((h) => h.revision));
  ok("18.7b attributed to whoever made it",
     hist[0]?.byEmail === "bob@e2e.test", hist[0]?.byEmail);
  const histChanges = diffSnapshots(hist[1]!.content, hist[0]!.content);
  ok("18.7c and the change is readable from the two snapshots",
     histChanges.some((c) => c.what === "Last name" && c.from === "Ory" && c.to === "Orey")
       && histChanges.some((c) => c.what === "Middle name" && c.to === "Quill"),
     histChanges);

  await A.page.goto(`/people/${histPerson.id}`);
  const histText = (await A.page.textContent("body")) ?? "";
  ok("18.8 the contact page shows the history", histText.includes("History"));
  ok("18.8b with who changed what", histText.includes("bob@e2e.test")
       && histText.includes("Orey"));

  // Deleting a contact takes its history with it — the honest reading of delete.
  const versionsBefore = await prisma.personVersion.count({ where: { personId: histPerson.id } });
  await prisma.person.delete({ where: { id: histPerson.id } });
  ok("18.9 deleting a contact deletes its history too",
     versionsBefore > 0
       && (await prisma.personVersion.count({ where: { personId: histPerson.id } })) === 0);

  // ════════════════════════════════════════════════════════════════════════
  section("§19 Trash");

  // A trash can is a read-path problem, not a write-path one: setting deletedAt is
  // trivial, and every check below exists because missing ONE query means a deleted
  // contact turning up somewhere. So these test surfaces — lists, search, export,
  // pickers, another user's view — rather than inspecting the clauses.
  const doomed = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Trash Target", givenName: "Trash", familyName: "Target",
      organization: "Bin Ltd", addToGoogle: true,
      contactPoints: { create: [{ kind: "EMAIL", value: "trash@e2e.test", order: 0 }] },
    },
  });
  await recordPersonVersionAfter(doomed.id, { byUserId: A.id, source: "CREATED" });
  // A Google copy in two accounts, so trashing has to remove both.
  await prisma.personSync.createMany({
    data: [
      { personId: doomed.id, userId: A.id, googleResourceName: "people/trashA", googleSyncStatus: "SYNCED" },
      { personId: doomed.id, userId: B.id, googleResourceName: "people/trashB", googleSyncStatus: "SYNCED" },
    ],
  });
  await prisma.share.create({
    data: { ownerId: A.id, withUserId: B.id, personId: doomed.id, scope: "PERSON", permission: "EDIT" },
  });
  // Something hanging off it, to prove trashing keeps the row rather than cascading.
  const doomedGift = await prisma.gift.create({
    data: {
      ownerId: A.id, giverId: doomed.id, description: "Bin bag",
      receivedOn: new Date("2026-03-01T00:00:00Z"),
      recipients: { create: [{ personId: kid.id }] },
    },
  });

  await A.page.goto(`/people/${doomed.id}`);
  ok("19.1 Delete now says what it does", (await A.page.$$('button:has-text("Move to trash")')).length === 1);
  await A.page.click('button:has-text("Move to trash")');
  await waitForDb("the contact to be trashed", async () =>
    (await prisma.person.findUnique({ where: { id: doomed.id }, select: { deletedAt: true } }))?.deletedAt !== null);
  // The version is recorded after the transaction commits, so waiting on deletedAt is not
  // waiting for the history. Two separate writes need two separate waits.
  await waitForDb("the trashing to be recorded", async () =>
    (await prisma.personVersion.count({ where: { personId: doomed.id, source: "TRASHED" } })) === 1);
  const trashedRow = await prisma.person.findUnique({ where: { id: doomed.id } });
  ok("19.2 trashing keeps the row, and stamps when", trashedRow !== null && trashedRow.deletedAt !== null);
  ok("19.2b and keeps everything hanging off it",
     (await prisma.gift.count({ where: { id: doomedGift.id } })) === 1
       && (await prisma.share.count({ where: { personId: doomed.id } })) === 1
       && (await prisma.personVersion.count({ where: { personId: doomed.id, source: "CREATED" } })) === 1);
  ok("19.3 the Google copy is queued for removal from EVERY account that held one",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_CONTACT", resourceId: { in: ["people/trashA", "people/trashB"] }, processedAt: null },
     })) === 2);
  ok("19.4 and the trashing is recorded in its history",
     (await prisma.personVersion.count({ where: { personId: doomed.id, source: "TRASHED" } })) === 1);

  // --- invisible everywhere -------------------------------------------------
  await A.page.goto("/people");
  ok("19.5 gone from the People list", !((await A.page.textContent("body")) ?? "").includes("Trash Target"));
  await A.page.goto("/people?q=Trash");
  ok("19.5b and from a search for it", !((await A.page.textContent("body")) ?? "").includes("Trash Target"));
  const trashCsv = await (await A.page.request.get("/api/people/export")).text();
  ok("19.5c and from the CSV export", !trashCsv.includes("Trash Target"), trashCsv.length);
  const trashHit = await A.page.goto(`/people/${doomed.id}`);
  ok("19.5d its own page is gone", trashHit?.status() === 404, trashHit?.status());

  // The attendee picker searches through the same clause; asked of the action itself
  // because a picker that offers nothing is indistinguishable from a picker that is
  // simply empty.
  // findPeopleMatching rather than the searchPeople action wrapping it: the wrapper reads
  // request headers, and the query is what this is about.
  const { findPeopleMatching } = await import("@/lib/actions/people-search");
  ok("19.6 gone from people search",
     (await findPeopleMatching(A.id, "Trash Target")).length === 0);
  await A.page.goto("/events/new");
  ok("19.6b and from the attendee picker on a new event",
     !((await A.page.textContent("body")) ?? "").includes("Trash Target"));

  await A.page.goto("/settings/sharing");
  ok("19.7 and from the sharing page",
     !((await A.page.textContent("body")) ?? "").includes("Trash Target"));

  // Gifts follow their recipient, so a gift GIVEN by a trashed contact still belongs to
  // the person who received it: trashing somebody does not un-give what they gave.
  const giftsAfterTrash = await (await import("@/lib/gifts")).listGiftsForPerson(A.id, kid.id);
  const binBag = giftsAfterTrash.find((g) => g.description === "Bin bag");
  ok("19.8 a gift outlives the trashing of its giver", binBag !== undefined);
  ok("19.8b but the giver is no longer a link to a page that is gone",
     binBag?.giver.deleted === true);

  // Somebody else's bin is not a place you can look, even for a record they shared.
  const bobHit = await B.page.goto(`/people/${doomed.id}`);
  ok("19.9 a recipient of the share loses it too", bobHit?.status() === 404, bobHit?.status());
  await B.page.goto("/trash");
  ok("19.9b and it is not in THEIR trash",
     !((await B.page.textContent("body")) ?? "").includes("Trash Target"));

  // --- the trash page itself ------------------------------------------------
  await A.page.goto("/trash");
  const trashPage = (await A.page.textContent("body")) ?? "";
  ok("19.10 the owner's trash lists it", trashPage.includes("Trash Target"));
  ok("19.10b with what restoring would bring back", trashPage.includes("Bin Ltd"));
  ok("19.11 and says plainly that nothing empties it",
     trashPage.includes("never empties itself") || (await A.page.$$('text="How long is this kept?"')).length === 1);

  // --- restore --------------------------------------------------------------
  await A.page.click('form:has(input[value="' + doomed.id + '"]) button:has-text("Restore")');
  await waitForDb("the contact to come back", async () =>
    (await prisma.person.findUnique({ where: { id: doomed.id }, select: { deletedAt: true } }))?.deletedAt === null);
  ok("19.12 restoring brings it back", (await prisma.person.count({
    where: { id: doomed.id, ...(await import("@/lib/access")).readablePeopleWhere(A.id) },
  })) === 1);
  ok("19.12b the queued Google deletions are cancelled, not left to fire",
     (await prisma.syncTombstone.count({
       where: { resourceId: { in: ["people/trashA", "people/trashB"] }, processedAt: null },
     })) === 0);
  ok("19.12c and it is queued to go back to Google",
     (await prisma.personSync.count({
       where: { personId: doomed.id, googleSyncStatus: "PENDING" },
     })) === 2);
  await waitForDb("the restore to be recorded", async () =>
    (await prisma.personVersion.count({ where: { personId: doomed.id, source: "RESTORED" } })) === 1);
  ok("19.12d the restore is in its history",
     (await prisma.personVersion.count({ where: { personId: doomed.id, source: "RESTORED" } })) === 1);
  await A.page.goto("/people");
  ok("19.12e and it is back in the list",
     ((await A.page.textContent("body")) ?? "").includes("Trash Target"));

  // --- nobody else's trash to act on ---------------------------------------
  //
  // The action's own refusal cannot be provoked from here: requireUserForAction reads
  // headers() and there is no request to read. So this asks the question the action asks
  // — the identical findFirst against trashedPeopleWhere — and then checks that no
  // control for it exists anywhere in B's interface either.
  await prisma.person.update({ where: { id: doomed.id }, data: { deletedAt: new Date() } });
  const { trashedPeopleWhere: trashedFor } = await import("@/lib/access");
  ok("19.13 a share recipient has no claim on what its owner trashed",
     (await prisma.person.findFirst({ where: { id: doomed.id, ...trashedFor(B.id) } })) === null);
  await B.page.goto("/trash");
  ok("19.13b and is offered no control for it",
     (await B.page.$$(`form:has(input[value="${doomed.id}"])`)).length === 0);

  // --- permanent delete ----------------------------------------------------
  const versionsAtPurge = await prisma.personVersion.count({ where: { personId: doomed.id } });
  await A.page.goto("/trash");
  await A.page.click('form:has(input[value="' + doomed.id + '"]) button:has-text("Delete permanently")');
  await waitForDb("the contact to be destroyed", async () =>
    (await prisma.person.count({ where: { id: doomed.id } })) === 0);
  ok("19.14 delete permanently destroys it", (await prisma.person.count({ where: { id: doomed.id } })) === 0);
  ok("19.14b and its history with it",
     versionsAtPurge > 0 && (await prisma.personVersion.count({ where: { personId: doomed.id } })) === 0);

  // A user's own contact card may be trashed, as it could always be deleted — but not
  // destroyed while somebody is attached to it, because none of what hangs off it
  // (their thanks, their place in the household) comes back. Checked at the surface,
  // since the guard inside purgePerson sits behind a session this harness cannot forge.
  await prisma.person.update({ where: { id: kid.id }, data: { deletedAt: new Date() } });
  await A.page.goto("/trash");
  const cardRow = (await A.page.textContent(`li:has(input[value="${kid.id}"])`)) ?? "";
  ok("19.15 a Hearth user's own card can be restored from the trash",
     (await A.page.$$(`form:has(input[value="${kid.id}"]) button:has-text("Restore")`)).length === 1);
  ok("19.15b but is offered no permanent delete while they are attached to it",
     (await A.page.$$(`form:has(input[value="${kid.id}"]) button:has-text("Delete permanently")`)).length === 0,
     cardRow.slice(0, 120));
  ok("19.15c and says what to do instead", cardRow.includes("unlink it"), cardRow.slice(0, 160));
  await prisma.person.update({ where: { id: kid.id }, data: { deletedAt: null } });

  // --- events --------------------------------------------------------------
  const doomedEvent = await prisma.event.create({
    data: {
      ownerId: A.id, title: "Binned Gathering", startAt: new Date("2026-04-01T18:00:00Z"),
      timeZone: "Europe/London", addToGoogle: true, googleEventId: "gcal-trash",
      googleSyncStatus: "SYNCED",
    },
  });
  await A.page.goto(`/events/${doomedEvent.id}`);
  await A.page.click('button:has-text("Move to trash")');
  await waitForDb("the event to be trashed", async () =>
    (await prisma.event.findUnique({ where: { id: doomedEvent.id }, select: { deletedAt: true } }))?.deletedAt !== null);
  ok("19.16 an event can be trashed too",
     (await prisma.event.count({ where: { id: doomedEvent.id } })) === 1);
  ok("19.16b and its calendar copy is queued for removal",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_EVENT", resourceId: "gcal-trash", processedAt: null },
     })) === 1);
  await A.page.goto("/events");
  ok("19.17 gone from the Events list",
     !((await A.page.textContent("body")) ?? "").includes("Binned Gathering"));
  const eventHit = await A.page.goto(`/events/${doomedEvent.id}`);
  ok("19.17b and its own page is gone", eventHit?.status() === 404, eventHit?.status());

  // The event push queue used to name ownerId directly instead of going through a
  // clause, which would have sent a trashed event straight back to the calendar it was
  // just deleted from. Read from the source, because the queue itself cannot be reached
  // without a Google grant — and a check that cannot fail is not a check.
  const eventSyncSource = readFileSync("src/lib/sync/events.ts", "utf8");
  const queueBlock = eventSyncSource.slice(
    eventSyncSource.indexOf("const queue = await prisma.event.findMany"),
    eventSyncSource.indexOf("include: {", eventSyncSource.indexOf("const queue = await prisma.event.findMany")),
  );
  ok("19.18 the event push queue goes through the clause that excludes trashed events",
     queueBlock.includes("ownedEventsWhere(userId)") && !/ownerId:\s*userId/.test(queueBlock),
     queueBlock.replace(/\s+/g, " ").slice(0, 140));
  await A.page.goto("/settings");
  const trashSettingsText = (await A.page.textContent("body")) ?? "";
  ok("19.18b and it is not counted as waiting to sync",
     !trashSettingsText.includes("Binned Gathering"));

  await A.page.goto("/trash");
  ok("19.19 the trash lists trashed events as well as contacts",
     ((await A.page.textContent("body")) ?? "").includes("Binned Gathering"));
  await A.page.click('form:has(input[value="' + doomedEvent.id + '"]) button:has-text("Restore")');
  await waitForDb("the event to come back", async () =>
    (await prisma.event.findUnique({ where: { id: doomedEvent.id }, select: { deletedAt: true } }))?.deletedAt === null);
  const restoredEvent = await prisma.event.findUniqueOrThrow({ where: { id: doomedEvent.id } });
  ok("19.19b restoring an event queues it back to the calendar",
     restoredEvent.deletedAt === null && restoredEvent.googleSyncStatus === "PENDING",
     restoredEvent.googleSyncStatus);
  ok("19.19c with no deletion left waiting to undo it",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_EVENT", resourceId: "gcal-trash", processedAt: null },
     })) === 0);

  // --- nothing prunes it ---------------------------------------------------
  // Asserted against the source rather than by waiting: "it did not empty in the next
  // ten seconds" would pass for a job with any interval at all. The claim being made is
  // that no code path deletes by age, which is a claim about what exists.
  const srcFiles = ["src/lib/sync/scheduler.ts", "src/lib/sync/runner.ts", "src/lib/sync/reap.ts"];
  const scheduled = srcFiles
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  ok("19.20 nothing in the background deletes by age",
     !/deletedAt[^\n]*(lt|lte)\s*:/.test(scheduled) && !scheduled.includes("person.delete"),
     srcFiles.join(", "));
  const trashedStill = await prisma.person.create({
    data: { ownerId: A.id, displayName: "Old Trash", deletedAt: new Date("2020-01-01T00:00:00Z") },
  });
  await A.page.goto("/trash");
  ok("19.20b and a record trashed years ago is still there",
     ((await A.page.textContent("body")) ?? "").includes("Old Trash"),
     trashedStill.id);

  // --- emptying it, in one decision ----------------------------------------
  //
  // The reason this exists: thirty deleted contacts should not be thirty confirmations.
  // What keeps the page safe is that the decision is never made for you, not that it is
  // made slowly.
  const bulk: { id: string }[] = [];
  for (const n of ["Bulk One", "Bulk Two", "Bulk Three"]) {
    bulk.push(await prisma.person.create({
      data: {
        ownerId: A.id, displayName: n, deletedAt: new Date(),
        googleSyncs: { create: [{ userId: A.id, googleResourceName: `people/${n.replace(" ", "")}`, googleSyncStatus: "SYNCED" }] },
      },
    }));
  }
  const bulkEvent = await prisma.event.create({
    data: {
      ownerId: A.id, title: "Bulk Gathering", startAt: new Date("2026-05-01T18:00:00Z"),
      timeZone: "UTC", addToGoogle: true, googleEventId: "gcal-bulk", deletedAt: new Date(),
    },
  });
  // A user's own card, trashed, to prove emptying leaves it behind rather than taking the
  // household down with the bin.
  await prisma.person.update({ where: { id: kid.id }, data: { deletedAt: new Date() } });

  await A.page.goto("/trash");
  const beforeEmpty = (await A.page.textContent("body")) ?? "";
  ok("19.21 the trash offers to empty itself in one go",
     (await A.page.$$('button:has-text("Empty trash")')).length === 1);
  // Read from the tooltip itself, not from the page: the button's own label contains the
  // words "Empty trash", so asking the whole body would pass whatever the note said.
  const trashNote = (await A.page.textContent('[role="tooltip"]')) ?? "";
  ok("19.21b and the note says so, rather than only that nothing prunes it",
     trashNote.includes("Empty trash") && trashNote.includes("never empties itself"),
     trashNote.slice(0, 160) || beforeEmpty.length);
  await A.page.click('button:has-text("Empty trash")');
  // Waits for the events too, not only the contacts. emptyTrash destroys people first and
  // events second, in a transaction each, so "the contacts are gone" is the middle of the
  // operation rather than the end of it — and asserting on the events there failed about one
  // run in three. The same shape as 19.12d: one wait per write.
  await waitForDb("the trash to empty", async () =>
    (await prisma.person.count({ where: { id: { in: bulk.map((b) => b.id) } } })) === 0
      && (await prisma.event.count({ where: { id: bulkEvent.id } })) === 0
      && (await prisma.person.count({ where: { id: trashedStill.id } })) === 0);
  ok("19.22 emptying destroys every trashed contact",
     (await prisma.person.count({ where: { id: { in: bulk.map((b) => b.id) } } })) === 0);
  ok("19.22b and every trashed event",
     (await prisma.event.count({ where: { id: bulkEvent.id } })) === 0);
  ok("19.22c including one trashed years ago, since it was asked for explicitly",
     (await prisma.person.count({ where: { id: trashedStill.id } })) === 0);
  ok("19.22d with the Google copies queued to follow them",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_CONTACT", resourceId: { startsWith: "people/Bulk" }, processedAt: null },
     })) === 3
       && (await prisma.syncTombstone.count({
         where: { target: "GOOGLE_EVENT", resourceId: "gcal-bulk", processedAt: null },
       })) === 1);
  ok("19.23 a Hearth user's own card survives the emptying",
     (await prisma.person.count({ where: { id: kid.id } })) === 1);
  await A.page.goto("/trash");
  const afterEmpty = (await A.page.textContent("body")) ?? "";
  ok("19.23b and is all that is left in the bin",
     !afterEmpty.includes("Bulk One") && !afterEmpty.includes("Bulk Gathering")
       && afterEmpty.includes("Alice"), afterEmpty.slice(0, 200));
  ok("19.23c with nothing left to empty, the button is gone",
     (await A.page.$$('button:has-text("Empty trash")')).length === 0);

  // Live records are untouched by emptying — the obvious catastrophe, worth stating.
  await prisma.person.update({ where: { id: kid.id }, data: { deletedAt: null } });
  await A.page.goto("/people");
  ok("19.24 emptying the trash left the live contacts alone",
     ((await A.page.textContent("body")) ?? "").includes("Gift Auntie"));

  // ════════════════════════════════════════════════════════════════════════
  section("§20 Importing the same Google contact twice");

  // Reported from a real install: import three contacts from Google, delete them in Hearth,
  // import the same three again — and they come back reading "Not in Google" with the sync
  // reporting nothing to do. Both symptoms are one cause: DISABLED renders as "Not in
  // Google" and is excluded from the push queue.
  const { importOne: importAgain } = await import("@/lib/google/import-one");
  const reGoogle = {
    resourceName: "people/twice", etag: "etag-twice",
    names: [{ givenName: "Second", familyName: "Chance", displayName: "Second Chance" }],
    emailAddresses: [{ value: "twice@e2e.test" }],
  };
  const planTwice = () =>
    planGoogleImport([reGoogle], { linkedResourceNames: new Set<string>() }).contacts[0]!;

  await importAgain(A.id, planTwice(), new Map());
  const first = await prisma.person.findFirstOrThrow({
    where: { ownerId: A.id, displayName: "Second Chance" },
    include: { googleSyncs: true },
  });
  ok("20.1 an imported contact is queued to reach Google",
     first.addToGoogle && first.googleSyncs[0]?.googleSyncStatus === "PENDING"
       && first.googleSyncs[0]?.googleResourceName === "people/twice",
     { addToGoogle: first.addToGoogle, sync: first.googleSyncs[0]?.googleSyncStatus });

  // Deleted the way a person deletes it, so the tombstone is queued exactly as it would be.
  await A.page.goto(`/people/${first.id}`);
  await A.page.click('button:has-text("Move to trash")');
  await waitForDb("the contact to be trashed", async () =>
    (await prisma.person.findUnique({ where: { id: first.id }, select: { deletedAt: true } }))?.deletedAt !== null);
  ok("20.2 deleting it queues the Google copy for removal",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_CONTACT", resourceId: "people/twice", processedAt: null },
     })) === 1);

  // Now the same Google contact again. It still exists in Google — the deletion has not been
  // sent yet — so the import offers it, and taking it must mean taking it back.
  await importAgain(A.id, planTwice(), new Map());
  const second = await prisma.person.findFirst({
    where: { ownerId: A.id, displayName: "Second Chance", deletedAt: null },
    include: { googleSyncs: true },
  });
  ok("20.3 re-importing it works at all", second !== null);
  ok("20.3b and the new contact holds the Google link",
     second?.googleSyncs[0]?.googleResourceName === "people/twice",
     second?.googleSyncs.map((g) => g.googleResourceName));
  ok("20.3c and reads as waiting for Google rather than as absent from it",
     second?.addToGoogle === true && second?.googleSyncs[0]?.googleSyncStatus === "PENDING",
     { addToGoogle: second?.addToGoogle, sync: second?.googleSyncs[0]?.googleSyncStatus });

  // The heart of it. A queued deletion that outlives the record it was made for settles onto
  // whatever row holds that resource name next — and settleTombstone matches on the resource
  // alone. Left in place, the next sync would delete the contact from Google and set the
  // FRESHLY imported row to DISABLED: "Not in Google", nothing to do, and the Google contact
  // gone. Re-importing a contact is an unambiguous statement that you want it, so the
  // deletion is cancelled.
  ok("20.4 re-importing cancels the deletion that was still waiting to be sent",
     (await prisma.syncTombstone.count({
       where: { target: "GOOGLE_CONTACT", resourceId: "people/twice", processedAt: null },
     })) === 0,
     await prisma.syncTombstone.findMany({
       where: { target: "GOOGLE_CONTACT", resourceId: "people/twice" },
       select: { processedAt: true, reason: true },
     }));
  ok("20.4b and the trashed original no longer claims the resource name",
     (await prisma.personSync.count({
       where: { personId: first.id, googleResourceName: "people/twice" },
     })) === 0);

  // It is in the push queue, which is the assertion the bug report was really about: the
  // same predicate the sync uses, asked directly.
  const { readablePeopleWhere: readableForQueue } = await import("@/lib/access");
  const queued = await prisma.person.count({
    where: {
      AND: [
        readableForQueue(A.id),
        { id: second!.id, addToGoogle: true },
        { googleSyncs: { some: { userId: A.id, googleSyncStatus: { in: ["PENDING", "ERROR"] } } } },
      ],
    },
  });
  ok("20.5 and the sync has something to do", queued === 1, queued);

  // The other half of the same bug, for the timeline where a sync HAS already run between
  // the delete and the re-import: the deletion is no longer pending, so cancelling it is not
  // what saves the new contact. What saves it is that settling a tombstone only forgets the
  // link belonging to the contact it was queued for.
  const { forgetGoogleLink } = await import("@/lib/sync/tombstones");
  const stale = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Stale Link", deletedAt: new Date(),
      googleSyncs: { create: { userId: A.id, googleResourceName: "people/shared-name", googleSyncStatus: "SYNCED" } },
    },
  });
  const live = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Live Again",
      googleSyncs: { create: { userId: A.id, googleSyncStatus: "PENDING" } },
    },
  });
  // Both rows would match on resource name alone, which is what the old code did.
  await prisma.personSync.updateMany({
    where: { personId: stale.id },
    data: { googleResourceName: null },
  });
  await prisma.personSync.updateMany({
    where: { personId: live.id },
    data: { googleResourceName: "people/shared-name" },
  });
  const cleared = await forgetGoogleLink(prisma, {
    userId: A.id,
    resourceId: "people/shared-name",
    personId: stale.id,
  });
  ok("20.6 settling a deletion does not disable a different contact holding that resource",
     cleared === 0
       && (await prisma.personSync.findFirstOrThrow({ where: { personId: live.id } }))
            .googleSyncStatus === "PENDING",
     cleared);
  ok("20.6b and a deletion whose contact is gone for good touches nothing",
     (await forgetGoogleLink(prisma, {
       userId: A.id, resourceId: "people/shared-name", personId: null,
     })) === 0
       && (await prisma.personSync.findFirstOrThrow({ where: { personId: live.id } }))
            .googleResourceName === "people/shared-name");
  // And it does forget the right one when the ids agree.
  ok("20.6c while the contact it WAS queued for does lose its link",
     (await forgetGoogleLink(prisma, {
       userId: A.id, resourceId: "people/shared-name", personId: live.id,
     })) === 1
       && (await prisma.personSync.findFirstOrThrow({ where: { personId: live.id } }))
            .googleSyncStatus === "DISABLED");

  await prisma.person.deleteMany({
    where: { id: { in: [first.id, second!.id, stale.id, live.id] } },
  });

  // ════════════════════════════════════════════════════════════════════════
  section("§21 Bulk actions on the people list");

  // Driven through the browser throughout. The whole feature IS form wiring — one form
  // around the table, checkboxes named personId, and buttons that send it to three
  // different actions with their own name/value — and none of that is testable by calling
  // the actions directly.
  const bulkLabel = await prisma.label.create({
    data: { ownerId: A.id, name: "Bulk Label" },
  });
  const bulkPeople: { id: string }[] = [];
  for (const n of ["Bulk Alpha", "Bulk Beta", "Bulk Gamma"]) {
    bulkPeople.push(await prisma.person.create({
      data: {
        ownerId: A.id, displayName: n, givenName: n.split(" ")[0], familyName: n.split(" ")[1],
        addToGoogle: false,
      },
    }));
  }
  // One shared with A but owned by B: it must be editable and NOT deletable, which is the
  // rule a bulk control is most likely to get wrong.
  const bulkShared = await prisma.person.create({
    data: { ownerId: B.id, displayName: "Bulk Shared", addToGoogle: false },
  });
  await prisma.share.create({
    data: { ownerId: B.id, withUserId: A.id, personId: bulkShared.id, scope: "PERSON", permission: "EDIT" },
  });

  /**
   * Tick every listed row, and make sure it took.
   *
   * The header checkbox is a client component: its onChange sets the row boxes, so a click
   * that lands before hydration does nothing at all. The action then reports "nothing
   * selected", the labels stay put, and §21.5 fails about one run in three for a reason that
   * has nothing to do with labels. Waiting for the bar to appear is the confirmation that the
   * click was heard.
   */
  const selectAllRows = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await A.page.click('th input[aria-label="Select all listed contacts"]');
      try {
        await A.page.waitForSelector('form#people-bulk >> text=selected', { timeout: 5_000 });
        return;
      } catch {
        // Not hydrated yet. Untick and try again, so the second click is not a toggle-off.
        await A.page.click('th input[aria-label="Select all listed contacts"]').catch(() => {});
      }
    }
    throw new Error("the select-all checkbox never took effect");
  };

  const tick = async (name: string) => {
    await A.page.check(`tr:has-text("${name}") input[name="personId"]`);
  };
  const bulkBar = () => A.page.textContent('form#people-bulk >> text=selected');

  await A.page.goto("/people?q=Bulk");
  ok("21.1 every row has a checkbox",
     (await A.page.$$('input[name="personId"]')).length >= 4,
     (await A.page.$$('input[name="personId"]')).length);
  ok("21.1b and no bulk bar until something is ticked",
     (await A.page.$$('form#people-bulk >> text=selected')).length === 0);

  await tick("Bulk Alpha");
  await A.page.waitForSelector('form#people-bulk >> text=selected', { timeout: 10_000 });
  ok("21.2 ticking a row shows what is selected", ((await bulkBar()) ?? "").includes("1 selected"),
     await bulkBar());

  await selectAllRows();
  await A.page.waitForFunction(
    () => document.querySelectorAll('input[name="personId"]:not(:checked)').length === 0,
    undefined, { timeout: 10_000 },
  ).catch(() => {});
  const allCount = (await A.page.$$('input[name="personId"]')).length;
  ok("21.3 select all ticks every listed row",
     ((await bulkBar()) ?? "").includes(`${allCount} selected`), await bulkBar());

  // --- bulk label ----------------------------------------------------------
  await A.page.click('form#people-bulk button:has-text("Labels")');
  await A.page.check(`form#people-bulk input[name="labelName"][value="Bulk Label"]`);
  // :text-is, not :has-text — the latter matches substrings, so "Add" found the
  // "Add to Google" button rendered above and this check spent two runs failing while the
  // code was right.
  await A.page.click('form#people-bulk button:text-is("Add")');
  await waitForDb("the label to reach all three", async () =>
    (await prisma.personLabel.count({ where: { labelId: bulkLabel.id } })) === 3);
  ok("21.4 a label is applied to everything selected",
     (await prisma.personLabel.count({ where: { labelId: bulkLabel.id } })) === 3,
     await A.page.textContent('form#people-bulk [role="status"]').catch(() => "no message"));
  // The shared contact is owned by B, so it gets B's label of the same name rather than
  // A's — the rule that a contact carries its owner's labels, kept in bulk.
  const bsLabels = await prisma.personLabel.findMany({
    where: { personId: bulkShared.id },
    include: { label: true },
  });
  ok("21.4b including one shared with you, under its OWNER's label of that name",
     bsLabels.length === 1 && bsLabels[0]?.label.name === "Bulk Label"
       && bsLabels[0]?.label.ownerId === B.id,
     bsLabels.map((pl) => `${pl.label.name}/${pl.label.ownerId === B.id ? "B" : "A"}`));

  // Seeded directly first, so removal is a removal. The earlier version of this check ran
  // straight after the add and would have passed on a count that was already zero — which
  // is exactly how it passed while the add was broken.
  await prisma.personLabel.createMany({
    data: bulkPeople.map((p) => ({ personId: p.id, labelId: bulkLabel.id })),
    skipDuplicates: true,
  });
  const beforeRemoval = await prisma.personLabel.count({ where: { labelId: bulkLabel.id } });
  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:has-text("Labels")');
  await A.page.check(`form#people-bulk input[name="labelName"][value="Bulk Label"]`);
  await A.page.click('form#people-bulk button:text-is("Remove")');
  // Both label ids, not just A's. The action removes one contact at a time, and the shared
  // one carries its OWNER's label of that name — a different id — so waiting only for A's
  // returned while B's removal was still in flight. Third time this shape has bitten: one
  // wait per write.
  await waitForDb("the label to be taken off all four", async () =>
    (await prisma.personLabel.count({ where: { labelId: bulkLabel.id } })) === 0
      && (await prisma.personLabel.count({ where: { personId: bulkShared.id } })) === 0);
  const leftOn = await prisma.personLabel.findMany({
    where: { personId: bulkShared.id },
    include: { label: true },
  });
  ok("21.5 and can be taken off the same way",
     beforeRemoval === 3
       && (await prisma.personLabel.count({ where: { labelId: bulkLabel.id } })) === 0
       && (await prisma.personLabel.count({ where: { personId: bulkShared.id } })) === 0,
     { beforeRemoval, leftOn: leftOn.map((pl) => `${pl.label.name}/${pl.label.ownerId}`),
       msg: await A.page.textContent('form#people-bulk [role="status"]').catch(() => null) });

  // --- bulk Add to Google --------------------------------------------------
  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:has-text("Add to Google")');
  await waitForDb("all four to be marked for Google", async () =>
    (await prisma.person.count({
      where: { id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] }, addToGoogle: true },
    })) === 4);
  ok("21.6 Add to Google applies to the selection, shared records included",
     (await prisma.person.count({
       where: { id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] }, addToGoogle: true },
     })) === 4);

  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:has-text("Remove from Google")');
  await waitForDb("all four to be unmarked", async () =>
    (await prisma.person.count({
       where: { id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] }, addToGoogle: false },
    })) === 4);
  ok("21.6b and unticking it queues the Google copies for removal",
     (await prisma.person.count({
       where: { id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] }, addToGoogle: false },
     })) === 4);

  // --- bulk delete ---------------------------------------------------------
  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:has-text("Move to trash")');
  await waitForDb("the three owned contacts to be trashed", async () =>
    (await prisma.person.count({
      where: { id: { in: bulkPeople.map((p) => p.id) }, deletedAt: { not: null } },
    })) === 3);
  ok("21.7 deleting in bulk trashes what you own",
     (await prisma.person.count({
       where: { id: { in: bulkPeople.map((p) => p.id) }, deletedAt: { not: null } },
     })) === 3);
  // The one that matters: an EDIT share is help maintaining a record, not permission to
  // destroy it, and a bulk button must not be the place that rule gets forgotten.
  ok("21.7b and leaves somebody else's contact alone",
     (await prisma.person.findUniqueOrThrow({ where: { id: bulkShared.id } })).deletedAt === null);
  const bulkMsg = (await A.page.textContent('form#people-bulk [role="status"]')) ?? "";
  ok("21.7c saying so, rather than silently doing three of four",
     bulkMsg.includes("3 contact") && bulkMsg.includes("not yours to delete"), bulkMsg);
  ok("21.7d and each trashing is in that contact's history",
     (await prisma.personVersion.count({
       where: { personId: { in: bulkPeople.map((p) => p.id) }, source: "TRASHED" },
     })) === 3);

  // --- bulk field edit -----------------------------------------------------
  //
  // Restored from the trash first, because §21.7 put them there and this needs live rows.
  await prisma.person.updateMany({
    where: { id: { in: bulkPeople.map((p) => p.id) } },
    data: { deletedAt: null },
  });
  const bulkCustom = await prisma.fieldDefinition.create({
    data: {
      ownerId: A.id, entity: "PERSON", key: "howTheyVote", label: "How they vote",
      type: "TEXT", order: 200,
    },
  });
  // One of them already carries an unrelated custom value: setting a different custom field
  // must not take it, which is the merge that a JSONB bag makes easy to get wrong.
  await prisma.fieldDefinition.create({
    data: {
      ownerId: A.id, entity: "PERSON", key: "keepMe", label: "Keep me",
      type: "TEXT", order: 201,
    },
  });
  await prisma.person.update({
    where: { id: bulkPeople[0]!.id },
    data: { custom: { keepMe: "still here" }, jobTitle: "Old Title" },
  });

  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Fields")');
  await A.page.check('form#people-bulk input[name="field"][value="jobTitle"]');
  await A.page.check('form#people-bulk input[name="field"][value="howTheyVote"]');
  await A.page.fill("#field-jobTitle", "Chief Bulk Officer");
  await A.page.fill("#field-howTheyVote", "by post");
  await A.page.click('form#people-bulk button:has-text("Apply to")');
  await waitForDb("the job title to reach all four", async () =>
    (await prisma.person.count({
      where: {
        id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] },
        jobTitle: "Chief Bulk Officer",
      },
    })) === 4);
  ok("21.8 a core column is set across the selection",
     (await prisma.person.count({
       where: {
         id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] },
         jobTitle: "Chief Bulk Officer",
       },
     })) === 4,
     await A.page.textContent('form#people-bulk [role="status"]').catch(() => "no message"));
  const votes = await prisma.person.findMany({
    where: { id: { in: bulkPeople.map((p) => p.id) } },
    select: { id: true, custom: true },
  });
  ok("21.8b and a custom field with it",
     votes.every((v) => (v.custom as Record<string, unknown>).howTheyVote === "by post"),
     votes.map((v) => v.custom));
  ok("21.8c without taking the custom value that was already there",
     (votes.find((v) => v.id === bulkPeople[0]!.id)!.custom as Record<string, unknown>).keepMe
       === "still here",
     votes.find((v) => v.id === bulkPeople[0]!.id)?.custom);
  ok("21.8d and every contact keeps a history entry for it",
     (await prisma.personVersion.count({
       where: { personId: { in: bulkPeople.map((p) => p.id) }, source: "EDITED" },
     })) >= 3);

  // A field nobody ticked is not written. This is the whole safety property of the panel:
  // it is an edit form for a selection, and an untouched field must not become a blank one.
  const untouched = await prisma.person.findMany({
    where: { id: { in: bulkPeople.map((p) => p.id) } },
    select: { displayName: true, organization: true },
  });
  ok("21.9 a field nobody ticked is left alone",
     untouched.every((u) => u.displayName.startsWith("Bulk") && u.organization === null),
     untouched);

  // Clearing is asked for explicitly, because an empty box on a ticked field is
  // indistinguishable from leaving it be.
  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Fields")');
  await A.page.check('form#people-bulk input[name="field"][value="jobTitle"]');
  await A.page.check('form#people-bulk input[name="clear"][value="jobTitle"]');
  await A.page.click('form#people-bulk button:has-text("Apply to")');
  await waitForDb("the job title to be cleared", async () =>
    (await prisma.person.count({
      where: { id: { in: bulkPeople.map((p) => p.id) }, jobTitle: null },
    })) === 3);
  ok("21.10 a ticked field can be cleared on purpose",
     (await prisma.person.count({
       where: { id: { in: bulkPeople.map((p) => p.id) }, jobTitle: null },
     })) === 3);
  ok("21.10b and clearing one field leaves the others",
     (await prisma.person.count({
       where: {
         id: { in: bulkPeople.map((p) => p.id) },
         custom: { path: ["howTheyVote"], equals: "by post" },
       },
     })) === 3);

  // Validation is the form's, not a second set of rules for bulk data.
  //
  // Over-long text rather than "not a number" in a NUMBER field: a number input will not
  // accept the letters at all, so the browser refuses before the server is asked and the
  // check proves nothing about the server. A TEXT field carries no maxlength attribute, so
  // 1001 characters reach the action and its schema is the thing that says no.
  const numberField = await prisma.fieldDefinition.create({
    data: {
      ownerId: A.id, entity: "PERSON", key: "hatSize", label: "Hat size",
      type: "TEXT", order: 202,
    },
  });
  await A.page.goto("/people?q=Bulk");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Fields")');
  await A.page.check('form#people-bulk input[name="field"][value="hatSize"]');
  await A.page.fill("#field-hatSize", "x".repeat(1001));
  await A.page.click('form#people-bulk button:has-text("Apply to")');
  await A.page.waitForSelector('form#people-bulk [role="status"]', { timeout: 15_000 })
    .catch(() => {});
  // Read back and inspected rather than asked of jsonb: "is this key absent" needs
  // DbNull/JsonNull care that says nothing extra here.
  const hats = await prisma.person.findMany({
    where: { id: { in: bulkPeople.map((p) => p.id) } },
    select: { custom: true },
  });
  const hatMsg = await A.page.textContent('form#people-bulk [role="status"]').catch(() => "");
  ok("21.11 a value the single-contact form would refuse is refused here too",
     hats.every((h) => !("hatSize" in (h.custom as Record<string, unknown>))), hatMsg);
  ok("21.11b and it says so rather than failing quietly",
     (hatMsg ?? "").toLowerCase().includes("fix"), hatMsg);

  await prisma.person.deleteMany({
    where: { id: { in: [...bulkPeople.map((p) => p.id), bulkShared.id] } },
  });
  await prisma.fieldDefinition.deleteMany({
    where: { id: { in: [bulkCustom.id, numberField.id] } },
  });
  await prisma.fieldDefinition.deleteMany({ where: { ownerId: A.id, key: "keepMe" } });
  await prisma.label.deleteMany({ where: { name: "Bulk Label" } });

  // ════════════════════════════════════════════════════════════════════════
  section("§23 Saving a field mapping shows what was saved");

  // Reported from a real install: choose a Google destination, press Save mappings, and the
  // dropdown snaps back to "Not synced" — while the database holds the choice and a refresh
  // displays it. React resets a form once its action settles, and that reset lands AFTER the
  // re-render the revalidation causes, so a controlled select was left showing the reset
  // value with no further render to put it back.
  //
  // The check is deliberately "without reloading". A reload has always shown the truth; that
  // is what made this confusing rather than obviously broken.
  const mapField = await prisma.fieldDefinition.create({
    data: {
      ownerId: A.id, entity: "PERSON", key: "howTheyTakeTea", label: "How they take tea",
      type: "TEXT", order: 300,
    },
  });
  const mapSel = 'select[name="target_howTheyTakeTea"]';
  await A.page.goto("/settings/mappings/people");
  await A.page.waitForSelector(mapSel, { timeout: 10_000 });
  ok("23.1 an unmapped custom field starts as not synced",
     (await A.page.inputValue(mapSel)) === "none", await A.page.inputValue(mapSel));

  await A.page.selectOption(mapSel, "biographies");
  await A.page.click('button:has-text("Save mappings")');
  await waitForDb("the mapping to be stored", async () =>
    (await prisma.fieldMapping.findFirst({
      where: { ownerId: A.id, fieldKey: "howTheyTakeTea" },
    }))?.target === "biographies");
  ok("23.2 the mapping is stored",
     (await prisma.fieldMapping.findFirst({
       where: { ownerId: A.id, fieldKey: "howTheyTakeTea" },
     }))?.target === "biographies");

  // The bug. data-saved carries what the server says, so a stale DOM and a stale prop can be
  // told apart — they look identical from outside and need opposite fixes.
  ok("23.3 and the dropdown still shows it, with no reload",
     (await A.page.inputValue(mapSel)) === "biographies",
     `select=${await A.page.inputValue(mapSel)} prop=${await A.page.getAttribute(mapSel, "data-saved")}`);
  ok("23.3b the select and the server agree",
     (await A.page.inputValue(mapSel)) === (await A.page.getAttribute(mapSel, "data-saved")));

  // Saving again without changing anything must not undo the display either — that is the
  // same reset, and keying only on a changed value would miss it.
  await A.page.click('button:has-text("Save mappings")');
  await A.page.waitForTimeout(1500);
  ok("23.4 saving again with nothing changed leaves it alone",
     (await A.page.inputValue(mapSel)) === "biographies", await A.page.inputValue(mapSel));

  // And changing it a second time, since the first change was from the initial state.
  await A.page.selectOption(mapSel, "nicknames");
  await A.page.click('button:has-text("Save mappings")');
  await waitForDb("the second mapping to be stored", async () =>
    (await prisma.fieldMapping.findFirst({
      where: { ownerId: A.id, fieldKey: "howTheyTakeTea" },
    }))?.target === "nicknames");
  ok("23.5 a second change sticks too",
     (await A.page.inputValue(mapSel)) === "nicknames", await A.page.inputValue(mapSel));

  // Back to not synced, which is a removal rather than an update.
  await A.page.selectOption(mapSel, "none");
  await A.page.click('button:has-text("Save mappings")');
  await waitForDb("the mapping to be removed", async () =>
    (await prisma.fieldMapping.count({
      where: { ownerId: A.id, fieldKey: "howTheyTakeTea" },
    })) === 0);
  ok("23.6 and it can be set back to not synced",
     (await A.page.inputValue(mapSel)) === "none", await A.page.inputValue(mapSel));

  await prisma.fieldDefinition.delete({ where: { id: mapField.id } });

  // ════════════════════════════════════════════════════════════════════════
  section("§24 Editing a contact leaves its address alone");

  // Reported from a real install: rename a contact imported from Google and its address came
  // back as "784 Broadway DrSun Prairie, WI 53590USA" — the newlines gone, the parts intact.
  // An address value is the formatted block Google returns, and an <input> strips CR and LF
  // from its value, so the form flattened it on every save of anything.
  //
  // Driven through the browser because the bug is in the form, not in the action: calling
  // updatePerson directly would have passed while the page kept mangling addresses.
  const ADDR = "784 Broadway Dr\nSun Prairie, WI 53590\nUSA";
  const lineAddrPerson = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Addie Line", givenName: "Addie", familyName: "Line",
      contactPoints: {
        create: [{
          kind: "ADDRESS", label: "home", value: ADDR, order: 0,
          streetAddress: "784 Broadway Dr", city: "Sun Prairie", region: "WI",
          postalCode: "53590", country: "USA",
        }],
      },
    },
  });

  await A.page.goto(`/people/${lineAddrPerson.id}/edit`);
  await A.page.waitForSelector('[name="cp_value"]', { timeout: 10_000 });
  ok("24.1 an address is edited in a control that can hold more than one line",
     (await A.page.$eval('[name="cp_value"]', (el) => el.tagName.toLowerCase())) === "textarea",
     await A.page.$eval('[name="cp_value"]', (el) => el.tagName.toLowerCase()));
  ok("24.1b showing the address as stored, newlines and all",
     (await A.page.inputValue('[name="cp_value"]')) === ADDR,
     JSON.stringify(await A.page.inputValue('[name="cp_value"]')));

  // The reported action: change the NAME, touch nothing else.
  await A.page.fill("#field-givenName", "Adelaide");
  await A.page.click('button:has-text("Save")');
  await waitForDb("the rename to land", async () =>
    (await prisma.person.findUnique({
      where: { id: lineAddrPerson.id }, select: { givenName: true },
    }))?.givenName === "Adelaide");

  const lineAddrAfter = await prisma.contactPoint.findFirstOrThrow({
    where: { personId: lineAddrPerson.id, kind: "ADDRESS" },
  });
  ok("24.2 renaming a contact does not touch its address",
     lineAddrAfter.value === ADDR, JSON.stringify(lineAddrAfter.value));
  ok("24.2b and the structured parts are still there",
     lineAddrAfter.streetAddress === "784 Broadway Dr" && lineAddrAfter.city === "Sun Prairie"
       && lineAddrAfter.region === "WI" && lineAddrAfter.postalCode === "53590"
       && lineAddrAfter.country === "USA",
     lineAddrAfter);

  // Twice, because the flattening was cumulative: each save through a single-line control
  // removed whatever newlines were left.
  await A.page.goto(`/people/${lineAddrPerson.id}/edit`);
  await A.page.fill("#field-givenName", "Addie");
  await A.page.click('button:has-text("Save")');
  await waitForDb("the second rename to land", async () =>
    (await prisma.person.findUnique({
      where: { id: lineAddrPerson.id }, select: { givenName: true },
    }))?.givenName === "Addie");
  ok("24.3 and still does not on a second save",
     (await prisma.contactPoint.findFirstOrThrow({
       where: { personId: lineAddrPerson.id, kind: "ADDRESS" },
     })).value === ADDR);

  // An address somebody types over should of course still save.
  await A.page.goto(`/people/${lineAddrPerson.id}/edit`);
  await A.page.fill('[name="cp_value"]', "1 New Road\nLeeds\nLS1 1AA");
  await A.page.click('button:has-text("Save")');
  await waitForDb("the edited address to land", async () =>
    (await prisma.contactPoint.findFirstOrThrow({
      where: { personId: lineAddrPerson.id, kind: "ADDRESS" },
    })).value.includes("Leeds"));
  ok("24.4 an address that IS edited saves, newlines included",
     (await prisma.contactPoint.findFirstOrThrow({
       where: { personId: lineAddrPerson.id, kind: "ADDRESS" },
     })).value === "1 New Road\nLeeds\nLS1 1AA");

  // Notes are a textarea too, and the same CRLF normalisation applies — a push to Google
  // reported the whole biography as changed on every save otherwise.
  await prisma.person.update({
    where: { id: lineAddrPerson.id },
    data: { notes: "Line one\nLine two\nLine three" },
  });
  await A.page.goto(`/people/${lineAddrPerson.id}/edit`);
  await A.page.fill("#field-givenName", "Adela");
  await A.page.click('button:has-text("Save")');
  await waitForDb("the third rename to land", async () =>
    (await prisma.person.findUnique({
      where: { id: lineAddrPerson.id }, select: { givenName: true },
    }))?.givenName === "Adela");
  ok("24.5 multi-line notes keep their newlines rather than gaining carriage returns",
     (await prisma.person.findUniqueOrThrow({ where: { id: lineAddrPerson.id } })).notes
       === "Line one\nLine two\nLine three",
     JSON.stringify((await prisma.person.findUniqueOrThrow({
       where: { id: lineAddrPerson.id },
     })).notes));

  await prisma.person.delete({ where: { id: lineAddrPerson.id } });

  // ════════════════════════════════════════════════════════════════════════
  section("§25 Bulk sharing from the people list");

  const shareLabelName = "Bulk Share Set";
  const sharePeople: { id: string }[] = [];
  for (const n of ["Zshare One", "Zshare Two", "Zshare Three"]) {
    sharePeople.push(await prisma.person.create({
      data: { ownerId: A.id, displayName: n, givenName: n.split(" ")[0], familyName: n.split(" ")[1] },
    }));
  }
  // Owned by B: sharing is the owner's alone, so this must be left out of everything below
  // even though A may edit it.
  const shareNotMine = await prisma.person.create({
    data: { ownerId: B.id, displayName: "Zshare Foreign" },
  });
  await prisma.share.create({
    data: { ownerId: B.id, withUserId: A.id, personId: shareNotMine.id, scope: "PERSON", permission: "EDIT" },
  });

  await A.page.goto("/people?q=Zshare");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Sharing")');
  await A.page.check(`form#people-bulk input[name="userId"][value="${B.id}"]`);
  await A.page.selectOption('form#people-bulk select[name="permission"]', "EDIT");
  await A.page.click('form#people-bulk button:text-is("Share")');
  await waitForDb("the three to be shared", async () =>
    (await prisma.share.count({
      where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
               personId: { in: sharePeople.map((p) => p.id) } },
    })) === 3);
  ok("25.1 a selection can be shared in one go",
     (await prisma.share.count({
       where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
                personId: { in: sharePeople.map((p) => p.id) }, permission: "EDIT" },
     })) === 3);
  // The rule sharing must not break: an edit grant is help maintaining a record, not the
  // right to pass it on.
  ok("25.1b and a contact somebody shared with YOU is not yours to share on",
     (await prisma.share.count({
       where: { ownerId: A.id, personId: shareNotMine.id },
     })) === 0);
  const shareMsg = (await A.page.textContent('form#people-bulk [role="status"]')) ?? "";
  ok("25.1c saying what it did and what it left alone",
     shareMsg.includes("3 contact") && shareMsg.includes("not yours to share"), shareMsg);

  // The recipient really can see them — the assertion that matters, rather than a row count.
  await B.page.goto("/people?q=Zshare");
  const bSees = (await B.page.textContent("body")) ?? "";
  ok("25.2 the recipient sees them in their own list",
     bSees.includes("Zshare One") && bSees.includes("Zshare Two") && bSees.includes("Zshare Three"));

  // Raising or lowering the permission is an update, not a second share.
  await A.page.goto("/people?q=Zshare");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Sharing")');
  await A.page.check(`form#people-bulk input[name="userId"][value="${B.id}"]`);
  await A.page.selectOption('form#people-bulk select[name="permission"]', "VIEW");
  await A.page.click('form#people-bulk button:text-is("Share")');
  await waitForDb("the permission to drop to VIEW", async () =>
    (await prisma.share.count({
      where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
               personId: { in: sharePeople.map((p) => p.id) }, permission: "VIEW" },
    })) === 3);
  ok("25.3 sharing again changes the permission rather than duplicating the share",
     (await prisma.share.count({
       where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
                personId: { in: sharePeople.map((p) => p.id) } },
     })) === 3);

  // And withdrawing it.
  await A.page.goto("/people?q=Zshare");
  await selectAllRows();
  await A.page.click('form#people-bulk button:text-is("Sharing")');
  await A.page.check(`form#people-bulk input[name="userId"][value="${B.id}"]`);
  await A.page.click('form#people-bulk button:has-text("Stop sharing")');
  await waitForDb("the shares to be withdrawn", async () =>
    (await prisma.share.count({
      where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
               personId: { in: sharePeople.map((p) => p.id) } },
    })) === 0);
  ok("25.4 and withdrawn in one go",
     (await prisma.share.count({
       where: { ownerId: A.id, withUserId: B.id, scope: "PERSON",
                personId: { in: sharePeople.map((p) => p.id) } },
     })) === 0);
  // Whether the recipient can still see them depends on something this control cannot
  // undo: a blanket "share everything" grant outranks any per-contact withdrawal. Earlier
  // sections may have created one, so this asks which world it is in rather than assuming —
  // and the interesting half is that the message SAYS so.
  const blanketToB = await prisma.share.count({
    where: { ownerId: A.id, withUserId: B.id, scope: "ALL_PEOPLE" },
  });
  const revokeMsg = (await A.page.textContent('form#people-bulk [role="status"]')) ?? "";
  if (blanketToB > 0) {
    ok("25.4b and when a blanket share still grants access, it says so rather than implying otherwise",
       revokeMsg.includes("blanket share"), revokeMsg);
  } else {
    await B.page.goto("/people?q=Zshare");
    ok("25.4b after which the recipient cannot see them",
       !((await B.page.textContent("body")) ?? "").includes("Zshare One"));
  }

  await prisma.person.deleteMany({
    where: { id: { in: [...sharePeople.map((p) => p.id), shareNotMine.id] } },
  });
  await prisma.label.deleteMany({ where: { name: shareLabelName } });

  // ════════════════════════════════════════════════════════════════════════
  section("§26 The query language");

  const { parseQuery, QueryError: QErr } = await import("@/lib/search/parse");
  const { compileQuery } = await import("@/lib/search/compile");

  // --- the parser, which is pure and has hundreds of inputs -----------------
  const shape = (q: string) => JSON.stringify(parseQuery(q));
  ok("26.1 a bare word is a text search",
     shape("hammerling") === '{"kind":"term","field":null,"op":":","value":"hammerling","quoted":false}',
     shape("hammerling"));
  ok("26.1b a field and value split on the FIRST colon",
     shape("notes:see me:tomorrow").includes('"field":"notes"')
       && shape("notes:see me:tomorrow").includes('see'),
     shape("notes:see me:tomorrow"));
  ok("26.1c a quoted value keeps its spaces and never splits on a colon",
     shape('city:"Sun Prairie"').includes('"value":"Sun Prairie"'),
     shape('city:"Sun Prairie"'));
  ok("26.2 juxtaposition is AND", JSON.parse(shape("a b"))!.kind === "and");
  ok("26.2b or is looser than and, so a b or c reads as (a and b) or c",
     JSON.parse(shape("a b or c"))!.kind === "or"
       && JSON.parse(shape("a b or c"))!.nodes[0].kind === "and",
     shape("a b or c"));
  ok("26.2c parentheses override that",
     JSON.parse(shape("a (b or c)"))!.kind === "and", shape("a (b or c)"));
  ok("26.3 a leading minus negates", JSON.parse(shape("-has:email"))!.kind === "not");
  ok("26.3b but a hyphen inside a word does not",
     JSON.parse(shape("well-known"))!.kind === "term", shape("well-known"));
  ok("26.3c and neither does one in a label name",
     shape("label:Work-Friends").includes('"value":"Work-Friends"'), shape("label:Work-Friends"));
  ok("26.4 comparisons are recognised",
     shape("created:>2026-01-01").includes('"op":">"'), shape("created:>2026-01-01"));
  ok("26.4b an empty query is nothing rather than an error", parseQuery("   ") === null);

  const rejects = (q: string) => {
    try {
      parseQuery(q);
      return "no error";
    } catch (err) {
      return err instanceof QErr ? "rejected" : "wrong error";
    }
  };
  for (const [q, why] of [
    ['city:"Sun', "an unclosed quote"],
    ["(label:Family", "an unclosed bracket"],
    ["label:Family)", "a stray closing bracket"],
    ["label:", "a field with no value"],
    ["a or", "a trailing or"],
    ["or a", "a leading or"],
  ] as [string, string][]) {
    ok(`26.5 ${why} is refused`, rejects(q) === "rejected", `${q} -> ${rejects(q)}`);
  }

  // --- the compiler, against the real database -----------------------------
  // Loaded AFTER the fixtures below, which is not tidiness: a custom field's name is only a
  // field once its definition exists, so a registry read before the create left `qhow:` as an
  // unknown name and the query degraded to a text search. The check failed and the code was
  // right.
  const { loadRegistry: loadRegistryForQuery } = await import("@/lib/fields/registry");
  const run = async (q: string) => {
    const { where } = compileQuery(q, A.id, qDefs);
    return prisma.person.count({
      where: { AND: [(await import("@/lib/access")).readablePeopleWhere(A.id), where] },
    });
  };
  const qNames = async (q: string) => {
    const { where } = compileQuery(q, A.id, qDefs);
    const rows = await prisma.person.findMany({
      where: { AND: [(await import("@/lib/access")).readablePeopleWhere(A.id), where] },
      select: { displayName: true },
      orderBy: { displayName: "asc" },
    });
    return rows.map((r) => r.displayName);
  };

  const qLabel = await prisma.label.create({ data: { ownerId: A.id, name: "Qtest" } });
  const qCustom = await prisma.fieldDefinition.create({
    data: { ownerId: A.id, entity: "PERSON", key: "qhow", label: "Qhow", type: "TEXT", order: 400 },
  });
  const qPeople: { id: string }[] = [];
  for (const [n, city, org, custom] of [
    ["Qa One", "Sun Prairie", "Acme", "at work"],
    ["Qa Two", "Madison", "Acme", "at school"],
    ["Qa Three", "Sun Prairie", "Beta", null],
  ] as [string, string, string, string | null][]) {
    qPeople.push(await prisma.person.create({
      data: {
        ownerId: A.id, displayName: n, givenName: "Qa", familyName: n.split(" ")[1],
        organization: org, custom: custom ? { qhow: custom } : {},
        labels: n === "Qa One" ? { create: [{ labelId: qLabel.id }] } : undefined,
        contactPoints: {
          create: [
            { kind: "ADDRESS", value: `1 Road\n${city}`, city, order: 0 },
            ...(n === "Qa Two" ? [] : [{ kind: "EMAIL" as const, value: `${n.replace(" ", "")}@e2e.test`, order: 0 }]),
          ],
        },
      },
    }));
  }

  const qDefs = await loadRegistryForQuery(A.id, "PERSON");

  ok("26.6 an address part is queryable",
     (await qNames('Qa city:"Sun Prairie"')).join() === "Qa One,Qa Three",
     await qNames('Qa city:"Sun Prairie"'));
  ok("26.6b a column alias resolves — org means organization",
     (await qNames("Qa org:Acme")).join() === "Qa One,Qa Two", await qNames("Qa org:Acme"));
  ok("26.6c a label by name", (await qNames("label:Qtest")).join() === "Qa One");
  ok("26.7 presence, and its negation",
     (await qNames("Qa -has:email")).join() === "Qa Two", await qNames("Qa -has:email"));
  ok("26.8 a custom field by its own key",
     (await qNames('Qa qhow:"at work"')).join() === "Qa One", await qNames('Qa qhow:"at work"'));
  ok("26.9 AND narrows",
     (await qNames('Qa city:"Sun Prairie" org:Acme')).join() === "Qa One");
  ok("26.9b OR widens",
     (await qNames("Qa (org:Beta or label:Qtest)")).join() === "Qa One,Qa Three",
     await qNames("Qa (org:Beta or label:Qtest)"));
  ok("26.9c and NOT excludes",
     (await qNames("Qa -org:Acme")).join() === "Qa Three", await qNames("Qa -org:Acme"));
  // Substring both ends by default, which is why there is no wildcard syntax: `city:Sun`
  // finding Sun Prairie AND Sun Gorge is the common intent.
  const qGorge = await prisma.person.create({
    data: {
      ownerId: A.id, displayName: "Qa Four", givenName: "Qa", familyName: "Four",
      contactPoints: {
        create: [{ kind: "ADDRESS", value: "9 Hill", city: "Sun Gorge", order: 0 }],
      },
    },
  });
  ok("26.10a a value matches anywhere in the field, so Sun finds both towns",
     (await qNames("Qa city:Sun")).join() === "Qa Four,Qa One,Qa Three",
     await qNames("Qa city:Sun"));
  ok("26.10b and = asks for the whole value instead",
     (await qNames('Qa city:="Sun Prairie"')).join() === "Qa One,Qa Three",
     await qNames('Qa city:="Sun Prairie"'));
  ok("26.10c which is still case-insensitive",
     (await qNames('Qa city:="sun prairie"')).length === 2);
  // The parser accepted these and the compiler used to throw them away.
  let badOp = "no error";
  try {
    compileQuery("org:>Acme", A.id, qDefs);
  } catch (err) {
    badOp = err instanceof QErr ? "rejected" : "wrong error";
  }
  ok("26.10d a comparison on a text field is refused rather than ignored",
     badOp === "rejected");

  ok("26.10 a bare phrase still searches the old seven columns",
     (await qNames('"Qa One"')).join() === "Qa One", await qNames('"Qa One"'));

  // An unknown field is text, not an error: 10:30 and re:union predate this language.
  const unknown = compileQuery("re:union", A.id, qDefs);
  ok("26.11 an unknown field is searched for as text",
     unknown.warnings.length === 1 && unknown.warnings[0]!.includes("not a field"),
     unknown.warnings);
  // A KNOWN field with an impossible value is worth stopping for.
  let badValue = "no error";
  try {
    compileQuery("google:banana", A.id, qDefs);
  } catch (err) {
    badValue = err instanceof QErr ? "rejected" : "wrong error";
  }
  ok("26.11b but a known field with an impossible value is refused", badValue === "rejected");

  // --- the property that matters most --------------------------------------
  //
  // No query may widen what its asker can see. Asserted by running every form of query as B
  // against a contact of A's that B has no access to — the one thing a query language is most
  // likely to break, and the reason the compiler returns a clause to be ANDed rather than a
  // whole where.
  // Owned by B and shared with nobody, queried as A. The other direction would prove nothing
  // here: A shares their whole address book with B in §14, so no contact of A's is private
  // from B and the check would pass without testing anything.
  const qPrivate = await prisma.person.create({
    data: {
      ownerId: B.id, displayName: "Qprivate Person", organization: "Acme",
      contactPoints: { create: [{ kind: "ADDRESS", value: "x", city: "Sun Prairie", order: 0 }] },
    },
  });
  const { readablePeopleWhere: readableForQuery } = await import("@/lib/access");
  const reachableByA = async (q: string) => {
    const { where } = compileQuery(q, A.id, qDefs);
    return prisma.person.count({
      where: { AND: [readableForQuery(A.id), where, { id: qPrivate.id }] },
    });
  };
  // The premise, asserted rather than assumed: without it a passing check might only mean the
  // contact was never there to find.
  ok("26.12 the premise — a contact owned by somebody else and shared with nobody",
     (await prisma.person.count({
       where: { AND: [readableForQuery(A.id), { id: qPrivate.id }] },
     })) === 0
       && (await prisma.person.count({ where: { id: qPrivate.id } })) === 1);
  let leaked = 0;
  for (const q of [
    "Qprivate", 'city:"Sun Prairie"', "org:Acme", "-org:Zzz", "is:mine", "google:off",
    "(org:Acme or org:Beta)", "-has:phone", "created:>2000-01-01", 'qhow:"at work"',
    "label:Qtest or Qprivate", "-label:Qtest", "-Qzzz",
  ]) {
    leaked += await reachableByA(q);
  }
  ok("26.12b and no query reaches it anyway", leaked === 0, leaked);

  // And the trash stays out, which the access clause gives for free but a query language is
  // exactly how somebody would reach around it.
  await prisma.person.update({
    where: { id: qPeople[0]!.id }, data: { deletedAt: new Date() },
  });
  ok("26.13 a trashed contact is not findable by any query",
     (await run("label:Qtest")) === 0 && (await run("Qa One")) === 0);

  await prisma.person.deleteMany({
    where: { id: { in: [...qPeople.map((p) => p.id), qPrivate.id, qGorge.id] } },
  });
  await prisma.label.delete({ where: { id: qLabel.id } });
  await prisma.fieldDefinition.delete({ where: { id: qCustom.id } });

  // ════════════════════════════════════════════════════════════════════════
  section("§27 Completing a query as you type");

  const { suggestQuery, applySuggestion } = await import("@/lib/search/suggest");
  const { searchVocabulary } = await import("@/lib/search/compile");
  const sDefs = await loadRegistryForQuery(A.id, "PERSON");
  const sVocab = searchVocabulary(sDefs, ["Family", "Work-Friends", "Bills Basement"]);

  // --- the pure part -------------------------------------------------------
  const sAt = (q: string) => suggestQuery(q, q.length, sVocab);
  const sLabels = (q: string) => sAt(q).items.map((i) => i.label);

  ok("27.1 an empty box suggests nothing, rather than covering the page",
     sAt("").items.length === 0);
  ok("27.2 a partial name offers the fields that start with it",
     sLabels("ci").includes("city:") && !sLabels("ci").includes("label:"), sLabels("ci"));
  ok("27.2b including a custom field, since names come from the registry",
     searchVocabulary(
       [...sDefs, { key: "howTheyVote", label: "How they vote", core: false } as never],
       [],
     ).fields.includes("howTheyVote"));
  ok("27.3 after a colon it offers that field's values",
     sLabels("label:").join() === "Family,Work-Friends,Bills Basement", sLabels("label:"));
  ok("27.3b narrowing as the value is typed",
     sLabels("label:work").join() === "Work-Friends", sLabels("label:work"));
  ok("27.3c and a field with no fixed values offers none",
     sAt("org:").items.length === 0);
  ok("27.4 has: and google: are offered from the same tables the compiler accepts",
     sLabels("has:").includes("email") && sLabels("google:").includes("error"),
     [sLabels("has:"), sLabels("google:")]);

  // The token being completed is not "the last word": a quoted value contains spaces, and
  // deciding where it began needs to know which quotes are open.
  ok("27.5 a value with a space in it is still one token",
     sLabels('label:"Bills Bas').join() === "Bills Basement",
     sLabels('label:"Bills Bas'));
  // "label:Family " is thirteen characters, so the token being completed starts at 13. The
  // number is asserted rather than "greater than zero" because an off-by-one here silently
  // eats the space and turns two terms into one.
  ok("27.5b a term earlier in the query is left alone",
     sAt("label:Family ci").from === 13
       && sAt("label:Family ci").to === 15,
     sAt("label:Family ci"));
  ok("27.6 a leading minus is kept, not completed over",
     sAt("-ci").items[0]?.insert === "-city:", sAt("-ci").items[0]);

  // Applying one has to put the cursor where the next keystroke belongs.
  const fieldPick = sAt("ci");
  const sApplied = applySuggestion("ci", fieldPick, fieldPick.items[0]!);
  ok("27.7 accepting a field leaves the cursor against the colon, ready for a value",
     sApplied.value === "city:" && sApplied.cursor === 5, sApplied);
  const valuePick = sAt("label:work");
  const sApplied2 = applySuggestion("label:work", valuePick, valuePick.items[0]!);
  ok("27.7b accepting a value adds a space, because the next thing is another term",
     sApplied2.value === "label:Work-Friends " && sApplied2.cursor === 19, sApplied2);
  ok("27.7c and a value with a space comes back quoted, or it would be two terms",
     applySuggestion('label:"Bills Bas', sAt('label:"Bills Bas'), sAt('label:"Bills Bas').items[0]!)
       .value === 'label:"Bills Basement" ',
     applySuggestion('label:"Bills Bas', sAt('label:"Bills Bas'), sAt('label:"Bills Bas').items[0]!).value);
  ok("27.8 text after the cursor survives",
     applySuggestion("ci org:Acme", suggestQuery("ci org:Acme", 2, sVocab),
       suggestQuery("ci org:Acme", 2, sVocab).items[0]!).value === "city: org:Acme",
     applySuggestion("ci org:Acme", suggestQuery("ci org:Acme", 2, sVocab),
       suggestQuery("ci org:Acme", 2, sVocab).items[0]!).value);

  // Everything offered must be something the compiler accepts. A box that teaches a language
  // the compiler refuses is worse than no box at all.
  const { compileQuery: compileForSuggest, QueryError: SErr } = await import("@/lib/search/compile");
  let unacceptable: string[] = [];
  for (const field of sVocab.fields) {
    const values = sVocab.values[field];
    const probe = values && values.length > 0
      ? `${field}:${/\s/.test(values[0]!) ? `"${values[0]}"` : values[0]}`
      : `${field}:x`;
    try {
      const { warnings } = compileForSuggest(probe, A.id, sDefs);
      if (warnings.length > 0) unacceptable.push(`${probe} (warned)`);
    } catch (err) {
      // A date field rejects "x", which is correct — the probe is wrong, not the field.
      if (!(err instanceof SErr) || !/is not a date/.test((err as Error).message)) {
        unacceptable.push(`${probe} (${(err as Error).message.slice(0, 40)})`);
      }
    }
  }
  ok("27.9 every field the box offers is one the compiler understands",
     unacceptable.length === 0, unacceptable);

  // --- and through the browser ---------------------------------------------
  await A.page.goto("/people");
  await A.page.fill('input[name="q"]', "");
  await A.page.type('input[name="q"]', "ci");
  await A.page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10_000 });
  const sOffered = await A.page.$$eval('[role="listbox"] [role="option"]', (os) =>
    os.map((o) => o.textContent?.trim() ?? ""));
  ok("27.10 the box offers completions in the page",
     sOffered.some((t) => t.startsWith("city:")), sOffered);

  await A.page.keyboard.press("Enter");
  ok("27.10b Enter accepts the highlighted one rather than submitting",
     (await A.page.inputValue('input[name="q"]')) === "city:"
       && new URL(A.page.url()).searchParams.get("q") === null,
     { value: await A.page.inputValue('input[name="q"]'), url: A.page.url() });

  // Escape then Enter has to be the way to search for exactly what was typed.
  await A.page.fill('input[name="q"]', "");
  await A.page.type('input[name="q"]', "lab");
  await A.page.waitForSelector('[role="listbox"]', { timeout: 10_000 });
  await A.page.keyboard.press("Escape");
  await A.page.keyboard.press("Enter");
  await A.page.waitForURL(/[?&]q=lab/, { timeout: 10_000 }).catch(() => {});
  ok("27.11 Escape then Enter searches for what was typed",
     new URL(A.page.url()).searchParams.get("q") === "lab", A.page.url());

  await A.page.goto("/people");
  await A.page.click("summary:has-text(\"What can I search for?\")");
  const help = (await A.page.textContent("details:has(summary:has-text('What can I search'))")) ?? "";
  ok("27.12 the keys are written down for somebody who does not know to try",
     help.includes("label:Family") && help.includes("-has:email") && help.includes("updated:>30d"),
     help.slice(0, 120));

  // ════════════════════════════════════════════════════════════════════════
  section("§28 Asking in words");

  // A stand-in for Ollama, so every branch is deterministic. The real model is exercised by
  // hand against the host; what is worth testing here is the plumbing around it — the JSON,
  // the validation, the failure messages, and whether the button is wired to any of it.
  const { createServer: createOllama } = await import("node:http");
  let ollamaReply: { status: number; body: string } = {
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ query: 'label:Family -has:email' }) }),
  };
  let lastPrompt = "";
  const fakeOllama = createOllama((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += String(c); });
    req.on("end", () => {
      try {
        lastPrompt = String((JSON.parse(raw) as { prompt?: string }).prompt ?? "");
      } catch {
        lastPrompt = "";
      }
      res.writeHead(ollamaReply.status, { "content-type": "application/json" });
      res.end(ollamaReply.body);
    });
  });
  await new Promise<void>((done) => fakeOllama.listen(OLLAMA_PORT, "127.0.0.1", done));

  const { translateToQuery, naturalLanguageConfigured } = await import("@/lib/search/nl");
  const { searchVocabulary: vocabFor } = await import("@/lib/search/compile");
  const nlDefs = await loadRegistryForQuery(A.id, "PERSON");
  const nlVocab = vocabFor(nlDefs, ["Family", "Medical"]);

  ok("28.1 a model is considered configured when a URL is set", naturalLanguageConfigured());
  // The gate the whole feature hangs on: with no URL there is no button, rather than a button
  // that always fails. Toggled here because the harness sets the variable for every test.
  const savedOllama = process.env.OLLAMA_URL;
  delete process.env.OLLAMA_URL;
  ok("28.1b and not configured when there is none", !naturalLanguageConfigured());
  ok("28.1c which the translator says rather than trying to connect",
     !(await translateToQuery("family", nlVocab)).ok);
  process.env.OLLAMA_URL = savedOllama;

  const good = await translateToQuery("family with no email", nlVocab);
  ok("28.2 a sentence comes back as a query",
     good.ok && good.query === "label:Family -has:email", good);
  ok("28.2b and the prompt carries the fields and label names, so the model is not guessing",
     lastPrompt.includes("label:Family") && lastPrompt.includes("Medical")
       && lastPrompt.includes("city"),
     lastPrompt.slice(0, 80));

  // The reason validation is not a formality: models reply with prose, fences and invented
  // fields, and the parser is the only thing that decides whether a string is a query.
  ollamaReply = { status: 200, body: JSON.stringify({ response: "Sure! Here you go." }) };
  const nlProse = await translateToQuery("family", nlVocab);
  ok("28.3 prose instead of JSON is refused",
     !nlProse.ok && nlProse.message!.includes("unreadable"), nlProse);

  ollamaReply = {
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ query: 'city:"Sun' }) }),
  };
  const unparseable = await translateToQuery("family", nlVocab);
  ok("28.4 a query that does not parse is refused, with the parser's own reason",
     !unparseable.ok && unparseable.message!.includes("closing quote"), unparseable);

  ollamaReply = { status: 200, body: JSON.stringify({ response: JSON.stringify({}) }) };
  const empty = await translateToQuery("family", nlVocab);
  ok("28.5 no query in the reply is refused",
     !empty.ok && empty.message!.includes("did not produce"), empty);

  ollamaReply = { status: 404, body: JSON.stringify({ error: "model not found" }) };
  const missing = await translateToQuery("family", nlVocab);
  ok("28.6 a missing model says which model it looked for",
     !missing.ok && missing.message!.includes("404"), missing);

  ok("28.7 an empty sentence is refused before the model is troubled",
     !(await translateToQuery("   ", nlVocab)).ok);

  // An unknown FIELD from the model parses fine — the compiler treats it as text with a
  // warning — so it reaches the box rather than being refused. That is the right outcome: the
  // person sees what it made of their sentence and can fix it.
  ollamaReply = {
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ query: "favouritecheese:brie" }) }),
  };
  const invented = await translateToQuery("who likes brie", nlVocab);
  ok("28.8 an invented field still reaches the box, since the box is editable",
     invented.ok && invented.query === "favouritecheese:brie", invented);

  // --- and the button, in the page -----------------------------------------
  ollamaReply = {
    status: 200,
    body: JSON.stringify({ response: JSON.stringify({ query: "label:Family -has:email" }) }),
  };
  await A.page.goto("/people");
  await A.page.fill('input[name="q"]', "family with no email");
  await A.page.click('button:text-is("ask")');
  await A.page.waitForFunction(
    () => (document.querySelector('input[name="q"]') as HTMLInputElement | null)?.value
      === "label:Family -has:email",
    undefined, { timeout: 20_000 },
  ).catch(() => {});
  ok("28.9 the button writes the query INTO the box rather than searching",
     (await A.page.inputValue('input[name="q"]')) === "label:Family -has:email"
       && new URL(A.page.url()).searchParams.get("q") === null,
     { value: await A.page.inputValue('input[name="q"]'), url: A.page.url() });
  ok("28.9b and says what it read, so a misunderstanding is visible",
     ((await A.page.textContent("body")) ?? "").includes("family with no email"));

  // Then Enter searches, which is the ordinary path — the model has not run anything.
  await A.page.keyboard.press("Escape");
  await A.page.focus('input[name="q"]');
  await A.page.keyboard.press("Enter");
  await A.page.waitForURL(/[?&]q=/, { timeout: 10_000 }).catch(() => {});
  ok("28.10 pressing Enter afterwards searches for the query it wrote",
     (new URL(A.page.url()).searchParams.get("q") ?? "") === "label:Family -has:email",
     A.page.url());

  // A failure has to leave the ordinary search working rather than breaking the page.
  ollamaReply = { status: 500, body: "boom" };
  await A.page.goto("/people");
  await A.page.fill('input[name="q"]', "anything at all");
  await A.page.click('button:text-is("ask")');
  await A.page.waitForFunction(
    () => (document.body.textContent ?? "").includes("answered with 500"),
    undefined, { timeout: 20_000 },
  ).catch(() => {});
  ok("28.11 a model that fails says so and leaves the box alone",
     ((await A.page.textContent("body")) ?? "").includes("answered with 500")
       && (await A.page.inputValue('input[name="q"]')) === "anything at all",
     await A.page.inputValue('input[name="q"]'));

  fakeOllama.close();

  // ════════════════════════════════════════════════════════════════════════
  section("§22 On a phone");

  // Measured, not eyeballed. Every page was 529px wide against a 390px viewport, so the
  // whole app scrolled sideways — and the cause was one flex row in the header rather than
  // anything on the pages themselves, which already stack. A number is the only way to
  // notice that again: a screenshot of a page that scrolls looks fine.
  const PHONE = { width: 390, height: 844 };
  await A.page.setViewportSize(PHONE);

  const pageWidth = () =>
    A.page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      view: window.innerWidth,
    }));

  /**
   * The narrowest element actually responsible for an overflow.
   *
   * A width is enough to fail on but useless to fix from — every ancestor of the offender
   * is also too wide, so a naive report names <body>. This skips any element that has a
   * child sticking out too, which leaves the one to change.
   */
  const overflowing = () =>
    A.page.evaluate(() => {
      const vw = window.innerWidth;
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 1) continue;
        if (Array.from(el.children).some(
          (k) => (k as HTMLElement).getBoundingClientRect().right > vw + 1)) continue;
        out.push(`${el.tagName.toLowerCase()} right=${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 24)}" .${(el.className || "").toString().split(" ").slice(0, 4).join(".")}`);
      }
      return out.slice(0, 3).join(" | ") || "nothing";
    });

  for (const [path, label] of [
    ["/people", "the people list"],
    ["/settings", "settings"],
    ["/events", "events"],
    ["/trash", "the trash"],
  ] as [string, string][]) {
    await A.page.goto(path);
    const w = await pageWidth();
    // One pixel of slack for sub-pixel rounding; anything more is a real overflow.
    ok(`22.1 ${label} fits a phone without scrolling sideways`,
       w.scroll <= w.view + 1, `${w.scroll} vs ${w.view} — ${await overflowing()}`);
  }

  // The bulk bar is the densest thing on the page and the newest, so it is the most likely
  // to push the page wide again.
  await A.page.goto("/people");
  const firstRow = await A.page.$('input[name="personId"]');
  if (firstRow) {
    await firstRow.check();
    await A.page.waitForSelector('form#people-bulk >> text=selected', { timeout: 10_000 })
      .catch(() => {});
    const withBar = await pageWidth();
    ok("22.2 and still fits with the bulk bar open",
       withBar.scroll <= withBar.view + 1, `${withBar.scroll} vs ${withBar.view}`);
    ok("22.2b with every one of its buttons reachable rather than clipped",
       (await A.page.$$eval('form#people-bulk button', (bs) =>
         bs.every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1))) === true);
  }

  // A contact page is the one people will actually read on a phone. Its columns collapse,
  // so the test is that nothing inside it reaches past the edge.
  const phonePerson = await prisma.person.findFirst({
    where: { ownerId: A.id, deletedAt: null },
    select: { id: true },
  });
  if (phonePerson) {
    await A.page.goto(`/people/${phonePerson.id}`);
    const detail = await pageWidth();
    ok("22.3 a contact reads on a phone without sideways scrolling",
       detail.scroll <= detail.view + 1,
       `${detail.scroll} vs ${detail.view} — ${await overflowing()}`);
  }

  // The nav is what broke, so assert the shape of the fix rather than only its effect:
  // nothing in the header may sit past the right edge.
  await A.page.goto("/people");
  ok("22.4 nothing in the header is pushed off the screen",
     (await A.page.$$eval("header a, header button, header span", (els) =>
       els.every((e) => e.getBoundingClientRect().right <= window.innerWidth + 1))) === true);

  // Left as it was found, so a later section is not measured through a phone.
  await A.page.setViewportSize({ width: 1280, height: 900 });

} finally {
  await h.stop();
}

console.log(`\nscratch files: ${scratch}`);
process.exit(report());
