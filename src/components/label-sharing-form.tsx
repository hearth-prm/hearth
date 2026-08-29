"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { FormMessage, helpClass } from "@/components/ui";

export interface Participant {
  userId: string;
  label: string;
  permission: "NONE" | "VIEW" | "EDIT";
}

/**
 * Who a label shares its contacts with.
 *
 * Three states per person rather than a checkbox plus a select, because "no access" is a state
 * somebody has to be able to choose — the whole set is replaced on save, so a form that could
 * not express "not this person" could not withdraw anybody.
 *
 * The consequences are spelled out above the button rather than hidden behind it. Adding
 * somebody to a label with seventeen members shares seventeen contacts and puts them in that
 * person's Google Contacts, which is a lot to discover afterwards.
 */
export function LabelSharingForm({
  labelId,
  labelName,
  contactCount,
  participants,
  action,
}: {
  labelId: string;
  labelName: string;
  contactCount: number;
  participants: readonly Participant[];
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, run] = useActionState(action, EMPTY_ACTION_STATE);
  const [rows, setRows] = useState<Participant[]>([...participants]);

  const set = (userId: string, permission: Participant["permission"]) => {
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, permission } : r)));
  };
  const sharing = rows.filter((r) => r.permission !== "NONE");

  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="labelId" value={labelId} />
      {/*
        Controlled selects, and the hidden inputs derived from them. React 19 resets a form
        after its action settles and the reset lands after the re-render the revalidation
        causes — so an uncontrolled version would show the old set after a save that worked.
      */}
      {sharing.map((r) => (
        <input
          key={r.userId}
          type="hidden"
          name="participant"
          value={`${r.userId}:${r.permission}`}
        />
      ))}

      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.userId} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-sm text-neutral-700 dark:text-neutral-300">
              {r.label}
            </span>
            <div className="flex shrink-0 gap-1" role="group" aria-label={`Access for ${r.label}`}>
              {(["NONE", "VIEW", "EDIT"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set(r.userId, p)}
                  aria-pressed={r.permission === p}
                  className={`rounded px-2 py-1 text-xs transition ${
                    r.permission === p
                      ? "bg-accent-600 font-medium text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  }`}
                >
                  {p === "NONE" ? "No access" : p === "VIEW" ? "View" : "Edit"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {sharing.length > 0 ? (
        <p className={helpClass}>
          Every contact in <strong>{labelName}</strong> is shared with{" "}
          {sharing.length === 1 ? "this person" : `these ${sharing.length} people`}, and any
          contact <em>they</em> file under it is shared back with you — including the{" "}
          {contactCount === 1 ? "1 contact" : `${contactCount} contacts`} already in it. Shared
          contacts appear in the other person’s Google Contacts too, and disappear again if the
          sharing is withdrawn.
        </p>
      ) : (
        <p className={helpClass}>
          Nobody. Give somebody View or Edit to make this a shared label: contacts filed under
          it are shared automatically, in both directions.
        </p>
      )}

      <FormMessage ok={state.ok} message={state.message} />
      <SubmitButton
        className="rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-700"
        pendingLabel="Saving…"
      >
        Save sharing
      </SubmitButton>
    </form>
  );
}
