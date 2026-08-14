"use client";

import { useActionState, useState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, inputClass, labelClass } from "@/components/ui";

export interface EditableType {
  id: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
}

/**
 * Edit one relationship, from the page you are standing on.
 *
 * The type dropdown offers both readings of every asymmetric type — "Parent of" and
 * "Child of" — because a row viewed from its far end reads as the inverse, and a list of
 * types alone could not represent that, let alone let you correct a link entered
 * backwards. Symmetric types appear once, since both readings are the same sentence.
 *
 * The other person is not editable on purpose: pointing a relationship at somebody else
 * is a different fact rather than a correction, and Remove then Add says that plainly.
 */
export function RelationshipEditForm({
  action,
  relationshipId,
  subjectId,
  subjectName,
  otherName,
  types,
  current,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  relationshipId: string;
  subjectId: string;
  subjectName: string;
  otherName: string;
  types: readonly EditableType[];
  current: {
    typeId: string;
    /** True when the subject is the type's `from` side. */
    outgoing: boolean;
    startedOn: string;
    endedOn: string;
    notes: string;
  };
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Edit
      </button>
    );
  }

  // One field carrying type and direction together, so the two can never disagree.
  const options = types.flatMap((t) =>
    t.symmetric
      ? [{ value: `${t.id}:forward`, text: t.label }]
      : [
          { value: `${t.id}:forward`, text: t.label },
          { value: `${t.id}:inverse`, text: t.inverseLabel },
        ],
  );
  const selected = `${current.typeId}:${current.outgoing ? "forward" : "inverse"}`;

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="id" value={relationshipId} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <FormMessage ok={state.ok} message={state.message} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor={`rel-type-${relationshipId}`} className={labelClass}>
            {subjectName} is the… {otherName}
          </label>
          <select
            id={`rel-type-${relationshipId}`}
            name="typeDirection"
            defaultValue={selected}
            className={`${inputClass} mt-1.5`}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.text}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`rel-from-${relationshipId}`} className={labelClass}>
            From
          </label>
          <input
            id={`rel-from-${relationshipId}`}
            type="date"
            name="startedOn"
            defaultValue={current.startedOn}
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <div>
          <label htmlFor={`rel-to-${relationshipId}`} className={labelClass}>
            Until
          </label>
          <input
            id={`rel-to-${relationshipId}`}
            type="date"
            name="endedOn"
            defaultValue={current.endedOn}
            className={`${inputClass} mt-1.5`}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`rel-notes-${relationshipId}`} className={labelClass}>
          Note
        </label>
        <input
          id={`rel-notes-${relationshipId}`}
          name="notes"
          defaultValue={current.notes}
          className={`${inputClass} mt-1.5`}
        />
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className={btnSecondary} pendingLabel="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline dark:text-neutral-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
