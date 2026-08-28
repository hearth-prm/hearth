"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Badge, btnSecondary, Card, CardHeader, DetailRow } from "@/components/ui";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";

/**
 * The state of the semantic search index.
 *
 * Shown at all — rather than left to run quietly — because a stale index is the one failure
 * this feature has that produces no error: a contact whose vector is out of date does not
 * appear wrong, it just stops turning up. A number on this page is what turns that into
 * something somebody can see, in the same way the sync panels report what is queued.
 */
export function SearchIndexPanel({
  fresh,
  stale,
  model,
  configured,
  rebuild,
}: {
  fresh: number;
  stale: number;
  model: string;
  configured: boolean;
  rebuild: () => Promise<ActionState>;
}) {
  const [state, action] = useActionState(rebuild, EMPTY_ACTION_STATE);

  return (
    <Card>
      <CardHeader
        title="Search by meaning"
        description="Contacts are turned into vectors so semantic:nurse finds “Registered Nurse at UW Health”. Nothing leaves your network."
      />
      <div className="px-4 pb-4">
        {!configured ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Not configured. Set <code>OLLAMA_URL</code> and pull an embedding model to switch
            this on; the ordinary search works either way.
          </p>
        ) : (
          <>
            <DetailRow label="Model">
              <code className="text-xs">{model}</code>
            </DetailRow>
            <DetailRow label="Indexed">{fresh.toLocaleString()}</DetailRow>
            <DetailRow label="Waiting">
              {stale === 0 ? (
                <Badge tone="neutral">up to date</Badge>
              ) : (
                <Badge tone="amber">{stale.toLocaleString()} to index</Badge>
              )}
            </DetailRow>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Contacts are indexed in the background every few minutes. A contact with nothing
              to describe it — no notes, organisation, job, labels or gifts — is not indexed at
              all, which is why this can be fewer than your contacts.
            </p>
            <form action={action} className="mt-3">
              <SubmitButton className={btnSecondary} pendingLabel="Indexing…">
                Index now
              </SubmitButton>
            </form>
            {state.message ? (
              <p
                role="status"
                className={`mt-2 text-sm ${
                  state.ok
                    ? "text-neutral-600 dark:text-neutral-400"
                    : "text-rose-700 dark:text-rose-300"
                }`}
              >
                {state.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
