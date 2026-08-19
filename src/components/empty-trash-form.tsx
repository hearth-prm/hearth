"use client";

import { SubmitButton } from "@/components/submit-button";
import { btnDanger } from "@/components/ui";

/**
 * Empty the whole trash in one decision.
 *
 * Thirty deleted contacts should not be thirty confirmations, so the counts go into the
 * one dialogue that is shown — "delete 30 contacts and 2 events" is something a person can
 * weigh, where "empty the trash" is a shrug. The confirm() sits in onSubmit rather than on
 * the button, so cancelling stops the action being invoked at all.
 */
export function EmptyTrashForm({
  action,
  people,
  events,
  keptCards,
}: {
  action: () => Promise<void>;
  people: number;
  events: number;
  /** Hearth users' own cards, which stay behind; named so their survival is expected. */
  keptCards: number;
}) {
  const parts = [
    people > 0 ? `${people} contact${people === 1 ? "" : "s"}` : null,
    events > 0 ? `${events} event${events === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  const confirmMessage = [
    `Permanently delete ${parts.join(" and ")}? This cannot be undone.`,
    keptCards > 0
      ? `${keptCards} Hearth user card${keptCards === 1 ? "" : "s"} will be kept — unlink ${
          keptCards === 1 ? "it" : "them"
        } in Settings → Household first.`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <form
      className="flex"
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      <SubmitButton className={btnDanger} pendingLabel="Emptying…">
        Empty trash
      </SubmitButton>
    </form>
  );
}
