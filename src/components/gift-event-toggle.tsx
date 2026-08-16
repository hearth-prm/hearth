"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";

/**
 * Turn gift tracking on or off, from the Gifts section's own header.
 *
 * Deliberately just a button. It sits in a card header, so there is no room for help
 * text or a confirmation message — and none is needed: the section it controls appears
 * or disappears directly beneath, which reports the outcome better than a toast could.
 * The one thing a person might reasonably fear is in the hover text, since turning
 * tracking off looks like it could throw the records away.
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
  const [, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="eventId" value={eventId} />
      {/* The new value, not the current one: the button says what pressing it does. */}
      <input type="hidden" name="isGiftEvent" value={isGiftEvent ? "" : "on"} />
      <SubmitButton
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        pendingLabel="Saving…"
      >
        <span
          title={
            isGiftEvent
              ? "Hides the gift controls. Nothing recorded is deleted."
              : "Say who presents are for, and record what arrives."
          }
        >
          {isGiftEvent ? "Stop tracking gifts" : "Track gifts"}
        </span>
      </SubmitButton>
    </form>
  );
}
