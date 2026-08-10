"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { runContactSyncForUser, runEventSyncForUser } from "@/lib/sync/runner";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, toActionError } from "@/lib/actions/shared";

/**
 * Push contacts to Google now, rather than waiting for the next scheduled run.
 *
 * `force` skips the auth-error cooldown: someone who just pressed "Sync now" has
 * usually only this second finished reconnecting, and should not be told to wait
 * fifteen minutes for the cooldown the background loop uses.
 */
export async function syncContactsNow(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const outcome = await runContactSyncForUser(user.id, { force: true });

    revalidatePath("/settings");
    revalidatePath("/people");

    switch (outcome.status) {
      case "ok":
        return outcome.result.failed > 0
          ? actionError(
              `Finished with problems: ${outcome.summary}. ${outcome.result.errors[0] ?? ""}`.trim(),
            )
          : actionOk(`Sync complete — ${outcome.summary}.`);
      case "skipped":
        return actionError(`Nothing to do: ${outcome.reason}.`);
      case "busy":
        return actionError("A sync is already running. Try again in a moment.");
      case "auth":
        return actionError(outcome.message);
      case "error":
        return actionError(`Sync failed: ${outcome.message}`);
      default:
        return actionError("Sync returned an unexpected result.");
    }
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Queue every contact for a fresh push.
 *
 * Useful after changing the custom-field setting, or when Google-side edits need
 * overwriting: only records marked PENDING or ERROR are picked up, so an untouched
 * SYNCED record would otherwise never be revisited.
 */
export async function resyncAllContacts(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    // Requeues this account's copies. Contacts never yet pushed here have no row
    // and are picked up regardless, so they need no touching.
    const { count } = await prisma.personSync.updateMany({
      where: { userId: user.id, person: { addToGoogle: true } },
      data: {
        googleSyncStatus: "PENDING",
        googleSyncAttempts: 0,
        googleSyncNextAttemptAt: null,
        googleSyncError: null,
      },
    });

    revalidatePath("/settings");
    revalidatePath("/people");
    return actionOk(
      `${count} contact${count === 1 ? "" : "s"} queued. They will be pushed on the next run, or press "Sync now".`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}


/** Push events to Google now. Mirrors syncContactsNow. */
export async function syncEventsNow(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const outcome = await runEventSyncForUser(user.id, { force: true });

    revalidatePath("/settings");
    revalidatePath("/events");

    switch (outcome.status) {
      case "ok":
        return outcome.result.failed > 0
          ? actionError(
              `Finished with problems: ${outcome.summary}. ${outcome.result.errors[0] ?? ""}`.trim(),
            )
          : actionOk(`Calendar sync complete — ${outcome.summary}.`);
      case "skipped":
        return actionError(`Nothing to do: ${outcome.reason}.`);
      case "busy":
        return actionError("A sync is already running. Try again in a moment.");
      case "auth":
        return actionError(outcome.message);
      case "error":
        return actionError(`Sync failed: ${outcome.message}`);
      default:
        return actionError("Sync returned an unexpected result.");
    }
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Queue every event for a fresh push.
 *
 * Needed more often than the contacts equivalent, because an event's Google
 * payload depends on data outside the Event row: changing someone's primary email
 * changes who gets invited, but touches only the Person.
 */
export async function resyncAllEvents(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const { count } = await prisma.event.updateMany({
      where: { ownerId: user.id, addToGoogle: true },
      data: {
        googleSyncStatus: "PENDING",
        googleSyncAttempts: 0,
        googleSyncNextAttemptAt: null,
        googleSyncError: null,
      },
    });

    revalidatePath("/settings");
    revalidatePath("/events");
    return actionOk(
      `${count} event${count === 1 ? "" : "s"} queued. They will be pushed on the next run, or press "Sync now".`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
