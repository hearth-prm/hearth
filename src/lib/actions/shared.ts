import { Prisma } from "@prisma/client";
import { AccessDeniedError } from "@/lib/access";
import { actionError, type ActionState } from "@/lib/actions/types";

export function readCheckbox(form: FormData, name: string): boolean {
  const v = form.get(name);
  return v === "on" || v === "true" || v === "1";
}

export function readString(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The one place we cast dynamically-built column values into Prisma's input
 * types.
 *
 * Unavoidable: the field registry is data, so the set of column names being
 * written is not known at the call site. It is nonetheless sound, because
 * partitionFieldValues only ever emits keys taken from core field definitions,
 * and those keys are checked against `keyof Person` / `keyof Event` at compile
 * time in src/lib/fields/core.ts.
 */
export function asColumnData<T>(columns: Record<string, unknown>): Partial<T> {
  return columns as unknown as Partial<T>;
}

/** Map thrown errors onto a form-friendly result. */
export function toActionError(err: unknown): ActionState {
  if (err instanceof AccessDeniedError) {
    return actionError(err.message);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return actionError("That already exists.");
    }
    if (err.code === "P2025") {
      return actionError("That record no longer exists.");
    }
  }
  console.error("[hearth] action failed:", err);
  return actionError("Something went wrong saving that. Please try again.");
}

/** Next's redirect()/notFound() signal by throwing — never swallow those. */
export function isFrameworkError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (err as { digest: string }).digest === "NEXT_NOT_FOUND")
  );
}
