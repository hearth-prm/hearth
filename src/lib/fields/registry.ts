import type { FieldEntity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coreFields } from "./core";
import type { FieldDef } from "./types";

/**
 * Custom fields start above the core block (10–60) but below the long-text
 * fields (900) so freshly added fields land in a sensible place in forms.
 */
export const CUSTOM_FIELD_ORDER_BASE = 100;

/**
 * The single source of truth for "what fields does a Person/Event have?".
 *
 * Merges the code-declared core fields with this owner's FieldDefinition rows.
 * Everything downstream — forms, list columns, validation, display, and the
 * Google field-mapping table — reads the registry rather than hardcoding a
 * field list, which is what makes the app extensible without code changes.
 */
export async function loadRegistry(
  ownerId: string,
  entity: FieldEntity,
  opts: { includeArchived?: boolean } = {},
): Promise<FieldDef[]> {
  const rows = await prisma.fieldDefinition.findMany({
    where: {
      ownerId,
      entity,
      ...(opts.includeArchived ? {} : { archived: false }),
    },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });

  const custom: FieldDef[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    type: row.type,
    storage: "custom",
    options: row.options,
    required: row.required,
    helpText: row.helpText,
    showInList: row.showInList,
    order: row.order,
    core: false,
    definitionId: row.id,
    generic: true,
  }));

  return [...coreFields(entity), ...custom].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label),
  );
}

/** Fields the generic input loop should render. */
export function genericFields(defs: readonly FieldDef[]): FieldDef[] {
  return defs.filter((d) => d.generic);
}

/** Fields flagged for display as list-view columns. */
export function listFields(defs: readonly FieldDef[]): FieldDef[] {
  return defs.filter((d) => d.showInList);
}

export function findField(
  defs: readonly FieldDef[],
  key: string,
): FieldDef | undefined {
  return defs.find((d) => d.key === key);
}

/** Next default order value for a newly created custom field. */
export async function nextCustomFieldOrder(
  ownerId: string,
  entity: FieldEntity,
): Promise<number> {
  const last = await prisma.fieldDefinition.findFirst({
    where: { ownerId, entity },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  return Math.max(CUSTOM_FIELD_ORDER_BASE, (last?.order ?? 0) + 10);
}
