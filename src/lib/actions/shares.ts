"use server";

import { revalidatePath } from "next/cache";
import type { ShareScope, SharePermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  readablePeopleWhere,
  requireOwnedEvent,
  requireOwnedPerson,
  requireUserForAction,
} from "@/lib/access";
import { prisma as db } from "@/lib/db";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

function parsePermission(value: string): SharePermission {
  return value === "EDIT" ? "EDIT" : "VIEW";
}

async function findRecipient(email: string) {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;
  // Case-insensitive: Google hands back whatever casing the user typed at sign-up.
  return prisma.user.findFirst({
    where: { email: { equals: normalised, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Share everything of one kind with another user.
 *
 * Kept separate from per-record sharing because it covers records added later —
 * "share my address book" is a standing intention, not a bulk operation over the
 * rows that happen to exist today.
 */
export async function shareEverything(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const scopeRaw = readString(form, "scope");
    const scope: ShareScope = scopeRaw === "ALL_EVENTS" ? "ALL_EVENTS" : "ALL_PEOPLE";
    const permission = parsePermission(readString(form, "permission"));

    const recipient = await findRecipient(readString(form, "email"));
    if (!recipient) {
      return actionError(
        "No Hearth user with that email address. They have to sign in once before anything can be shared with them.",
      );
    }
    if (recipient.id === user.id) {
      return actionError("That is your own account.");
    }

    const existing = await prisma.share.findFirst({
      where: { ownerId: user.id, withUserId: recipient.id, scope },
      select: { id: true },
    });
    if (existing) {
      await prisma.share.update({ where: { id: existing.id }, data: { permission } });
    } else {
      await prisma.share.create({
        data: { ownerId: user.id, withUserId: recipient.id, scope, permission },
      });
    }

    revalidatePath("/settings/sharing");
    return actionOk(
      `${scope === "ALL_PEOPLE" ? "Contacts" : "Events"} shared with ${recipient.email} (${permission === "EDIT" ? "can edit" : "view only"}).`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/** Share one record. Only its owner may. */
export async function shareRecord(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const personId = readString(form, "personId");
  const eventId = readString(form, "eventId");
  try {
    const user = await requireUserForAction();
    const permission = parsePermission(readString(form, "permission"));

    if (personId) await requireOwnedPerson(user.id, personId);
    else if (eventId) await requireOwnedEvent(user.id, eventId);
    else return actionError("Nothing to share.");

    const recipient = await findRecipient(readString(form, "email"));
    if (!recipient) {
      return actionError(
        "No Hearth user with that email address. They have to sign in once first.",
      );
    }
    if (recipient.id === user.id) return actionError("That is your own account.");

    const scope: ShareScope = personId ? "PERSON" : "EVENT";
    const existing = await prisma.share.findFirst({
      where: {
        ownerId: user.id,
        withUserId: recipient.id,
        scope,
        personId: personId || null,
        eventId: eventId || null,
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.share.update({ where: { id: existing.id }, data: { permission } });
    } else {
      await prisma.share.create({
        data: {
          ownerId: user.id,
          withUserId: recipient.id,
          scope,
          permission,
          personId: personId || null,
          eventId: eventId || null,
        },
      });
    }

    if (personId) revalidatePath(`/people/${personId}`);
    if (eventId) revalidatePath(`/events/${eventId}`);
    revalidatePath("/settings/sharing");
    return actionOk(`Shared with ${recipient.email}.`);
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Withdraw a share.
 *
 * Either side may: the owner revoking access, or the recipient declining it. Both
 * are legitimate, and requiring the owner to act would leave someone unable to
 * remove clutter from their own lists.
 */
/**
 * Remove Google copies the user can no longer reach.
 *
 * Called after any share change rather than being derived from which share was
 * revoked, because the two are not the same question: a recipient may hold both a
 * blanket grant and a per-record one, so losing the blanket does not necessarily
 * cost them a given contact. Asking "what can they still read?" answers it exactly,
 * and is equally correct for one revocation or a hundred.
 */
async function reapUnreachableCopies(userId: string): Promise<number> {
  const orphaned = await db.personSync.findMany({
    where: {
      userId,
      googleResourceName: { not: null },
      person: { NOT: readablePeopleWhere(userId) },
    },
    select: { id: true, googleResourceName: true, googleEtag: true },
  });
  if (orphaned.length === 0) return 0;

  await db.$transaction(async (tx) => {
    for (const link of orphaned) {
      await tx.syncTombstone.create({
        data: {
          ownerId: userId,
          target: "GOOGLE_CONTACT",
          resourceId: link.googleResourceName!,
          etag: link.googleEtag,
          reason: "opted_out",
        },
      });
    }
    // Drop the links in the same transaction: the contact is no longer theirs to
    // hold, and a stale link would let a later run try to update a contact queued
    // for deletion.
    await tx.personSync.deleteMany({ where: { id: { in: orphaned.map((o) => o.id) } } });
  });

  return orphaned.length;
}

export async function revokeShare(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  const share = await prisma.share.findFirst({
    where: { id, OR: [{ ownerId: user.id }, { withUserId: user.id }] },
    select: { id: true, personId: true, eventId: true, withUserId: true },
  });
  if (!share) return;

  const recipientId = share.withUserId;
  await prisma.share.delete({ where: { id: share.id } });

  // Withdrawing access withdraws it from their Google too: Hearth stops managing the
  // contact, so it stops existing there rather than rotting as a copy nothing
  // updates.
  await reapUnreachableCopies(recipientId);

  if (share.personId) revalidatePath(`/people/${share.personId}`);
  if (share.eventId) revalidatePath(`/events/${share.eventId}`);
  revalidatePath("/settings/sharing");
  revalidatePath("/people");
  revalidatePath("/events");
}
