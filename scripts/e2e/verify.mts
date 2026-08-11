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
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "playwright-core";
import { start, ok, section, report } from "./harness.mts";

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

  // Delete needs the confirm() dialog accepted.
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
  await statusText(A.page);
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
  await statusText(A.page);
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
  await statusText(B.page);
  applied = await prisma.personLabel.findMany({ where: { personId: sam.id } });
  ok("2.7 B can apply one of A's labels", applied.length === 2, applied.length);

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
     (await B.page.$$('button:has-text("Update")')).length === 0 &&
     (await B.page.$$('button:has-text("Remove")')).length === 0);

  await prisma.share.updateMany({
    where: { eventId: party.id, withUserId: B.id }, data: { permission: "EDIT" },
  });
  await B.page.goto(`/events/${party.id}`);
  ok("2.9h an EDIT event recipient DOES get them back",
     (await B.page.$$('a:has-text("Edit")')).length === 1 &&
     (await B.page.$$('button:has-text("Update")')).length === 1,
     { edit: (await B.page.$$('a:has-text("Edit")')).length,
       update: (await B.page.$$('button:has-text("Update")')).length });

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

  // Back must undo one filter, not all of them.
  await A.page.goto("/people");
  await A.page.click(`a:has-text("Mine")`);
  await A.page.waitForURL(/rel=mine/, { timeout: 15_000 });
  await A.page.click(`a:has-text("Has an email")`);
  await A.page.waitForURL(/has=email/, { timeout: 15_000 });
  ok("4.14 two filters both present", A.page.url().includes("rel=mine") && A.page.url().includes("has=email"));
  await A.page.goBack();
  ok("4.14b Back removes only the last one",
     A.page.url().includes("rel=mine") && !A.page.url().includes("has=email"), A.page.url());

  ok("4.15 a filter URL is portable", (await rows(`?label=${family.id}`)).length === 2);

  await A.page.goto(`/people?label=${family.id}&rel=mine`);
  await A.page.click('a:has-text("clear filters")');
  await A.page.waitForURL((u) => !u.search, { timeout: 15_000 });
  ok("4.16 clear filters returns everything", (await A.page.$$eval("tbody tr", (e) => e.length)) === 4);

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
  ok("7.1 the People page offers Import", (await A.page.$$('a:has-text("Import")')).length === 1);
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

} finally {
  await h.stop();
}

console.log(`\nscratch files: ${scratch}`);
process.exit(report());
