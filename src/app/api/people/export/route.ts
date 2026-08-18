import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { readCustomBag } from "@/lib/fields/values";
import { parseFilter, peopleWhere, type RawParams } from "@/lib/people-filter";
import { toCsv, UTF8_BOM } from "@/lib/csv";
import {
  CONTACT_KIND_COLUMN,
  COLUMNS,
  formatContactPoints,
  formatCustomValue,
  formatLabelList,
  formatShares,
  headersFor,
  isoDay,
} from "@/lib/contacts-csv";

/**
 * CSV export of contacts.
 *
 * A route handler rather than a server action because the response is a file: an
 * action can only return serialisable data to the client, which would mean building
 * the CSV in the browser from data already fetched once.
 *
 * Honours the same filters as the list page, so "export the Family label" needs no
 * separate selection UI — you filter the list, then export what you are looking at.
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const params: RawParams = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    const existing = params[key];
    if (existing === undefined) params[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else params[key] = [existing, value];
  }

  const filter = parseFilter(params);
  const where = peopleWhere(filter, user.id);

  // The exporter's own registry decides the custom columns. A shared contact's
  // owner may have fields this user does not, and inventing columns for them would
  // produce a file whose headers change depending on which rows came back.
  const defs = await loadRegistry(user.id, "PERSON");
  const customFields = defs.filter((d) => !d.core);

  const people = await prisma.person.findMany({
    where,
    orderBy: { displayName: "asc" },
    include: {
      owner: { select: { email: true, sharesGiven: { where: { scope: "ALL_PEOPLE" }, include: { withUser: { select: { email: true } } } } } },
      contactPoints: { orderBy: [{ kind: "asc" }, { isPrimary: "desc" }, { order: "asc" }] },
      labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
      shares: {
        where: { scope: "PERSON" },
        include: { withUser: { select: { email: true } } },
      },
    },
  });

  const rows = people.map((person) => {
    const bag = readCustomBag(person);
    const byKind = (kind: keyof typeof CONTACT_KIND_COLUMN) =>
      formatContactPoints(person.contactPoints.filter((c) => c.kind === kind));

    const fixed: Record<string, string> = {
      [COLUMNS.id]: person.id,
      [COLUMNS.givenName]: person.givenName ?? "",
      [COLUMNS.middleName]: person.middleName ?? "",
      [COLUMNS.familyName]: person.familyName ?? "",
      [COLUMNS.honorificPrefix]: person.honorificPrefix ?? "",
      [COLUMNS.honorificSuffix]: person.honorificSuffix ?? "",
      [COLUMNS.phoneticGivenName]: person.phoneticGivenName ?? "",
      [COLUMNS.phoneticMiddleName]: person.phoneticMiddleName ?? "",
      [COLUMNS.phoneticFamilyName]: person.phoneticFamilyName ?? "",
      [COLUMNS.nickname]: person.nickname ?? "",
      [COLUMNS.organization]: person.organization ?? "",
      [COLUMNS.jobTitle]: person.jobTitle ?? "",
      [COLUMNS.orgDepartment]: person.orgDepartment ?? "",
      [COLUMNS.orgJobDescription]: person.orgJobDescription ?? "",
      [COLUMNS.orgSymbol]: person.orgSymbol ?? "",
      [COLUMNS.orgDomain]: person.orgDomain ?? "",
      [COLUMNS.orgLocation]: person.orgLocation ?? "",
      [COLUMNS.orgPhoneticName]: person.orgPhoneticName ?? "",
      [COLUMNS.orgType]: person.orgType ?? "",
      [COLUMNS.gender]: person.gender ?? "",
      [COLUMNS.birthday]: person.birthday ? isoDay(person.birthday) : "",
      [COLUMNS.birthdayText]: person.birthdayText ?? "",
      [COLUMNS.notes]: person.notes ?? "",
      [COLUMNS.labels]: formatLabelList(person.labels.map((pl) => pl.label.name)),
      [COLUMNS.emails]: byKind("EMAIL"),
      [COLUMNS.phones]: byKind("PHONE"),
      [COLUMNS.addresses]: byKind("ADDRESS"),
      [COLUMNS.urls]: byKind("URL"),
      [COLUMNS.social]: byKind("SOCIAL"),
      [COLUMNS.im]: byKind("IM"),
      [COLUMNS.sip]: byKind("SIP"),
      [COLUMNS.calendar]: byKind("CALENDAR"),
      [COLUMNS.externalIds]: byKind("EXTERNAL_ID"),
      [COLUMNS.keywords]: byKind("KEYWORD"),
      [COLUMNS.interests]: byKind("INTEREST"),
      [COLUMNS.skills]: byKind("SKILL"),
      [COLUMNS.occupations]: byKind("OCCUPATION"),
      [COLUMNS.locations]: byKind("LOCATION"),
      [COLUMNS.otherNicknames]: byKind("NICKNAME"),
      [COLUMNS.addToGoogle]: person.addToGoogle ? "true" : "false",
      [COLUMNS.owner]: person.owner.email ?? "",
      [COLUMNS.sharedWith]: formatShares(
        person.shares.flatMap((s) =>
          s.withUser.email
            ? [{ email: s.withUser.email, permission: s.permission }]
            : [],
        ),
      ),
      // Not per-record data, but it decides who can see this row — so leaving it out
      // would make the file misreport who has access.
      [COLUMNS.blanketShares]: person.owner.sharesGiven
        .flatMap((s) => (s.withUser.email ? [s.withUser.email] : []))
        .join("; "),
    };

    return [
      ...Object.values(COLUMNS).map((c) => fixed[c] ?? ""),
      ...customFields.map((def) => formatCustomValue(def.type, bag[def.key])),
    ];
  });

  const csv = UTF8_BOM + toCsv(headersFor(customFields), rows);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hearth-contacts-${stamp}.csv"`,
      // A filtered export is a snapshot of live data; caching it would serve a stale
      // file the next time the same filters are used.
      "Cache-Control": "no-store",
    },
  });
}
