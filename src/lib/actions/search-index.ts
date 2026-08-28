"use server";

import { revalidatePath } from "next/cache";
import { requireUserForAction } from "@/lib/access";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { embeddingConfigured } from "@/lib/search/embed";
import { indexPending } from "@/lib/search/indexer";

/**
 * Build whatever is waiting, now, rather than at the next pass.
 *
 * Not scoped to the caller, and that is correct rather than lax: one vector per contact
 * serves every viewer, because the text embedded is text every reader of that contact can
 * already see. Any signed-in user asking for the index to catch up is asking for the same
 * work on the same rows. The guard is therefore "signed in", not "owns these contacts".
 *
 * A bigger bite than a scheduled pass takes: somebody pressing this button is watching, and
 * being told "96 done, 200 to go" four times is worse than waiting once.
 */
export async function rebuildSearchIndex(): Promise<ActionState> {
  await requireUserForAction();
  if (!embeddingConfigured()) {
    return actionError("No model is configured, so there is no index to build.");
  }

  const run = await indexPending(500);
  revalidatePath("/settings");

  if (run.message) {
    return actionError(
      run.embedded > 0
        ? `${run.embedded} indexed, then stopped: ${run.message}`
        : run.message,
    );
  }
  if (run.embedded === 0 && run.removed === 0) {
    return actionOk("Already up to date.");
  }
  const parts = [`${run.embedded} indexed`];
  if (run.removed > 0) parts.push(`${run.removed} cleared`);
  if (run.remaining > 0) parts.push(`${run.remaining} still to go`);
  return actionOk(`${parts.join(", ")}.`);
}
