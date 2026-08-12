"use client";

import { useActionState, useState } from "react";
import type { ShareableUser } from "@/lib/users";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnDanger, btnSecondary, FormMessage, helpClass, labelClass } from "@/components/ui";

/**
 * Hand a contact to another user.
 *
 * Folded away behind a link rather than sitting open, because it is rare and
 * irreversible-by-you: once transferred, getting it back needs the new owner's
 * cooperation. The consequences are listed before the button rather than after it, and
 * the button is styled as destructive, because the thing being destroyed is your own
 * claim on the record.
 */
export function TransferForm({
  action,
  personId,
  personName,
  users,
  labelCount,
  customFieldNames,
  sharedWithCount,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  personId: string;
  personName: string;
  users: readonly ShareableUser[];
  /** Labels currently on the contact, which the transfer will remove. */
  labelCount: number;
  /** Your custom fields holding a value, which the new owner may not be able to read. */
  customFieldNames: readonly string[];
  /** How many other people it is already shared with. */
  sharedWithCount: number;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState<"none" | "view" | "edit">("none");

  if (users.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Nobody else has signed in to this Hearth yet, so there is no one to transfer to.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Transfer ownership…
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="personId" value={personId} />
      {/* Only ever an error: a success redirects to the list, because a completed
          transfer un-renders this form — it is shown to owners, and the action's whole
          job is to stop you being one. */}
      <FormMessage ok={state.ok} message={state.message} />

      <div>
        <label htmlFor={`to-${personId}`} className={labelClass}>
          New owner
        </label>
        <select
          id={`to-${personId}`}
          name="toUserId"
          className="mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ? `${u.name} · ${u.email}` : u.email}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className={labelClass}>What you keep</legend>
        <div className="mt-1.5 space-y-1">
          {(
            [
              ["none", "Nothing — it leaves my lists and my Google Contacts"],
              ["view", "View only — I can still see it, and it stays in my Google"],
              ["edit", "View and edit — I can still help maintain it"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="kept"
                value={value}
                checked={kept === value}
                onChange={() => setKept(value)}
                className="mt-1 size-4 border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
              />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-medium">What changes</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            Deleting, sharing and label decisions become theirs. You cannot undo this
            without their help.
          </li>
          {labelCount > 0 ? (
            <li>
              Your {labelCount} label{labelCount === 1 ? "" : "s"} on this contact are
              removed — labels belong to whoever owns the record.
            </li>
          ) : null}
          {customFieldNames.length > 0 ? (
            <li>
              {customFieldNames.join(", ")} will stop showing unless the new owner has a
              field of the same name. The values are kept, so transferring back restores
              them.
            </li>
          ) : null}
          {sharedWithCount > 0 ? (
            <li>
              The {sharedWithCount} {sharedWithCount === 1 ? "person" : "people"} it is
              already shared with keep their access.
            </li>
          ) : null}
          {kept === "none" ? (
            <li>It will be removed from your Google Contacts on the next sync.</li>
          ) : null}
        </ul>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className={btnDanger} pendingLabel="Transferring…">
          Transfer {personName}
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
          Cancel
        </button>
      </div>

      <p className={helpClass}>
        They will not be notified. Tell them yourself if it matters.
      </p>
    </form>
  );
}
