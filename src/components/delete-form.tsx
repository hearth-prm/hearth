"use client";

import { SubmitButton } from "@/components/submit-button";
import { btnDanger } from "@/components/ui";

/**
 * A destructive single-button form.
 *
 * The confirm() lives in onSubmit rather than on the button's onClick so that
 * cancelling stops the server action from being invoked at all — a click handler
 * would fire after the form had already begun submitting.
 */
export function DeleteForm({
  action,
  id,
  idName = "id",
  label = "Delete",
  pendingLabel = "Deleting…",
  confirmMessage,
  className = btnDanger,
  extra,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  idName?: string;
  label?: string;
  pendingLabel?: string;
  confirmMessage: string;
  className?: string;
  /** Further hidden fields, for a row whose identity is not a single id. */
  extra?: Record<string, string>;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <input type="hidden" name={idName} value={id} />
      {Object.entries(extra ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton className={className} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </form>
  );
}
