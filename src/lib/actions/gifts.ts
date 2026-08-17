"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  filterReadablePeopleIds,
  requireUserForAction,
  requireWritableEvent,
  requireWritablePerson,
  writableGiftsWhere,
} from "@/lib/access";
import { buildThankYouMail } from "@/lib/thank-you";
import { canSendMail, sendMail } from "@/lib/google/mail";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";
import { inputToDateOnly } from "@/lib/time";

/**
 * Gift actions.
 *
 * Two access questions, asked separately every time. Recording that someone gave a
 * present is a change to the RECIPIENT's record, so it needs write access to them —
 * while the giver only has to be someone you can see. Collapsing the two into one check
 * would either stop you recording a gift from a contact you cannot edit (most of them)
 * or let you write to a household you have no business writing to.
 */

async function checkPair(
  userId: string,
  recipientId: string,
  giverId: string,
): Promise<ActionState | null> {
  if (!recipientId) return actionError("Choose who received it.");
  if (!giverId) return actionError("Choose who gave it.");
  if (recipientId === giverId) {
    return actionError("A gift needs two different people.");
  }
  // Throws if the recipient is not writable.
  await requireWritablePerson(userId, recipientId);
  const seen = await filterReadablePeopleIds(userId, [giverId]);
  if (seen.length !== 1) return actionError("That person was not found.");
  return null;
}

export async function addGift(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUserForAction();

    const recipientId = readString(form, "recipientId");
    const giverId = readString(form, "giverId");
    const bad = await checkPair(user.id, recipientId, giverId);
    if (bad) return bad;

    const description = readString(form, "description");
    if (!description) return actionError("Say what the gift was.");

    const eventId = readString(form, "eventId") || null;
    if (eventId) await requireWritableEvent(user.id, eventId);

    await prisma.gift.create({
      data: {
        ownerId: user.id,
        eventId,
        giverId,
        recipientId,
        description,
        notes: readString(form, "notes") || null,
        // An event gift takes its date from the event, so the column stays null and
        // there is one answer rather than two that can drift apart.
        receivedOn: eventId ? null : inputToDateOnly(readString(form, "receivedOn")),
      },
    });

    revalidatePath(eventId ? `/events/${eventId}` : `/people/${recipientId}`);
    revalidatePath(`/people/${giverId}`);
    return actionOk("Gift recorded.");
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

export async function updateGift(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const id = readString(form, "giftId");

    const existing = await prisma.gift.findFirst({
      where: { AND: [{ id }, writableGiftsWhere(user.id)] },
      select: { id: true, eventId: true, giverId: true, recipientId: true },
    });
    if (!existing) return actionError("That gift was not found.");

    const description = readString(form, "description");
    if (!description) return actionError("Say what the gift was.");

    await prisma.gift.update({
      where: { id: existing.id },
      data: {
        description,
        notes: readString(form, "notes") || null,
        receivedOn: existing.eventId
          ? null
          : inputToDateOnly(readString(form, "receivedOn")),
      },
    });

    revalidatePath(
      existing.eventId ? `/events/${existing.eventId}` : `/people/${existing.recipientId}`,
    );
    revalidatePath(`/people/${existing.giverId}`);
    return actionOk("Gift updated.");
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

export async function removeGift(form: FormData): Promise<void> {
  const user = await requireUserForAction();
  const id = readString(form, "id");

  const existing = await prisma.gift.findFirst({
    where: { AND: [{ id }, writableGiftsWhere(user.id)] },
    select: { id: true, eventId: true, giverId: true, recipientId: true },
  });
  if (!existing) return;

  await prisma.gift.delete({ where: { id: existing.id } });

  revalidatePath(
    existing.eventId ? `/events/${existing.eventId}` : `/people/${existing.recipientId}`,
  );
  revalidatePath(`/people/${existing.giverId}`);
}

export async function addGiftRecipient(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const eventId = await requireWritableEvent(user.id, readString(form, "eventId"));
    const personId = readString(form, "personId");
    if (!personId) return actionError("Choose who the gifts are for.");

    // Read access is the right bar here: naming somebody a recipient records nothing
    // on their contact, and the gifts themselves are checked when they are added.
    const seen = await filterReadablePeopleIds(user.id, [personId]);
    if (seen.length !== 1) return actionError("That person was not found.");

    // Idempotent: adding the same person twice is a double-click, not an error.
    await prisma.eventGiftRecipient.upsert({
      where: { eventId_personId: { eventId, personId } },
      create: { eventId, personId },
      update: {},
    });

    revalidatePath(`/events/${eventId}`);
    return actionOk("Added to the gift list.");
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Write a thank-you to the giver, and record that it went.
 *
 * The note is sent AS the signed-in user, to the person who gave the gift. That is the
 * inversion this replaced: Hearth used to email the recipient a list so they could go
 * and write thank-yous somewhere else, which is a reminder rather than a thank-you.
 *
 * thankedAt is set only after the send returns, and there is no checkbox anywhere:
 * Hearth did the sending, so it knows, and a mark you have to remember to tick is a mark
 * that goes stale. The note is kept so the record says what was said.
 */
export async function sendThankYouNote(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const giftId = readString(form, "giftId");
    const message = readString(form, "message").trim();

    if (!message) return actionError("Write something first.");

    const gift = await prisma.gift.findFirst({
      where: { AND: [{ id: giftId }, writableGiftsWhere(user.id)] },
      select: {
        id: true,
        description: true,
        eventId: true,
        recipientId: true,
        giver: {
          select: {
            id: true,
            displayName: true,
            contactPoints: {
              where: { kind: "EMAIL" },
              orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
              take: 1,
              select: { value: true },
            },
          },
        },
      },
    });
    if (!gift) return actionError("That gift was not found.");

    const to = gift.giver.contactPoints[0]?.value;
    if (!to) {
      return actionError(
        `${gift.giver.displayName} has no email address, so there is nowhere to send it.`,
      );
    }

    if (!(await canSendMail(user.id))) {
      return actionError(
        "Hearth needs your permission to send mail before it can do this.",
      );
    }

    await sendMail(
      user.id,
      buildThankYouMail({ to, giftDescription: gift.description, message }),
    );

    await prisma.gift.update({
      where: { id: gift.id },
      data: { thankedAt: new Date(), thankYouNote: message },
    });

    revalidatePath(
      gift.eventId ? `/events/${gift.eventId}` : `/people/${gift.recipientId}`,
    );
    revalidatePath(`/people/${gift.giver.id}`);
    return actionOk(`Sent to ${to}.`);
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

export async function removeGiftRecipient(form: FormData): Promise<void> {
  const user = await requireUserForAction();
  const eventId = await requireWritableEvent(user.id, readString(form, "eventId"));
  const personId = readString(form, "id");

  await prisma.eventGiftRecipient.deleteMany({ where: { eventId, personId } });

  // Their gifts are deliberately left alone. Removing someone from the list says
  // "they are not receiving here", not "those presents never happened", and a delete
  // that quietly took records with it would be the worse surprise.
  revalidatePath(`/events/${eventId}`);
}
