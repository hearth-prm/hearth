"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, helpClass } from "@/components/ui";

/**
 * Turn gift tracking on for an event.
 *
 * A submit rather than a checkbox that saves on change: switching it off is a decision
 * worth a deliberate press, since the gift section disappears with it. The records
 * themselves survive either way — turning it off hides the controls, not the history —
 * and the help text says so, because that is the thing a person would otherwise be
 * afraid of.
 */
export function GiftEventToggle({
  action,
  eventId,
  isGiftEvent,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  eventId: string;
  isGiftEvent: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      <input type="hidden" name="eventId" value={eventId} />
      {/* The new value, not the current one: the button says what pressing it does. */}
      <input type="hidden" name="isGiftEvent" value={isGiftEvent ? "" : "on"} />
      <SubmitButton className={btnSecondary} pendingLabel="Saving…">
        {isGiftEvent ? "Stop tracking gifts" : "Track gifts at this event"}
      </SubmitButton>
      {isGiftEvent ? (
        <p className={helpClass}>
          Turning this off hides the gift controls. Nothing recorded is deleted.
        </p>
      ) : (
        <p className={helpClass}>
          For an occasion where presents change hands — say who they are for, then
          record what arrived.
        </p>
      )}
    </form>
  );
}
