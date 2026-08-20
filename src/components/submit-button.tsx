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
  formAction,
  confirm,
  beforeSubmit,
}: {
  children?: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  /** Disable for a reason of the caller's own; pending still disables regardless. */
  disabled?: boolean;
  /**
   * Send this form somewhere other than its own action.
   *
   * For one form with several things it can do — a selection of contacts that can be
   * labelled, synced or deleted. Which button was pressed has to be said some other way;
   * see beforeSubmit.
   */
  formAction?: (form: FormData) => void | Promise<void>;
  /** window.confirm text. In onClick, so cancelling never reaches the action. */
  confirm?: string;
  /**
   * Run just before the form is submitted, to say which button was pressed.
   *
   * Not `name`/`value` on the button, which is what HTML would use and what I reached for
   * first: React does not include a submitter's name/value when the submission goes to a
   * function action, so `mode=add` never arrived and every "add" silently behaved like the
   * "remove" that was its fallback. Setting a hidden input here is the version that works.
   */
  beforeSubmit?: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      formAction={formAction}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        beforeSubmit?.();
      }}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
