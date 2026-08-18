import type { ContactPoint, Person } from "@prisma/client";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import type { FieldDef } from "@/lib/fields/types";
import type { GooglePerson } from "./people-client";
import { noMappings, type ResolvedMappings } from "./mappings";

/**
 * Turn a Hearth person into a Google People API resource.
 *
 * Pure on purpose: no database, no network, no clock. It is the piece most likely
 * to be wrong in a way that quietly corrupts someone's address book, so it needs
 * to be exhaustively testable without credentials.
 */

/** Custom field Google shows on the contact, linking it back to Hearth. */
export const HEARTH_ID_KEY = "hearth_id";

/**
 * The field groups Hearth owns.
 *
 * This list is passed to Google as `updatePersonFields` on every update, which
 * means Google replaces each group with exactly what we send. Sending the full
 * list — rather than only the groups that happen to be populated — is what makes
 * clearing a field locally also clear it in Google. The cost is that anything
 * edited directly in Google inside these groups is overwritten on the next push,
 * which is precisely the "Hearth is the source of truth" contract.
 */
export const MANAGED_PERSON_FIELDS = [
  "names",
  "nicknames",
  "organizations",
  "birthdays",
  "biographies",
  "emailAddresses",
  "phoneNumbers",
  "addresses",
  "urls",
  "occupations",
  "userDefined",
  // Hearth models these now, so it owns them. Until it did, they were safe from it
  // precisely because they were absent from this list — which is the trade: preserving
  // a structured relation or anniversary means being able to write one.
  "imClients",
  "sipAddresses",
  "calendarUrls",
  "externalIds",
  "miscKeywords",
  "interests",
  "skills",
  "locations",
  "events",
  "relations",
  "genders",
] as const;

export interface PersonGoogleEventRow {
  label: string | null;
  year: number | null;
  month: number;
  day: number;
}

export interface PersonGoogleRelationRow {
  name: string;
  label: string | null;
}

export type PersonWithContacts = Person & {
  contactPoints: ContactPoint[];
  /** Optional so existing callers need not change; absent means "send none". */
  googleEvents?: PersonGoogleEventRow[];
  googleRelations?: PersonGoogleRelationRow[];
};

export interface SerializeOptions {
  /** Registry entries for user-defined fields. */
  customFields?: readonly FieldDef[];
  /** Per-field destinations; defaults to core-only with nothing custom synced. */
  mappings?: ResolvedMappings;
}

function clean(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : undefined;
}

/** Google's `type` is free text; a null label just means "no type given". */
function typeOf(cp: ContactPoint): string | undefined {
  return clean(cp.label);
}

function sortPoints(points: readonly ContactPoint[]): ContactPoint[] {
  // Primary first, then declared order — Google treats the first entry of each
  // group as the primary one.
  return [...points].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.order - b.order,
  );
}

export function serializePerson(
  person: PersonWithContacts,
  options: SerializeOptions = {},
): { person: GooglePerson; updateFields: string[] } {
  const mappings = options.mappings ?? noMappings();
  const points = sortPoints(person.contactPoints);
  const byKind = (kind: ContactPoint["kind"]) => points.filter((p) => p.kind === kind);
  const core = (key: string) => mappings.coreEnabled(key);

  const given = clean(person.givenName);
  const family = clean(person.familyName);

  // Every part Google keeps, not merely the two Hearth used to store.
  //
  // This group is replaced wholesale on each push, so a part left out here is a part
  // deleted from the contact — which is exactly what used to happen to middle names and
  // phonetic readings on the first sync after an import.
  const nameParts = {
    givenName: given,
    middleName: clean(person.middleName),
    familyName: family,
    honorificPrefix: clean(person.honorificPrefix),
    honorificSuffix: clean(person.honorificSuffix),
    phoneticGivenName: clean(person.phoneticGivenName),
    phoneticMiddleName: clean(person.phoneticMiddleName),
    phoneticFamilyName: clean(person.phoneticFamilyName),
  };

  // Google renders a contact with no name at all as a blank row, so fall back to
  // the display name Hearth already computes (which itself falls back to
  // nickname, then organisation). Names are never disableable.
  const names: GooglePerson["names"] =
    given || family
      ? [nameParts]
      : [{ ...nameParts, givenName: clean(person.displayName) ?? "Unnamed contact" }];

  // --- accumulators for mapped custom fields ---------------------------
  //
  // Every target is append-only, so these only ever grow. No mapped value can
  // displace something a core field owns, which is why the mapping page needs no
  // precedence rules.
  const userDefined: NonNullable<GooglePerson["userDefined"]> = [
    { key: HEARTH_ID_KEY, value: person.id },
  ];
  const extraNicknames: string[] = [];
  const extraOccupations: string[] = [];
  const extraUrls: Array<{ value: string; type?: string }> = [];
  const extraEmails: Array<{ value: string; type?: string }> = [];
  const extraPhones: Array<{ value: string; type?: string }> = [];
  const extraAddresses: Array<{ formattedValue: string; type?: string }> = [];
  const noteLines: string[] = [];

  // Social handles have no home in the People API schema — they are not URLs and
  // there is no "social" group — so they become custom fields rather than being
  // silently dropped.
  for (const cp of byKind("SOCIAL")) {
    const value = clean(cp.value);
    if (value) userDefined.push({ key: typeOf(cp) ?? "social", value });
  }

  for (const def of options.customFields ?? []) {
    const mapping = mappings.customTarget(def.key);
    if (!mapping) continue;

    const text = formatFieldValue(def, readFieldValue(person, def));
    if (!text) continue;

    const label = def.label || def.key;
    const key = clean(mapping.targetKey) ?? label;

    switch (mapping.target) {
      case "userDefined":
        userDefined.push({ key, value: text });
        break;
      case "biographies":
        noteLines.push(`${label}: ${text}`);
        break;
      case "nicknames":
        extraNicknames.push(text);
        break;
      case "occupations":
        extraOccupations.push(text);
        break;
      case "urls":
        extraUrls.push({ value: text, type: label });
        break;
      case "emailAddresses":
        extraEmails.push({ value: text, type: label });
        break;
      case "phoneNumbers":
        extraPhones.push({ value: text, type: label });
        break;
      case "addresses":
        extraAddresses.push({ formattedValue: text, type: label });
        break;
      default:
        break;
    }
  }

  const orgDetail = {
    department: clean(person.orgDepartment),
    jobDescription: clean(person.orgJobDescription),
    symbol: clean(person.orgSymbol),
    domain: clean(person.orgDomain),
    location: clean(person.orgLocation),
    phoneticName: clean(person.orgPhoneticName),
    type: clean(person.orgType),
  };

  const nickname = core("nickname") ? clean(person.nickname) : undefined;
  const organization = core("organization") ? clean(person.organization) : undefined;
  const jobTitle = core("jobTitle") ? clean(person.jobTitle) : undefined;
  const notes = core("notes") ? clean(person.notes) : undefined;
  const birthday = core("birthday") ? person.birthday : null;

  // One biographies entry rather than several: Google's UI surfaces a single notes
  // block, so extra array members would be written but never seen.
  const biography = [notes, ...noteLines].filter(Boolean).join("\n");

  // Plain value-and-type lists. Each ContactKind maps to one Google group, and the
  // mapping lives here rather than in a switch at every call site.
  const valueList = (kind: ContactPoint["kind"]) =>
    byKind(kind)
      .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.value !== undefined);

  const google: GooglePerson = {
    names,
    nicknames: [
      ...(nickname ? [{ value: nickname }] : []),
      ...extraNicknames.map((value) => ({ value })),
    ],
    // Same reasoning as names: the group is replaced, so everything Hearth knows about
    // the organisation has to travel with it or be lost.
    organizations:
      organization || jobTitle || orgDetail.department || orgDetail.jobDescription
        ? [{ name: organization, title: jobTitle, ...orgDetail }]
        : [],
    // @db.Date columns come back as an instant at UTC midnight, so the components
    // must be read in UTC or the date shifts a day west of Greenwich.
    // A dated birthday, or the prose form for one Google holds without a year — which
    // a @db.Date column cannot express and the import used to report as unstorable.
    birthdays: birthday
      ? [
          {
            date: {
              year: birthday.getUTCFullYear(),
              month: birthday.getUTCMonth() + 1,
              day: birthday.getUTCDate(),
            },
          },
        ]
      : clean(person.birthdayText)
        ? [{ text: clean(person.birthdayText) }]
        : [],
    biographies: biography ? [{ value: biography, contentType: "TEXT_PLAIN" }] : [],
    emailAddresses: [
      ...byKind("EMAIL")
        .map((cp) => ({
          value: clean(cp.value),
          type: typeOf(cp),
          displayName: clean(cp.displayName),
        }))
        .filter((e) => e.value !== undefined),
      ...extraEmails,
    ],
    phoneNumbers: [
      ...byKind("PHONE")
        .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
        .filter((e) => e.value !== undefined),
      ...extraPhones,
    ],
    // Both the line and the parts. Google builds formattedValue from the parts when it
    // is absent, so sending only the line — which is what Hearth used to do — replaced a
    // structured address with a flat one on every push.
    imClients: byKind("IM")
      .map((cp) => ({
        username: clean(cp.value),
        protocol: clean(cp.protocol),
        type: typeOf(cp),
      }))
      .filter((e) => e.username !== undefined),
    sipAddresses: valueList("SIP"),
    calendarUrls: byKind("CALENDAR")
      .map((cp) => ({ url: clean(cp.value), type: typeOf(cp) }))
      .filter((e) => e.url !== undefined),
    externalIds: valueList("EXTERNAL_ID"),
    miscKeywords: valueList("KEYWORD"),
    interests: byKind("INTEREST")
      .map((cp) => ({ value: clean(cp.value) }))
      .filter((e) => e.value !== undefined),
    skills: byKind("SKILL")
      .map((cp) => ({ value: clean(cp.value) }))
      .filter((e) => e.value !== undefined),
    locations: byKind("LOCATION")
      .map((cp) => ({
        value: clean(cp.value),
        type: typeOf(cp),
        buildingId: clean(cp.buildingId),
        floor: clean(cp.floor),
        floorSection: clean(cp.floorSection),
        deskCode: clean(cp.deskCode),
        current: cp.current ?? undefined,
      }))
      .filter((e) => e.value !== undefined),
    // A Google relation is a NAME as free text, not a link to another contact — see the
    // note on PersonGoogleRelation for why Hearth's own relationships stay separate.
    relations: (person.googleRelations ?? []).map((r) => ({
      person: r.name,
      type: clean(r.label),
    })),
    events: (person.googleEvents ?? []).map((e) => ({
      date: { year: e.year ?? undefined, month: e.month, day: e.day },
      type: clean(e.label),
    })),
    genders: clean(person.gender) ? [{ value: clean(person.gender) }] : [],
    addresses: [
      ...byKind("ADDRESS")
        .map((cp) => ({
          formattedValue: clean(cp.value),
          type: typeOf(cp),
          poBox: clean(cp.poBox),
          streetAddress: clean(cp.streetAddress),
          extendedAddress: clean(cp.extendedAddress),
          city: clean(cp.city),
          region: clean(cp.region),
          postalCode: clean(cp.postalCode),
          country: clean(cp.country),
          countryCode: clean(cp.countryCode),
        }))
        .filter((e) => e.formattedValue !== undefined),
      ...extraAddresses,
    ],
    urls: [
      ...byKind("URL")
        .map((cp) => ({ value: clean(cp.value), type: typeOf(cp) }))
        .filter((e) => e.value !== undefined),
      ...extraUrls,
    ],
    occupations: extraOccupations.map((value) => ({ value })),
    userDefined,
  };

  return { person: google, updateFields: [...MANAGED_PERSON_FIELDS] };
}

/** Read Hearth's id back off a Google contact, for reconciliation. */
export function hearthIdOf(person: GooglePerson): string | null {
  const match = person.userDefined?.find((u) => u.key === HEARTH_ID_KEY);
  return match?.value ?? null;
}
