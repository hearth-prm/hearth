"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import type { PickablePerson } from "@/components/attendee-picker";
import { SubmitButton } from "@/components/submit-button";
import { FormMessage, inputClass, labelClass } from "@/components/ui";

export interface RelationshipTypeOption {
  id: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
}

/**
 * Add a typed link from this person to another.
 *
 * The type list shows the forward reading ("Parent of"), and the hint spells out
 * the reverse so the direction is unambiguous before submitting — directional
 * types are the easiest thing to get backwards in a relationship graph.
 */
export function RelationshipForm({
  action,
  personId,
  personName,
  types,
  people,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  personId: string;
  personName: string;
  types: readonly RelationshipTypeOption[];
  people: readonly PickablePerson[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  if (people.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Add another contact first, then you can link the two together.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="fromPersonId" value={personId} />

      <FormMessage ok={state.ok} message={state.message} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rel-type" className={labelClass}>
            {personName} is the…
          </label>
          <select id="rel-type" name="typeId" className={`${inputClass} mt-1.5`} required>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {t.symmetric ? "" : ` (they are the ${t.inverseLabel.toLowerCase()})`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rel-person" className={labelClass}>
            …this person
          </label>
          <select
            id="rel-person"
            name="toPersonId"
            className={`${inputClass} mt-1.5`}
            required
            defaultValue=""
          >
            <option value="" disabled>
              Choose someone…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">
          Add dates or a note
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="rel-started" className={labelClass}>
              Since
            </label>
            <input
              id="rel-started"
              type="date"
              name="startedOn"
              className={`${inputClass} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="rel-ended" className={labelClass}>
              Until
            </label>
            <input
              id="rel-ended"
              type="date"
              name="endedOn"
              className={`${inputClass} mt-1.5`}
            />
          </div>
          <div>
            <label htmlFor="rel-notes" className={labelClass}>
              Note
            </label>
            <input
              id="rel-notes"
              type="text"
              name="notes"
              className={`${inputClass} mt-1.5`}
            />
          </div>
        </div>
      </details>

      <SubmitButton pendingLabel="Adding…">Add relationship</SubmitButton>
    </form>
  );
}
