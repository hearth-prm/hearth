import type { FieldEntity, FieldMapping } from "@prisma/client";
import { prisma } from "@/lib/db";
import { NO_TARGET } from "./mapping-targets";

/**
 * The resolved mapping for one entity's fields.
 *
 * Absence is meaningful and differs by field kind, which is the whole reason this
 * is a lookup rather than a plain list:
 *   * a CUSTOM field with no row is not synced — a newly added field never
 *     silently exports itself;
 *   * a CORE field with no row keeps its canonical destination.
 */
export interface ResolvedMappings {
  byKey: Map<string, { target: string; targetKey: string | null }>;

  /** Where a custom field goes, or null when it is not synced. */
  customTarget(fieldKey: string): { target: string; targetKey: string | null } | null;

  /** Whether a core field should still be written. */
  coreEnabled(fieldKey: string): boolean;
}

export function resolveMappings(rows: readonly FieldMapping[]): ResolvedMappings {
  const byKey = new Map(
    rows.map((r) => [r.fieldKey, { target: r.target, targetKey: r.targetKey }]),
  );

  return {
    byKey,
    customTarget(fieldKey) {
      const row = byKey.get(fieldKey);
      if (!row || row.target === NO_TARGET) return null;
      return row;
    },
    coreEnabled(fieldKey) {
      const row = byKey.get(fieldKey);
      // No row means default-on for core fields; only an explicit "none" disables.
      return !row || row.target !== NO_TARGET;
    },
  };
}

export async function loadMappings(
  ownerId: string,
  entity: FieldEntity,
): Promise<ResolvedMappings> {
  const rows = await prisma.fieldMapping.findMany({ where: { ownerId, entity } });
  return resolveMappings(rows);
}

/** Mappings that touch nothing — used where a caller has none to apply. */
export function noMappings(): ResolvedMappings {
  return resolveMappings([]);
}
