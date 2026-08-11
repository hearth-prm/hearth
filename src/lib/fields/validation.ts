import { z, type ZodType } from "zod";
import { fieldInputName, type FieldDef } from "./types";

export { fieldInputName };

/**
 * Validated field values, keyed by FieldDef.key.
 *
 * Canonical representations, chosen so a value is JSON-safe and therefore
 * storable in the `custom` JSONB column without further conversion:
 *   TEXT/LONGTEXT/EMAIL/PHONE/URL/SELECT  -> string
 *   MULTISELECT                           -> string[]
 *   NUMBER                                -> number
 *   BOOLEAN                               -> boolean
 *   DATE                                  -> "YYYY-MM-DD"
 *   DATETIME                              -> "YYYY-MM-DDTHH:mm"
 * A cleared optional field is `null`. Column-backed fields are converted to
 * Date objects later, at the storage boundary (see values.ts).
 */
export type FieldValues = Record<string, unknown>;
export type FieldErrors = Record<string, string>;

const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Schema for a *present* value of this field. Emptiness is handled separately
 *  so that "required" produces a clean per-field message. */
function valueSchema(def: FieldDef): ZodType {
  switch (def.type) {
    case "TEXT":
      return z.string().trim().min(1).max(1_000);
    case "PHONE":
      return z.string().trim().min(1).max(64);
    case "LONGTEXT":
      return z.string().trim().min(1).max(20_000);
    case "EMAIL":
      return z.email().max(320);
    case "URL":
      return z.url().max(2_000);
    case "NUMBER":
      return z.coerce
        .number()
        .refine((n) => Number.isFinite(n), { message: "Must be a number" });
    case "BOOLEAN":
      return z.boolean();
    case "DATE":
      return z.iso.date();
    case "DATETIME":
      return z
        .string()
        .regex(DATETIME_LOCAL_RE, { message: "Must be a date and time" });
    case "SELECT":
      return def.options.length
        ? z.string().refine((v) => def.options.includes(v), {
            message: "Not one of the allowed choices",
          })
        : z.string().trim().min(1);
    case "MULTISELECT":
      return def.options.length
        ? z
            .array(z.string())
            .refine((arr) => arr.every((v) => def.options.includes(v)), {
              message: "Contains a value that is not an allowed choice",
            })
        : z.array(z.string());
    default:
      return z.string();
  }
}

/** Pull this field's raw value out of a submitted FormData. */
function rawValue(def: FieldDef, form: FormData): unknown {
  const name = fieldInputName(def.key);

  // An unchecked checkbox is simply absent, so absence means false rather than
  // "not provided" — booleans can never be empty.
  if (def.type === "BOOLEAN") {
    const v = form.get(name);
    return v === "on" || v === "true" || v === "1";
  }

  if (def.type === "MULTISELECT") {
    return form
      .getAll(name)
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
  }

  const v = form.get(name);
  return typeof v === "string" ? v.trim() : null;
}

function isEmpty(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string") return raw.length === 0;
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

function firstMessage(error: z.ZodError, def: FieldDef): string {
  const issue = error.issues[0];
  if (!issue) return `${def.label} is invalid`;
  switch (issue.code) {
    case "invalid_format":
      return def.type === "EMAIL"
        ? "Enter a valid email address"
        : def.type === "URL"
          ? "Enter a valid URL (including https://)"
          : def.type === "DATE"
            ? "Enter a valid date"
            : `${def.label} is not in the expected format`;
    case "invalid_type":
      return `${def.label} is not a valid value`;
    default:
      return issue.message || `${def.label} is invalid`;
  }
}

/**
 * Validate every field in the registry against a submitted form.
 *
 * Returns a value for *every* field (null when cleared) so the caller can
 * distinguish "cleared" from "absent" — writes then reliably blank out fields
 * the user emptied.
 */
export function parseFields(
  defs: readonly FieldDef[],
  form: FormData,
): { ok: true; values: FieldValues } | { ok: false; errors: FieldErrors } {
  const values: FieldValues = {};
  const errors: FieldErrors = {};

  for (const def of defs) {
    const result = parseOneField(def, rawValue(def, form));
    if (result.ok) values[def.key] = result.value;
    else errors[def.key] = result.error;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}

/**
 * Validate one already-extracted value.
 *
 * Split out from parseFields so CSV import validates against exactly the same
 * schemas as the form does. A second set of rules for imported data is how a file
 * ends up able to store values the UI would have rejected.
 */
export function parseOneField(
  def: FieldDef,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (isEmpty(raw)) {
    return def.required
      ? { ok: false, error: `${def.label} is required` }
      : { ok: true, value: null };
  }

  const parsed = valueSchema(def).safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: firstMessage(parsed.error, def) };
}
