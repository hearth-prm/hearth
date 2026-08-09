"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, btnSecondary, Card, CardHeader, FormMessage } from "@/components/ui";

/**
 * Manual sync controls.
 *
 * Two separate forms because each needs its own pending state and its own
 * result message — useActionState is per-form, and a shared one would show
 * "queued 40 contacts" under a button the user never pressed.
 */
export function SyncPanel({
  title,
  description,
  noun,
  syncNow,
  resyncAll,
  enabled,
  disabledNotice,
  lastSyncAt,
  lastSummary,
  pendingCount,
  errorCount,
  timeZone,
  footnote,
}: {
  title: string;
  description: string;
  /** Plural noun for the buttons and hints, e.g. "contacts". */
  noun: string;
  syncNow: (state: ActionState, form: FormData) => Promise<ActionState>;
  resyncAll: (state: ActionState, form: FormData) => Promise<ActionState>;
  enabled: boolean;
  disabledNotice: string;
  lastSyncAt: Date | null;
  lastSummary: string | null;
  pendingCount: number;
  errorCount: number;
  timeZone: string;
  footnote?: string;
}) {
  const [nowState, nowAction] = useActionState(syncNow, EMPTY_ACTION_STATE);
  const [allState, allAction] = useActionState(resyncAll, EMPTY_ACTION_STATE);

  const formatted = lastSyncAt
    ? new Intl.DateTimeFormat(undefined, {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(lastSyncAt)
    : null;

  return (
    <Card>
      <CardHeader title={title} description={description} />

      <div className="space-y-4 px-5 py-5">
        {!enabled ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {disabledNotice}
          </p>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Last run
            </dt>
            <dd className="mt-0.5">{formatted ?? "never"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Result
            </dt>
            <dd className="mt-0.5">{lastSummary ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Queue
            </dt>
            <dd className="mt-0.5">
              {pendingCount} waiting
              {errorCount > 0 ? (
                <span className="text-rose-600 dark:text-rose-400">
                  {" "}
                  · {errorCount} failing
                </span>
              ) : null}
            </dd>
          </div>
        </dl>

        <FormMessage ok={nowState.ok} message={nowState.message} />
        <FormMessage ok={allState.ok} message={allState.message} />

        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4 dark:border-neutral-800/60">
          <form action={nowAction}>
            <SubmitButton className={btnPrimary} pendingLabel="Syncing…">
              Sync now
            </SubmitButton>
          </form>

          <form action={allAction}>
            <SubmitButton className={btnSecondary} pendingLabel="Queueing…">
              Re-queue every {noun.replace(/s$/, "")}
            </SubmitButton>
          </form>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {footnote ??
            `Only ${noun} that changed are pushed. Re-queue everything after changing what gets synced, or to overwrite edits made directly in Google.`}
        </p>
      </div>
    </Card>
  );
}
