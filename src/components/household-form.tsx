"use client";

import { useActionState, useState } from "react";
import type { ShareableUser } from "@/lib/users";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, inputClass, labelClass } from "@/components/ui";

/** Hand the household — and with it every contact card — to somebody else. */
export function HandOverForm({
  action,
  users,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  users: readonly ShareableUser[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);

  if (users.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        There is nobody else to hand it to yet.
      </p>
    );
  }

  if (!open && !state.message) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Hand over to someone else…
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      {!state.ok ? (
        <>
          <div>
            <label htmlFor="household-to" className={labelClass}>
              New head of the household
            </label>
            <select id="household-to" name="toUserId" className={`${inputClass} mt-1.5`}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ? `${u.name} · ${u.email}` : u.email}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Every contact card moves to them. Nobody loses access — they gain the right to
            delete the cards, and you keep yours through a share, as everyone else does.
          </p>
          <div className="flex items-center gap-2">
            <SubmitButton className={btnSecondary} pendingLabel="Handing over…">
              Hand over
            </SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-neutral-500 underline dark:text-neutral-400"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
    </form>
  );
}

/** Rebuild any card or share that went missing. */
export function RepairHouseholdForm({
  action,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  return (
    <form action={formAction} className="space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      <SubmitButton className={btnSecondary} pendingLabel="Checking…">
        Check and repair
      </SubmitButton>
    </form>
  );
}
