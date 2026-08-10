import type { FieldType } from "@prisma/client";

/**
 * Where a field's value physically lives.
 *
 * - `column` — a real Prisma column on Person/Event. Core fields only; fast to
 *   query, sort and constrain, but adding one requires a schema migration.
 * - `custom` — a key inside the entity's `custom` JSONB column. User-defined
 *   fields; added at runtime with no migration.
 */
export type FieldStorage = "column" | "custom";

/**
 * The unified description of a field, whatever its storage. Forms, list views,
 * validation and (from M2) the Google mapping engine all iterate over these
 * and never need to branch on where the value is kept.
 */
export interface FieldDef {
  /** Identifier. For `column` storage this is also the column name. */
  key: string;
  label: string;
  type: FieldType;
  storage: FieldStorage;
  /** Allowed values for SELECT / MULTISELECT; empty otherwise. */
  options: string[];
  required: boolean;
  helpText: string | null;
  /** Render as a column in list views. */
  showInList: boolean;
  order: number;
  /** Built-in field: cannot be deleted, renamed or retyped. */
  core: boolean;
  /** FieldDefinition row id; null for core fields, which live in code. */
  definitionId: string | null;
  /** Archived custom fields keep their values but leave forms. Always false for core. */
  archived: boolean;
  /**
   * False when bespoke UI renders this field (e.g. an event's start/end pair,
   * which needs all-day and timezone awareness). Such fields are still
   * validated through the registry — they are just skipped by the generic
   * input loop so a hand-written component can own their layout.
   */
  generic: boolean;
}

/**
 * Form input name for a registry field.
 *
 * Namespaced so a field key can never collide with a non-field input on the
 * same form (addToGoogle, contact-point rows, attendee ids). Lives here rather
 * than alongside the validators because client components need it, and this
 * module is dependency-free — importing it must not pull Zod into the browser
 * bundle.
 */
export function fieldInputName(key: string): string {
  return `f_${key}`;
}

export const FIELD_TYPES: readonly FieldType[] = [
  "TEXT",
  "LONGTEXT",
  "NUMBER",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "EMAIL",
  "PHONE",
  "URL",
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXT: "Text",
  LONGTEXT: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  DATETIME: "Date & time",
  BOOLEAN: "Yes / no",
  SELECT: "Single choice",
  MULTISELECT: "Multiple choice",
  EMAIL: "Email",
  PHONE: "Phone",
  URL: "Link",
};

/** Types whose definition needs a list of allowed values. */
export function takesOptions(type: FieldType): boolean {
  return type === "SELECT" || type === "MULTISELECT";
}

/** Normalise a user-supplied label into a stable snake_case storage key. */
export function toFieldKey(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
