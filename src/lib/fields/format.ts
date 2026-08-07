import { dateOnlyToInput, formatDateOnly, formatInstant, utcToWallClock } from "@/lib/time";
import type { FieldDef } from "./types";

/**
 * Display and form-input formatting for field values.
 *
 * Both storages have to be handled for every temporal type: a column-backed
 * DATE arrives as a Date object from Prisma, while the same logical type stored
 * in JSONB arrives as a "YYYY-MM-DD" string.
 */

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Human-readable rendering, or "" when unset. */
export function formatFieldValue(
  def: FieldDef,
  value: unknown,
  timeZone = "UTC",
): string {
  if (value === null || value === undefined || value === "") return "";

  switch (def.type) {
    case "BOOLEAN":
      return value ? "Yes" : "No";
    case "DATE": {
      const d = asDate(value);
      return d ? formatDateOnly(d) : "";
    }
    case "DATETIME": {
      // A JSONB wall-clock string has no zone, so render it verbatim rather
      // than implying a conversion that was never applied.
      if (def.storage === "custom" && typeof value === "string") {
        const d = asDate(`${value}:00Z`);
        return d ? formatInstant(d, "UTC") : value;
      }
      const d = asDate(value);
      return d ? formatInstant(d, timeZone) : "";
    }
    case "MULTISELECT":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "NUMBER":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}

/** Value for a text/number/date/datetime-local input. */
export function fieldInputValue(
  def: FieldDef,
  value: unknown,
  timeZone = "UTC",
): string {
  if (value === null || value === undefined) return "";

  switch (def.type) {
    case "DATE": {
      if (typeof value === "string") return value.slice(0, 10);
      const d = asDate(value);
      return d ? dateOnlyToInput(d) : "";
    }
    case "DATETIME": {
      if (typeof value === "string") return value.slice(0, 16);
      const d = asDate(value);
      return d ? utcToWallClock(d, timeZone) : "";
    }
    case "MULTISELECT":
      return "";
    default:
      return String(value);
  }
}

export function fieldCheckedValue(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === 1;
}

export function fieldSelectedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}
