"use server";

import { revalidatePath } from "next/cache";
import type { ShareScope, SharePermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireOwnedEvent, requireOwnedPerson, requireUserForAction } from "@/lib/access";
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
export async function revokeShare(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();

  const share = await prisma.share.findFirst({
    where: { id, OR: [{ ownerId: user.id }, { withUserId: user.id }] },
    select: { id: true, personId: true, eventId: true },
  });
  if (!share) return;

  await prisma.share.delete({ where: { id: share.id } });
  if (share.personId) revalidatePath(`/people/${share.personId}`);
  if (share.eventId) revalidatePath(`/events/${share.eventId}`);
  revalidatePath("/settings/sharing");
  revalidatePath("/people");
  revalidatePath("/events");
}
