import { z } from "zod";
import type { ContactKind, ContactPoint } from "@prisma/client";

export const CONTACT_KINDS = [
  "EMAIL",
  "PHONE",
  "URL",
  "ADDRESS",
  "SOCIAL",
] as const satisfies readonly ContactKind[];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  EMAIL: "Email",
  PHONE: "Phone",
  URL: "Link",
  ADDRESS: "Address",
  SOCIAL: "Social",
};

/** Suggested `label` values per kind, offered as datalist hints. */
export const CONTACT_LABEL_SUGGESTIONS: Record<ContactKind, string[]> = {
  EMAIL: ["home", "work", "other"],
  PHONE: ["mobile", "home", "work"],
  URL: ["website", "blog", "linkedin"],
  ADDRESS: ["home", "work"],
  SOCIAL: ["linkedin", "instagram", "mastodon", "signal"],
};

export interface PersonNameParts {
  givenName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
  organization?: string | null;
}

/**
 * Denormalised name used for sorting, search and every place a person is
 * mentioned. Computed on write so list queries can ORDER BY it directly rather
 * than sorting in application code.
 */
export function computeDisplayName(p: PersonNameParts): string {
  const full = [p.givenName, p.familyName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return (
    full ||
    (p.nickname ?? "").trim() ||
    (p.organization ?? "").trim() ||
    "Unnamed contact"
  );
}

export interface ContactPointInput {
  kind: ContactKind;
  label: string | null;
  value: string;
  isPrimary: boolean;
  order: number;
}

/**
 * Read the repeatable contact-point rows out of a submitted form.
 *
 * The three inputs are parallel arrays (cp_kind / cp_label / cp_value), so the
 * browser preserves row grouping by position without needing indexed names.
 * Rows with an empty value are dropped, which is also how a row gets deleted.
 *
 * The first entry of each kind is marked primary. Google needs to know which
 * email to put on a calendar invite, and inferring it from order is less UI for
 * the same result.
 */
export function parseContactPoints(
  form: FormData,
): { ok: true; items: ContactPointInput[] } | { ok: false; error: string } {
  const kinds = form.getAll("cp_kind").map(String);
  const labels = form.getAll("cp_label").map(String);
  const values = form.getAll("cp_value").map(String);

  const items: ContactPointInput[] = [];
  const primaryTaken = new Set<string>();

  for (let i = 0; i < kinds.length; i++) {
    const value = (values[i] ?? "").trim();
    if (!value) continue;

    const rawKind = kinds[i] ?? "";
    if (!(CONTACT_KINDS as readonly string[]).includes(rawKind)) {
      return { ok: false, error: `Unknown contact type "${rawKind}"` };
    }
    const kind = rawKind as ContactKind;

    if (kind === "EMAIL" && !z.email().safeParse(value).success) {
      return { ok: false, error: `"${value}" is not a valid email address` };
    }
    if (kind === "URL" && !z.url().safeParse(value).success) {
      return { ok: false, error: `"${value}" is not a valid URL (include https://)` };
    }
    if (value.length > 500) {
      return { ok: false, error: "Contact details must be under 500 characters" };
    }

    const isPrimary = !primaryTaken.has(kind);
    primaryTaken.add(kind);

    items.push({
      kind,
      label: (labels[i] ?? "").trim() || null,
      value,
      isPrimary,
      order: items.length,
    });
  }

  return { ok: true, items };
}

/** The address a Google Calendar invite should go to, if any. */
export function primaryEmail(
  contactPoints: readonly Pick<ContactPoint, "kind" | "value" | "isPrimary">[],
): string | null {
  const emails = contactPoints.filter((c) => c.kind === "EMAIL");
  return emails.find((c) => c.isPrimary)?.value ?? emails[0]?.value ?? null;
}
