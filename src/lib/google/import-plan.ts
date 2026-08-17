import type { ContactKind } from "@prisma/client";
import type { GooglePerson } from "./people-client";
import { HEARTH_ID_KEY } from "./serialize-person";

/**
 * Plan an import of existing Google contacts.
 *
 * Pure on purpose — no database, no network, no clock — for the same reason
 * serialize-person.ts is: it decides what happens to somebody's real address book, and
 * that decision has to be testable without credentials.
 *
 * The contacts are left where they are. Hearth adds a hearth_id user-defined field to
 * each one and remembers its resourceName, which is all a link needs; nothing has to be
 * re-created, and everything already on the Google contact stays on it.
 *
 * The hazard is not the import but the first push afterwards. Hearth sends
 * MANAGED_PERSON_FIELDS as updatePersonFields on every update, and Google replaces each
 * listed group wholesale — so anything inside those groups that Hearth failed to take a
 * copy of is deleted from Google by the very next sync. Everything OUTSIDE that mask
 * (relations, events, IM handles, external ids, interests, skills, memberships) is never
 * touched and needs no rescuing.
 *
 * So this planner's real job is to find the data that lives inside a managed group and
 * has nowhere to sit in Hearth, and route it to a custom field so it survives the round
 * trip. What it cannot do is put it back in its original home: a middle name preserved
 * this way reappears in Google as a custom field, because serializePerson sends only
 * givenName and familyName. Each such case is reported so it is a decision rather than a
 * surprise.
 */

/** What to ask Google for. Broad on purpose: unread data cannot be preserved. */
export const GOOGLE_IMPORT_FIELDS = [
  "metadata",
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
  "memberships",
] as const;

export interface PlannedContactPoint {
  kind: ContactKind;
  value: string;
  label: string | null;
  isPrimary: boolean;
  order: number;
}

/** Something in a managed group with no Hearth column; kept as a custom field. */
export interface RescuedValue {
  /** Field key Hearth will create or reuse. */
  key: string;
  label: string;
  value: string;
  /**
   * Why it needed rescuing, in words a person can act on. Named per contact rather
   * than once at the top, because whether it applies depends on the contact.
   */
  reason: string;
}

export type ContactAction = "import" | "linked" | "skip";

export interface PlannedContact {
  resourceName: string;
  etag: string | null;
  displayName: string;
  action: ContactAction;
  /** Set when the contact already carries a hearth_id. */
  existingHearthId: string | null;
  columns: {
    givenName: string | null;
    middleName: string | null;
    familyName: string | null;
    honorificPrefix: string | null;
    honorificSuffix: string | null;
    phoneticGivenName: string | null;
    phoneticMiddleName: string | null;
    phoneticFamilyName: string | null;
    nickname: string | null;
    organization: string | null;
    jobTitle: string | null;
    orgDepartment: string | null;
    orgJobDescription: string | null;
    orgSymbol: string | null;
    orgDomain: string | null;
    orgLocation: string | null;
    orgPhoneticName: string | null;
    orgType: string | null;
    notes: string | null;
    birthday: string | null;
  };
  contactPoints: PlannedContactPoint[];
  rescued: RescuedValue[];
  /** Google contact-group resource names, for turning memberships into labels. */
  groupIds: string[];
  reasons: string[];
}

export interface GoogleImportPlan {
  contacts: PlannedContact[];
  counts: { import: number; linked: number; skip: number; rescued: number };
  /** Distinct custom fields the import would create. */
  newFieldKeys: string[];
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

/** A stable, readable field key from a human label. */
export function fieldKeyFor(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "imported";
}

/** Google marks one entry per group primary via metadata. */
function isPrimary(entry: { metadata?: { primary?: boolean | null } | null }): boolean {
  return entry.metadata?.primary === true;
}

function pointsOf(
  entries: readonly { value?: string | null; type?: string | null; metadata?: { primary?: boolean | null } | null }[] | undefined,
  kind: ContactKind,
  startOrder: number,
): PlannedContactPoint[] {
  const out: PlannedContactPoint[] = [];
  let order = startOrder;
  for (const entry of entries ?? []) {
    const value = clean(entry.value);
    if (!value) continue;
    out.push({
      kind,
      value,
      label: clean(entry.type),
      isPrimary: isPrimary(entry),
      order: order++,
    });
  }
  return out;
}

/**
 * The one-line address Hearth stores, and the components it cannot.
 *
 * Google will happily hand back both a formattedValue and the pieces it was built from.
 * Hearth keeps the line, since that is what it can send again; the pieces are rescued
 * only when there is no formatted line to fall back on, or when they say something the
 * line does not.
 */
function addressText(address: {
  formattedValue?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string | null {
  const formatted = clean(address.formattedValue);
  if (formatted) return formatted;
  const parts = [
    clean(address.streetAddress),
    clean(address.city),
    clean(address.region),
    clean(address.postalCode),
    clean(address.country),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function planGoogleImport(
  people: readonly GooglePerson[],
  options: {
    /** resourceNames already linked to a Hearth person. */
    linkedResourceNames: ReadonlySet<string>;
  },
): GoogleImportPlan {
  const contacts: PlannedContact[] = [];
  const newFieldKeys = new Set<string>();

  for (const person of people) {
    const resourceName = clean(person.resourceName);
    if (!resourceName) continue;

    const name = person.names?.[0];
    const org = person.organizations?.[0];
    const userDefined = person.userDefined ?? [];
    const existingHearthId =
      clean(userDefined.find((u) => u.key === HEARTH_ID_KEY)?.value) ?? null;

    const givenName = clean(name?.givenName);
    const familyName = clean(name?.familyName);
    // Google's own displayName first; then the parts; then anything that identifies
    // the row at all, so a contact that is only an email address still has a name.
    const displayName =
      clean(person.names?.[0]?.displayName) ??
      clean([givenName, familyName].filter(Boolean).join(" ")) ??
      clean(org?.name) ??
      clean(person.emailAddresses?.[0]?.value) ??
      "Unnamed contact";

    const reasons: string[] = [];
    const rescued: RescuedValue[] = [];
    const rescue = (label: string, value: string | null, reason: string) => {
      if (!value) return;
      const key = fieldKeyFor(label);
      rescued.push({ key, label, value, reason });
      newFieldKeys.add(key);
    };

    // --- data inside a managed group with nowhere to sit ---------------------
    //
    // Name parts and organisation detail used to be rescued into custom fields here.
    // They have columns of their own now, so they keep their shape: a middle name goes
    // back to Google as a middle name rather than reappearing as "Middle name: John" in
    // the custom fields. What remains below is what genuinely has nowhere to sit.
    for (const entry of userDefined) {
      if (entry.key === HEARTH_ID_KEY) continue;
      rescue(
        clean(entry.key) ?? "Custom field",
        clean(entry.value),
        "An existing Google custom field. Hearth replaces the whole custom-field group when it syncs, so this is kept as one of its own.",
      );
    }

    // --- contact points -----------------------------------------------------
    const contactPoints: PlannedContactPoint[] = [
      ...pointsOf(person.emailAddresses, "EMAIL", 0),
      ...pointsOf(person.phoneNumbers, "PHONE", 0),
      ...pointsOf(person.urls, "URL", 0),
    ];

    let addressOrder = 0;
    for (const address of person.addresses ?? []) {
      const text = addressText(address);
      if (!text) continue;
      contactPoints.push({
        kind: "ADDRESS",
        value: text,
        label: clean(address.type),
        isPrimary: isPrimary(address),
        order: addressOrder++,
      });
      // Only worth saying when Google actually held the pieces separately.
      if (clean(address.streetAddress) && clean(address.formattedValue)) {
        reasons.push(
          "Address kept as one line; Hearth has no separate street, city and postcode.",
        );
      }
    }

    if ((person.organizations ?? []).length > 1) {
      reasons.push(
        "Only the first organisation is kept; Hearth stores one per contact and the rest will be dropped on the next sync.",
      );
    }

    const birthdayDate = person.birthdays?.find((b) => b.date)?.date;
    const birthday =
      birthdayDate?.year && birthdayDate.month && birthdayDate.day
        ? `${String(birthdayDate.year).padStart(4, "0")}-${String(birthdayDate.month).padStart(2, "0")}-${String(birthdayDate.day).padStart(2, "0")}`
        : null;
    if (birthdayDate && !birthday) {
      reasons.push("Birthday has no year in Google, which Hearth cannot store.");
    }

    const occupations = (person.occupations ?? [])
      .map((o) => clean(o.value))
      .filter((v): v is string => Boolean(v));

    const action: ContactAction = options.linkedResourceNames.has(resourceName)
      ? "linked"
      : "import";
    if (action === "linked") {
      reasons.push("Already linked to a Hearth contact, so it is left alone.");
    }

    if (rescued.length > 0) {
      reasons.push(
        `${rescued.length} value${rescued.length === 1 ? "" : "s"} kept as custom fields.`,
      );
    }

    contacts.push({
      resourceName,
      etag: clean(person.etag),
      displayName,
      action,
      existingHearthId,
      columns: {
        givenName,
        middleName: clean(name?.middleName),
        familyName,
        honorificPrefix: clean(name?.honorificPrefix),
        honorificSuffix: clean(name?.honorificSuffix),
        phoneticGivenName: clean(name?.phoneticGivenName),
        phoneticMiddleName: clean(name?.phoneticMiddleName),
        phoneticFamilyName: clean(name?.phoneticFamilyName),
        orgDepartment: clean(org?.department),
        orgJobDescription: clean(org?.jobDescription),
        orgSymbol: clean(org?.symbol),
        orgDomain: clean(org?.domain),
        orgLocation: clean(org?.location),
        orgPhoneticName: clean(org?.phoneticName),
        orgType: clean(org?.type),
        nickname: clean(person.nicknames?.[0]?.value),
        organization: clean(org?.name),
        // Google keeps a job title on the organisation and an occupation apart from
        // it; Hearth has one field, so the organisation's title wins and a stray
        // occupation becomes the fallback rather than being dropped.
        jobTitle: clean(org?.title) ?? occupations[0] ?? null,
        notes: clean(person.biographies?.[0]?.value),
        birthday,
      },
      contactPoints,
      rescued,
      groupIds: (person.memberships ?? [])
        .map((m) => clean(m.contactGroupMembership?.contactGroupResourceName))
        .filter((v): v is string => Boolean(v)),
      reasons,
    });
  }

  return {
    contacts,
    counts: {
      import: contacts.filter((c) => c.action === "import").length,
      linked: contacts.filter((c) => c.action === "linked").length,
      skip: contacts.filter((c) => c.action === "skip").length,
      rescued: contacts.reduce((n, c) => n + c.rescued.length, 0),
    },
    newFieldKeys: [...newFieldKeys].sort(),
  };
}
