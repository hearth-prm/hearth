"use client";

import { useState } from "react";
import type { ContactKind } from "@prisma/client";
import {
  CONTACT_DETAIL_KEYS,
  CONTACT_KINDS,
  CONTACT_KIND_LABELS,
  CONTACT_LABEL_SUGGESTIONS,
  type ContactDetailKey,
} from "@/lib/people";
import { btnGhost, btnSecondary, inputClass, labelClass } from "@/components/ui";

export interface ContactPointRow {
  kind: ContactKind;
  label: string;
  value: string;
  /** Structured address parts and an email display name; "" when absent. */
  detail?: Partial<Record<ContactDetailKey, string>>;
}

/** Shown for an address, in the order somebody would read one. */
const ADDRESS_PARTS: { key: ContactDetailKey; label: string }[] = [
  { key: "streetAddress", label: "Street" },
  { key: "extendedAddress", label: "Extra line" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postalCode", label: "Postcode" },
  { key: "country", label: "Country" },
  { key: "countryCode", label: "Country code" },
  { key: "poBox", label: "PO box" },
];

interface Row extends ContactPointRow {
  uid: number;
}

function detailOf(row: Row, key: ContactDetailKey): string {
  return row.detail?.[key] ?? "";
}

/**
 * Repeatable contact-detail rows.
 *
 * Emits parallel arrays (cp_kind / cp_label / cp_value, and one per structured detail)
 * rather than indexed names like cp[0][value]: the browser submits repeated names in
 * document order, so position alone preserves row grouping, and deleting a row
 * needs no reindexing. parseContactPoints() zips them back together.
 *
 * EVERY row emits EVERY field, including the address parts on a phone number, where they
 * are hidden and empty. That is not waste — it is what keeps the arrays aligned. A row
 * that skipped a field would shift every later row's detail onto the wrong contact point,
 * and it would do so silently.
 *
 * The parts are also what stops a save from flattening an imported address. Google keeps
 * street, city and postcode beside the one line; Hearth manages the addresses group and
 * replaces it wholesale, so a form that did not carry the parts would erase them on the
 * next sync — after an edit to something else entirely.
 */
export function ContactPointsEditor({
  initial,
}: {
  initial: readonly ContactPointRow[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((r, i) => ({ ...r, uid: i })),
  );
  // Monotonic counter for React keys — stable across renders, and avoids
  // Math.random() which would break hydration.
  const [nextUid, setNextUid] = useState(initial.length);

  function addRow(kind: ContactKind = "EMAIL") {
    setRows((prev) => [...prev, { uid: nextUid, kind, label: "", value: "" }]);
    setNextUid((n) => n + 1);
  }

  function removeRow(uid: number) {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  }

  function patchRow(uid: number, patch: Partial<ContactPointRow>) {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No contact details yet.
        </p>
      ) : null}

      {rows.map((row, index) => (
        <div key={row.uid} className="flex flex-wrap items-end gap-2">
          <div className="w-28">
            {index === 0 ? <span className={labelClass}>Type</span> : null}
            <select
              name="cp_kind"
              value={row.kind}
              onChange={(e) =>
                patchRow(row.uid, { kind: e.target.value as ContactKind })
              }
              className={`${inputClass} mt-1.5`}
              aria-label="Contact type"
            >
              {CONTACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTACT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="w-28">
            {index === 0 ? <span className={labelClass}>Label</span> : null}
            <input
              name="cp_label"
              value={row.label}
              onChange={(e) => patchRow(row.uid, { label: e.target.value })}
              list={`cp-labels-${row.kind}`}
              placeholder="work"
              className={`${inputClass} mt-1.5`}
              aria-label="Contact label"
            />
            <datalist id={`cp-labels-${row.kind}`}>
              {CONTACT_LABEL_SUGGESTIONS[row.kind].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="min-w-48 flex-1">
            {index === 0 ? <span className={labelClass}>Detail</span> : null}
            <input
              name="cp_value"
              value={row.value}
              onChange={(e) => patchRow(row.uid, { value: e.target.value })}
              type={row.kind === "EMAIL" ? "email" : row.kind === "URL" ? "url" : "text"}
              placeholder={placeholderFor(row.kind)}
              className={`${inputClass} mt-1.5`}
              aria-label="Contact detail"
            />
          </div>

          <button
            type="button"
            onClick={() => removeRow(row.uid)}
            className={btnGhost}
            aria-label="Remove this contact detail"
          >
            Remove
          </button>

          {/* Hidden for every kind that has no use for them, so the arrays stay
              aligned; shown as real inputs for an address below. */}
          {CONTACT_DETAIL_KEYS.filter(
            (key) => row.kind !== "ADDRESS" || key === "displayName",
          ).map((key) => (
            <input
              key={key}
              type="hidden"
              name={`cp_${key}`}
              value={detailOf(row, key)}
            />
          ))}

          {row.kind === "ADDRESS" ? (
            <details className="w-full">
              <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">
                Address parts{" "}
                {ADDRESS_PARTS.some((p) => detailOf(row, p.key)) ? "· filled in" : ""}
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ADDRESS_PARTS.map((part) => (
                  <label key={part.key} className="text-xs text-neutral-500 dark:text-neutral-400">
                    {part.label}
                    <input
                      name={`cp_${part.key}`}
                      value={detailOf(row, part.key)}
                      onChange={(e) =>
                        patchRow(row.uid, {
                          detail: { ...row.detail, [part.key]: e.target.value },
                        })
                      }
                      className={`${inputClass} mt-1`}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                The line above is what Hearth shows and searches. These parts travel with
                it to Google, which keeps both.
              </p>
            </details>
          ) : null}
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => addRow("EMAIL")} className={btnSecondary}>
          + Email
        </button>
        <button type="button" onClick={() => addRow("PHONE")} className={btnSecondary}>
          + Phone
        </button>
        <button type="button" onClick={() => addRow("ADDRESS")} className={btnSecondary}>
          + Address
        </button>
        <button type="button" onClick={() => addRow("URL")} className={btnSecondary}>
          + Link
        </button>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        The first email and phone are treated as primary — that is the address
        Hearth uses when inviting someone to a Google Calendar event.
      </p>
    </div>
  );
}

function placeholderFor(kind: ContactKind): string {
  switch (kind) {
    case "EMAIL":
      return "name@example.com";
    case "PHONE":
      return "+1 555 010 1234";
    case "URL":
      return "https://example.com";
    case "ADDRESS":
      return "123 Main St, Madison WI";
    case "SOCIAL":
      return "@handle";
    default:
      return "";
  }
}
