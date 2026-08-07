import { inputToDateOnly, wallClockToUtc } from "@/lib/time";
import type { FieldDef } from "./types";
import type { FieldValues } from "./validation";

export type CustomBag = Record<string, unknown>;

/** Safely narrow a Prisma `Json` column to an object bag. */
export function readCustomBag(record: { custom?: unknown }): CustomBag {
  const c = record.custom;
  return c && typeof c === "object" && !Array.isArray(c) ? (c as CustomBag) : {};
}

/** Read one field off an entity, whichever storage it uses. */
export function readFieldValue(
  record: Record<string, unknown> & { custom?: unknown },
  def: FieldDef,
): unknown {
  if (def.storage === "column") return record[def.key];
  return readCustomBag(record)[def.key];
}

export interface PartitionedValues {
  /** Spreadable into a Prisma create/update `data`. */
  columns: Record<string, unknown>;
  /** The complete replacement `custom` bag. */
  custom: CustomBag;
}

/**
 * Split validated registry values into column updates and a merged JSONB bag.
 *
 * This is the one place that knows how a canonical value becomes a stored
 * value: JSONB keeps the JSON-safe form from validation, while DATE/DATETIME
 * columns must become real Date objects. `existingCustom` is merged so that
 * archived fields (absent from `defs`) keep their values rather than being
 * silently dropped on the next save.
 */
export function partitionFieldValues(
  defs: readonly FieldDef[],
  values: FieldValues,
  existingCustom: CustomBag = {},
  opts: { timeZone?: string } = {},
): PartitionedValues {
  const timeZone = opts.timeZone || "UTC";
  const columns: Record<string, unknown> = {};
  const custom: CustomBag = { ...existingCustom };

  for (const def of defs) {
    if (!(def.key in values)) continue;
    const value = values[def.key];

    if (def.storage === "column") {
      columns[def.key] = toColumnValue(def, value, timeZone);
      continue;
    }

    // Clearing a custom field removes the key entirely rather than storing
    // null, so `custom` stays a compact record of what is actually set.
    if (value === null || value === undefined) {
      delete custom[def.key];
    } else {
      custom[def.key] = value;
    }
  }

  return { columns, custom };
}

function toColumnValue(def: FieldDef, value: unknown, timeZone: string): unknown {
  if (value === null || value === undefined) return null;

  if (def.type === "DATE" && typeof value === "string") {
    return inputToDateOnly(value);
  }
  if (def.type === "DATETIME" && typeof value === "string") {
    return wallClockToUtc(value, timeZone);
  }
  return value;
}
