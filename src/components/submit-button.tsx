"use client";

import { useFormStatus } from "react-dom";
import { btnPrimary } from "@/components/ui";

/**
 * Submit button that disables itself while its enclosing form is submitting.
 *
 * useFormStatus reads the pending state of the nearest parent <form>, which is
 * why this must be a separate component from the form itself — a component
 * cannot observe its own form's status.
 */
export function SubmitButton({
  children = "Save",
  pendingLabel = "Saving…",
  className = btnPrimary,
  disabled = false,
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Disable for a reason of the caller's own; pending still disables regardless. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled}>
      {pending ? pendingLabel : children}
    </button>
  );
}
