"use client";

import { useActionState, useState } from "react";
import type { FieldType } from "@prisma/client";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { FIELD_TYPE_LABELS } from "@/lib/fields/types";
import { NO_TARGET, type MappingTarget } from "@/lib/google/mapping-targets";
import { SubmitButton } from "@/components/submit-button";
import { Badge, Card, CardHeader, FormMessage, helpClass, inputClass } from "@/components/ui";

export interface MappingRow {
  fieldKey: string;
  label: string;
  type: FieldType;
  core: boolean;
  archived: boolean;
  /** Read-only description of where a core field goes. */
  coreDestination: string;
  /** Core fields that may be switched off; custom fields are always choosable. */
  choosable: boolean;
  target: string;
  targetKey: string;
  /** Targets legal for this field's type. */
  targets: MappingTarget[];
}

export function MappingForm({
  action,
  entitySlug,
  noun,
  rows,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  entitySlug: string;
  noun: string;
  rows: MappingRow[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const core = rows.filter((r) => r.core);
  const custom = rows.filter((r) => !r.core);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="entitySlug" value={entitySlug} />
      <FormMessage ok={state.ok} message={state.message} />

      <Card>
        <CardHeader
          title="Built-in fields"
          description="Their destinations are fixed, but you can stop any of these being sent."
        />
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {core.map((row) => (
            <li key={row.fieldKey} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  → Google {row.coreDestination}
                </p>
              </div>
              {row.choosable ? (
                <label className="flex items-center gap-2 text-sm">
                  {/* A separate name from the custom-field selects: an unchecked
                      checkbox submits nothing at all, so "off" can only be
                      expressed as the absence of this key — which the action reads
                      as absence rather than as a missing value to skip. */}
                  <input
                    type="checkbox"
                    name={`send_${row.fieldKey}`}
                    defaultChecked={row.target !== NO_TARGET}
                    className="size-4 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
                  />
                  Send
                </label>
              ) : (
                <Badge tone="slate">always sent</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Your fields"
          description={
            custom.length === 0
              ? `No custom ${noun} fields yet.`
              : "Nothing is sent unless you choose a destination. Every destination adds to Google rather than replacing anything."
          }
        />
        {custom.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            Add one under “{noun === "contact" ? "Contact fields" : "Event fields"}”
            and it will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {custom.map((row) => (
              <CustomRow key={row.fieldKey} row={row} />
            ))}
          </ul>
        )}
      </Card>

      <SubmitButton>Save mappings</SubmitButton>
    </form>
  );
}

function CustomRow({ row }: { row: MappingRow }) {
  const [target, setTarget] = useState(row.target);
  const chosen = row.targets.find((t) => t.id === target);

  return (
    <li className="px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-sm font-medium">
            {row.label}
            {row.archived ? (
              <span className="ml-2 text-xs text-neutral-400">archived</span>
            ) : null}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            <code>{row.fieldKey}</code> · {FIELD_TYPE_LABELS[row.type]}
          </p>
        </div>

        <div>
          <select
            name={`target_${row.fieldKey}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className={inputClass}
            aria-label={`Where to send ${row.label}`}
          >
            {row.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {chosen?.needsKey ? (
            <input
              name={`key_${row.fieldKey}`}
              defaultValue={row.targetKey}
              placeholder={row.label}
              className={`${inputClass} mt-2`}
              aria-label={`Google name for ${row.label}`}
            />
          ) : null}

          {chosen ? <p className={helpClass}>{chosen.description}</p> : null}
        </div>
      </div>
    </li>
  );
}
