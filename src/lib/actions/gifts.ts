"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  filterReadablePeopleIds,
  requireUserForAction,
  thankableCardIds,
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
  recipientIds: string[],
  giverId: string,
): Promise<ActionState | null> {
  if (recipientIds.length === 0) return actionError("Choose who received it.");
  if (!giverId) return actionError("Choose who gave it.");
  if (recipientIds.includes(giverId)) {
    return actionError("A gift needs two different people.");
  }
  // Every recipient, not merely one: the gift is written onto all of their records, so
  // permission for one is not permission for the rest. Throws if any is not writable.
  for (const recipientId of recipientIds) {
    await requireWritablePerson(userId, recipientId);
  }
  const seen = await filterReadablePeopleIds(userId, [giverId]);
  if (seen.length !== 1) return actionError("That person was not found.");
  return null;
}

export async function addGift(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUserForAction();

    // Several checkboxes share the name, so read them all.
    const recipientIds = [...new Set(form.getAll("recipientId").map(String).filter(Boolean))];
    const giverId = readString(form, "giverId");
    const bad = await checkPair(user.id, recipientIds, giverId);
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
        recipients: { create: recipientIds.map((personId) => ({ personId })) },
        description,
        notes: readString(form, "notes") || null,
        // An event gift takes its date from the event, so the column stays null and
        // there is one answer rather than two that can drift apart.
        receivedOn: eventId ? null : inputToDateOnly(readString(form, "receivedOn")),
      },
    });

    if (eventId) revalidatePath(`/events/${eventId}`);
    for (const personId of recipientIds) revalidatePath(`/people/${personId}`);
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
      select: {
        id: true,
        eventId: true,
        giverId: true,
        recipients: { select: { personId: true, thankedAt: true } },
      },
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

    revalidateGift(existing);
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
    select: {
      id: true,
      eventId: true,
      giverId: true,
      recipients: { select: { personId: true } },
    },
  });
  if (!existing) return;

  await prisma.gift.delete({ where: { id: existing.id } });
  revalidateGift(existing);
}

/** Every page a gift appears on: its event, its giver, and each of its recipients. */
function revalidateGift(gift: {
  eventId: string | null;
  giverId: string;
  recipients: { personId: string }[];
}): void {
  if (gift.eventId) revalidatePath(`/events/${gift.eventId}`);
  revalidatePath(`/people/${gift.giverId}`);
  for (const r of gift.recipients) revalidatePath(`/people/${r.personId}`);
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
    // Which recipient is thanking. A shared present earns a note from each of them, so
    // "thank you for this gift" is not a complete instruction on its own.
    const recipientId = readString(form, "thankAs");
    const message = readString(form, "message").trim();

    if (!message) return actionError("Write something first.");

    const gift = await prisma.gift.findFirst({
      where: { AND: [{ id: giftId }, writableGiftsWhere(user.id)] },
      select: {
        id: true,
        description: true,
        eventId: true,
        recipients: { select: { personId: true } },
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

    // Only thanks you are entitled to send. The note goes from YOUR address, so writing
    // one for a gift somebody else received sends a stranger a thank-you signed by the
    // wrong person — and being able to edit their contact is no licence to speak as them.
    // Checked here and not only in the UI: a control that is merely hidden is not one.
    const mine = gift.recipients.find((r) => r.personId === recipientId);
    if (!mine) return actionError("That person did not receive this gift.");

    const mayThankFor = await thankableCardIds(user.id);
    if (!mayThankFor.has(recipientId)) {
      return actionError(
        "That thank-you is not yours to write. The person it belongs to can allow the head of the household to write it for them, in their settings.",
      );
    }

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

    await prisma.giftRecipient.update({
      where: { giftId_personId: { giftId: gift.id, personId: recipientId } },
      data: { thankedAt: new Date(), thankYouNote: message },
    });

    revalidateGift({ ...gift, giverId: gift.giver.id });
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
