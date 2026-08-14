"use client";

import { useActionState, useState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { FormMessage, helpClass, inputClass, labelClass } from "@/components/ui";

/**
 * Create a relationship type.
 *
 * The symmetric toggle hides the inverse label because for symmetric types the
 * inverse *is* the label — asking for it separately would invite inconsistent
 * pairs like "Sibling of" / "Brother of" that read wrong from one side.
 */
export function RelationshipTypeForm({
  action,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [symmetric, setSymmetric] = useState(false);
  const [label, setLabel] = useState("");

  return (
    <form action={formAction} className="space-y-5 px-5 py-5">
      <FormMessage ok={state.ok} message={state.message} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="rt-label" className={labelClass}>
            Reads forwards as
          </label>
          <input
            id="rt-label"
            name="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Godparent of"
            required
            className={`${inputClass} mt-1.5`}
          />
          <p className={helpClass}>
            How it reads from the first person to the second.
          </p>
        </div>

        {symmetric ? null : (
          <div>
            <label htmlFor="rt-inverse" className={labelClass}>
              Reads backwards as
            </label>
            <input
              id="rt-inverse"
              name="inverseLabel"
              placeholder="Godchild of"
              className={`${inputClass} mt-1.5`}
            />
            <p className={helpClass}>Shown on the other person&rsquo;s page.</p>
          </div>
        )}
      </div>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="symmetric"
          checked={symmetric}
          onChange={(e) => setSymmetric(e.target.checked)}
          className="mt-0.5 size-4 rounded border-neutral-300 text-accent-600 dark:border-neutral-600"
        />
        <span>
          <span className={labelClass}>Direction does not matter</span>
          <span className={`${helpClass} block`}>
            Like “Sibling of” or “Friend of” — reads the same from both sides.
          </span>
        </span>
      </label>

      <SubmitButton pendingLabel="Adding…">Add relationship type</SubmitButton>
    </form>
  );
}
