import type { Event, FieldEntity, Person } from "@prisma/client";
import type { FieldDef } from "./types";

/**
 * The column names each core field writes to, as literal types.
 *
 * The two `satisfies` clauses below are the safety net for the whole registry:
 * because core fields are written to Prisma via a dynamic spread (the field list
 * is data, so column names cannot be statically known at the call site), a typo
 * here would otherwise surface as an opaque runtime Prisma error. Declaring the
 * keys as a tuple and checking it against `keyof Person` / `keyof Event` turns
 * that into a compile error instead — rename a column in schema.prisma without
 * updating this file and the build fails.
 */
const PERSON_CORE_KEYS = [
  "givenName",
  "middleName",
  "familyName",
  "honorificPrefix",
  "honorificSuffix",
  "phoneticGivenName",
  "phoneticMiddleName",
  "phoneticFamilyName",
  "nickname",
  "organization",
  "jobTitle",
  "orgDepartment",
  "orgJobDescription",
  "orgSymbol",
  "orgDomain",
  "orgLocation",
  "orgPhoneticName",
  "orgType",
  "birthday",
  "notes",
] as const satisfies readonly (keyof Person)[];

const EVENT_CORE_KEYS = [
  "title",
  "startAt",
  "endAt",
  "allDay",
  "timeZone",
  "location",
  "description",
] as const satisfies readonly (keyof Event)[];

export type PersonCoreKey = (typeof PERSON_CORE_KEYS)[number];
export type EventCoreKey = (typeof EVENT_CORE_KEYS)[number];

/**
 * Core (built-in) field declarations.
 *
 * These are the counterpart to the real columns in prisma/schema.prisma. They
 * live in code rather than in FieldDefinition rows because their existence and
 * storage location are fixed by the database schema — a user cannot delete
 * `givenName` without a migration, so it must not be represented as deletable
 * data. Everything else about them (appearing in forms, in list views, in the
 * Google field-mapping table) works exactly like a user-defined field, because
 * loadRegistry() merges both kinds into one list of FieldDef.
 *
 * IMPORTANT: `key` must match the Prisma column name exactly.
 */

type CoreFieldSpec<K extends string> = Omit<
  FieldDef,
  "key" | "storage" | "core" | "definitionId" | "generic" | "archived"
> & { key: K; generic?: boolean };

function coreField<K extends string>(spec: CoreFieldSpec<K>): FieldDef {
  const { generic, ...rest } = spec;
  return {
    ...rest,
    storage: "column",
    core: true,
    definitionId: null,
    archived: false,
    generic: generic ?? true,
  };
}

/** Constrained constructors: `key` must name a real column on the model. */
const personField = (spec: CoreFieldSpec<PersonCoreKey>): FieldDef => coreField(spec);
const eventField = (spec: CoreFieldSpec<EventCoreKey>): FieldDef => coreField(spec);

export const CORE_PERSON_FIELDS: readonly FieldDef[] = [
  personField({
    key: "givenName",
    label: "First name",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: true,
    order: 10,
  }),
  personField({
    key: "middleName",
    label: "Middle name",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 15,
  }),
  personField({
    key: "familyName",
    label: "Last name",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: true,
    order: 20,
  }),
  personField({
    key: "honorificPrefix",
    label: "Title",
    type: "TEXT",
    options: [],
    required: false,
    helpText: "Dr, Ms, and the like.",
    showInList: false,
    order: 22,
  }),
  personField({
    key: "honorificSuffix",
    label: "Suffix",
    type: "TEXT",
    options: [],
    required: false,
    helpText: "Jr, PhD, and the like.",
    showInList: false,
    order: 24,
  }),
  personField({
    key: "phoneticGivenName",
    label: "First name (phonetic)",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 26,
  }),
  personField({
    key: "phoneticMiddleName",
    label: "Middle name (phonetic)",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 27,
  }),
  personField({
    key: "phoneticFamilyName",
    label: "Last name (phonetic)",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 28,
  }),
  personField({
    key: "nickname",
    label: "Nickname",
    type: "TEXT",
    options: [],
    required: false,
    helpText: "What you actually call them.",
    showInList: false,
    order: 30,
  }),
  personField({
    key: "organization",
    label: "Organisation",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: true,
    order: 40,
  }),
  personField({
    key: "jobTitle",
    label: "Job title",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 50,
  }),
  personField({
    key: "orgDepartment",
    label: "Department",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 52,
  }),
  personField({
    key: "orgJobDescription",
    label: "Job description",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 54,
  }),
  personField({
    key: "orgLocation",
    label: "Office",
    type: "TEXT",
    options: [],
    required: false,
    helpText: "Where they work, as Google records it on the organisation.",
    showInList: false,
    order: 56,
  }),
  personField({
    key: "orgType",
    label: "Organisation type",
    type: "TEXT",
    options: [],
    required: false,
    helpText: "Google's own label for it — work, school, and so on.",
    showInList: false,
    order: 57,
  }),
  personField({
    key: "orgSymbol",
    label: "Ticker symbol",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 58,
  }),
  personField({
    key: "orgDomain",
    label: "Organisation domain",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 59,
  }),
  personField({
    key: "orgPhoneticName",
    label: "Organisation (phonetic)",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 60,
  }),
  personField({
    key: "birthday",
    label: "Birthday",
    type: "DATE",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 60,
  }),
  personField({
    key: "notes",
    label: "Notes",
    type: "LONGTEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 900,
  }),
];

export const CORE_EVENT_FIELDS: readonly FieldDef[] = [
  eventField({
    key: "title",
    label: "Title",
    type: "TEXT",
    options: [],
    required: true,
    helpText: null,
    showInList: true,
    order: 10,
  }),
  // The four scheduling fields are validated through the registry but rendered
  // together by the ScheduleFields component, which needs to know about the
  // all-day/timezone interaction that a generic input cannot express.
  eventField({
    key: "startAt",
    label: "Starts",
    type: "DATETIME",
    options: [],
    required: true,
    helpText: null,
    showInList: true,
    order: 20,
    generic: false,
  }),
  eventField({
    key: "endAt",
    label: "Ends",
    type: "DATETIME",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 30,
    generic: false,
  }),
  eventField({
    key: "allDay",
    label: "All day",
    type: "BOOLEAN",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 40,
    generic: false,
  }),
  eventField({
    key: "timeZone",
    label: "Time zone",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 50,
    generic: false,
  }),
  eventField({
    key: "location",
    label: "Location",
    type: "TEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: true,
    order: 60,
  }),
  eventField({
    key: "description",
    label: "Description",
    type: "LONGTEXT",
    options: [],
    required: false,
    helpText: null,
    showInList: false,
    order: 900,
  }),
];

export function coreFields(entity: FieldEntity): readonly FieldDef[] {
  return entity === "PERSON" ? CORE_PERSON_FIELDS : CORE_EVENT_FIELDS;
}

/** Keys a user-defined field may not claim, since they collide with columns. */
export function reservedFieldKeys(entity: FieldEntity): Set<string> {
  const keys = coreFields(entity).map((f) => f.key.toLowerCase());
  // Also block the sync/bookkeeping columns so a custom key can never shadow one.
  return new Set([
    ...keys,
    "id",
    "ownerid",
    "custom",
    "displayname",
    "createdat",
    "updatedat",
    "addtogoogle",
    "googleresourcename",
    "googleeventid",
    "googlecalendarid",
    "googleetag",
    "googlesynctoken",
    "googlesyncedat",
    "googlesyncstatus",
    "googlesyncerror",
  ]);
}
