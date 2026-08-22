"use client";

import { useActionState, useRef, useState } from "react";
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

  /**
   * A number that changes once per submission, used to remount the rows.
   *
   * React resets a form after its action settles, and that reset lands AFTER the re-render
   * the revalidation causes — so a controlled select ends up showing the reset value with no
   * further render to put it back. Saving a mapping displayed "Not synced" while the database
   * held what you picked, and only a refresh told the truth. Cancelling the reset through
   * onReset does not work; React is not going through a cancellable event.
   *
   * So the rows are remounted instead, which re-reads every value from the server's answer.
   * That is right whether the save succeeded, failed, or changed nothing: after a submission
   * the thing to show is what is stored, not what the DOM was left holding.
   *
   * Set during render rather than in an effect — the conditional makes it converge in one
   * extra pass, and an effect would paint the wrong value first.
   */
  const lastResult = useRef(state);
  const [saves, setSaves] = useState(0);
  if (lastResult.current !== state) {
    lastResult.current = state;
    setSaves((n) => n + 1);
  }

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
                    className="size-4 rounded border-neutral-300 text-accent-600 dark:border-neutral-600"
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
              <CustomRow
                key={`${row.fieldKey}:${row.target}:${row.targetKey}:${saves}`}
                row={row}
              />
            ))}
          </ul>
        )}
      </Card>

      <SubmitButton>Save mappings</SubmitButton>
    </form>
  );
}

function CustomRow({ row }: { row: MappingRow }) {
  /**
   * The select is UNCONTROLLED, and that is the fix rather than an oversight.
   *
   * React resets a form once its action settles, and the reset lands after the re-render the
   * revalidation causes. A controlled select therefore ended up displaying the reset value
   * with no further render to correct it: saving showed "Not synced" while the database, and
   * the prop, both said otherwise. Measured rather than guessed — the select reported
   * data-saved="userDefined" while its own value was "none".
   *
   * Uncontrolled makes the order stop mattering. The row is remounted on every submission,
   * so the node's defaultValue is always what the server just said; whether the reset runs
   * before or after that remount, it lands on the same value.
   *
   * Local state only decides whether the key input and description are shown.
   */
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
            /* What the server says is stored, so a test can tell a stale prop apart from a
               stale DOM — the two look identical from outside and need opposite fixes. */
            data-saved={row.target}
            defaultValue={row.target}
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
