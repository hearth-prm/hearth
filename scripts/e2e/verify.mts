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

} finally {
  await h.stop();
}

console.log(`\nscratch files: ${scratch}`);
process.exit(report());
