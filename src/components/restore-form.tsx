"use client";

import { SubmitButton } from "@/components/submit-button";
import { btnSecondary } from "@/components/ui";

/**
 * A single-button form for taking something back out of the trash.
 *
 * No confirm(): restoring is the safe direction, and a dialogue in front of it would
 * teach people to dismiss the one in front of Delete permanently without reading it.
 *
 * display:flex for the same reason DeleteForm has it — so the button sits on the same
 * line as its neighbour rather than a few descender-pixels below.
 */
export function RestoreForm({
  action,
  id,
  label = "Restore",
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label?: string;
}) {
  return (
    <form className="flex" action={action}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton className={btnSecondary} pendingLabel="Restoring…">
        {label}
      </SubmitButton>
    </form>
  );
}
