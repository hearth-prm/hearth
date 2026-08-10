import type { FieldEntity, FieldType } from "@prisma/client";

/**
 * Where a Hearth field may be written in Google.
 *
 * Every target other than "none" is **append-only**: it adds an entry to a Google
 * list, or a custom field, or a line of text. None of them overwrite a value a core
 * field already owns.
 *
 * That is a deliberate restriction rather than an oversight. Google's
 * `organizations` and `birthdays` are effectively single-valued, so offering them
 * would raise a precedence question — does a mapped custom field beat the core
 * `organization` column, or fill in only when it is blank? Every answer is
 * surprising to somebody. Excluding them means the mapping page needs no rules at
 * all: a mapped field adds, it never replaces. `occupations` is offered precisely
 * because Hearth has no core field using it, so it is a free slot.
 */

export const NO_TARGET = "none";

export interface MappingTarget {
  id: string;
  label: string;
  description: string;
  /** Targets needing a Google-side name, e.g. a custom field's key. */
  needsKey?: boolean;
  /** Field types this target accepts; omitted means any. */
  accepts?: FieldType[];
}

const PERSON_TARGETS: MappingTarget[] = [
  {
    id: NO_TARGET,
    label: "Not synced",
    description: "Stays in Hearth. This is the default for a new field.",
  },
  {
    id: "userDefined",
    label: "Custom field",
    description:
      "A Google custom field, shown on the contact under the name you give it.",
    needsKey: true,
  },
  {
    id: "biographies",
    label: "Notes",
    description:
      "Appended to the contact's notes as “Label: value”, after any Hearth notes.",
  },
  {
    id: "nicknames",
    label: "Nickname",
    description: "Added as an extra nickname.",
  },
  {
    id: "occupations",
    label: "Occupation",
    description:
      "Google's occupation list, which Hearth does not otherwise use — so nothing competes for it.",
  },
  {
    id: "urls",
    label: "Website",
    description: "Added to the contact's links.",
    accepts: ["URL", "TEXT"],
  },
  {
    id: "emailAddresses",
    label: "Email address",
    description: "Added to the contact's emails, after the ones Hearth manages.",
    accepts: ["EMAIL", "TEXT"],
  },
  {
    id: "phoneNumbers",
    label: "Phone number",
    description: "Added to the contact's phone numbers.",
    accepts: ["PHONE", "TEXT"],
  },
  {
    id: "addresses",
    label: "Address",
    description: "Added to the contact's addresses.",
  },
];

const EVENT_TARGETS: MappingTarget[] = [
  {
    id: NO_TARGET,
    label: "Not synced",
    description: "Stays in Hearth. This is the default for a new field.",
  },
  {
    id: "extendedProperty",
    label: "Hidden metadata",
    description:
      "A private property on the Google event: readable by you through the API, never shown to guests.",
    needsKey: true,
  },
  {
    id: "description",
    label: "Description",
    description:
      "Appended to the event description as “Label: value”. Visible to guests.",
  },
];

export function targetsFor(entity: FieldEntity): MappingTarget[] {
  return entity === "PERSON" ? PERSON_TARGETS : EVENT_TARGETS;
}

export function findTarget(
  entity: FieldEntity,
  id: string,
): MappingTarget | undefined {
  return targetsFor(entity).find((t) => t.id === id);
}

/** Targets a field of this type may legally use. */
export function targetsForType(
  entity: FieldEntity,
  type: FieldType,
): MappingTarget[] {
  return targetsFor(entity).filter((t) => !t.accepts || t.accepts.includes(type));
}

export function isValidTarget(
  entity: FieldEntity,
  id: string,
  type: FieldType,
): boolean {
  return targetsForType(entity, type).some((t) => t.id === id);
}

/**
 * Core fields that may be switched off.
 *
 * Only ever off — never re-pointed. `givenName -> names.givenName` is structural,
 * and a contact with no name is not a thing anyone wants; but notes in particular
 * are often something people would rather not copy into Google, so being able to
 * exclude one matters.
 */
const DISABLEABLE_CORE: Record<FieldEntity, string[]> = {
  PERSON: ["nickname", "organization", "jobTitle", "birthday", "notes"],
  EVENT: ["description", "location"],
};

export function coreFieldCanBeDisabled(
  entity: FieldEntity,
  fieldKey: string,
): boolean {
  return DISABLEABLE_CORE[entity].includes(fieldKey);
}

/** Human description of where a core field goes, for the read-only rows. */
export const CORE_DESTINATIONS: Record<string, string> = {
  givenName: "First name",
  familyName: "Last name",
  nickname: "Nickname",
  organization: "Organisation",
  jobTitle: "Job title",
  birthday: "Birthday",
  notes: "Notes",
  title: "Event title",
  startAt: "Start",
  endAt: "End",
  allDay: "All-day flag",
  timeZone: "Time zone",
  location: "Location",
  description: "Description",
};
