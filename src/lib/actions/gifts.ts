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
import {
  buildThankYouMail,
  isAddressing,
  type Addressing,
} from "@/lib/thank-you";
import { readAttachments } from "@/lib/attachments";
import { canSendMail, sendMail } from "@/lib/google/mail";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import {
  isFrameworkError,
  readString,
  toActionError,
} from "@/lib/actions/shared";
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
  giverIds: string[],
): Promise<ActionState | null> {
  if (recipientIds.length === 0) return actionError("Choose who received it.");
  if (giverIds.length === 0) return actionError("Choose who gave it.");
  const overlap = giverIds.filter((id) => recipientIds.includes(id));
  if (overlap.length > 0) {
    return actionError(
      "Somebody cannot be both a giver and a recipient of the same gift.",
    );
  }
  // Every recipient, not merely one: the gift is written onto all of their records, so
  // permission for one is not permission for the rest. Throws if any is not writable.
  for (const recipientId of recipientIds) {
    await requireWritablePerson(userId, recipientId);
  }
  // Every giver, and only readability: recording that somebody gave a present is a change to
  // the RECIPIENT's record, so the giver need only be someone you can see.
  const seen = await filterReadablePeopleIds(userId, giverIds);
  if (seen.length !== giverIds.length) {
    return actionError("One of those people was not found.");
  }
  return null;
}

export async function addGift(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();

    // Several checkboxes share the name, so read them all.
    const recipientIds = [
      ...new Set(form.getAll("recipientId").map(String).filter(Boolean)),
    ];
    // Several givers, the same way: a present from a couple is one present.
    const giverIds = [
      ...new Set(form.getAll("giverId").map(String).filter(Boolean)),
    ];
    const bad = await checkPair(user.id, recipientIds, giverIds);
    if (bad) return bad;

    const description = readString(form, "description");
    if (!description) return actionError("Say what the gift was.");

    const eventId = readString(form, "eventId") || null;
    if (eventId) await requireWritableEvent(user.id, eventId);

    await prisma.gift.create({
      data: {
        ownerId: user.id,
        eventId,
        givers: { create: giverIds.map((personId) => ({ personId })) },
        recipients: { create: recipientIds.map((personId) => ({ personId })) },
        description,
        notes: readString(form, "notes") || null,
        // An event gift takes its date from the event, so the column stays null and
        // there is one answer rather than two that can drift apart.
        receivedOn: eventId
          ? null
          : inputToDateOnly(readString(form, "receivedOn")),
      },
    });

    if (eventId) revalidatePath(`/events/${eventId}`);
    for (const personId of [...recipientIds, ...giverIds]) {
      revalidatePath(`/people/${personId}`);
    }
    return actionOk("Gift recorded.");
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

export async function updateGift(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const id = readString(form, "giftId");

    const existing = await prisma.gift.findFirst({
      where: { AND: [{ id }, writableGiftsWhere(user.id)] },
      select: {
        id: true,
        eventId: true,
        givers: { select: { personId: true } },
        recipients: { select: { personId: true } },
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
      givers: { select: { personId: true } },
      recipients: { select: { personId: true } },
    },
  });
  if (!existing) return;

  await prisma.gift.delete({ where: { id: existing.id } });
  revalidateGift(existing);
}

/** Every page a gift appears on: its event, each of its givers, and each of its recipients. */
function revalidateGift(gift: {
  eventId: string | null;
  givers: { personId: string }[];
  recipients: { personId: string }[];
}): void {
  if (gift.eventId) revalidatePath(`/events/${gift.eventId}`);
  for (const g of gift.givers) revalidatePath(`/people/${g.personId}`);
  for (const r of gift.recipients) revalidatePath(`/people/${r.personId}`);
}

export async function addGiftRecipient(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const eventId = await requireWritableEvent(
      user.id,
      readString(form, "eventId"),
    );
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

    // Which givers this note is for. Absent means all of them, which is what the form sends
    // when there is only one and therefore no choice to make.
    // "thankGiverId", not "giverId". The gift form's own giver checkboxes already own that
    // name, and this dialog is rendered on the same page as that form — so a selector for
    // one matched both, which is exactly the collision the recipientId comment warns about
    // three hundred lines up. It cost a debugging cycle to find; renaming costs nothing.
    const askedGiverIds = [
      ...new Set(form.getAll("thankGiverId").map(String).filter(Boolean)),
    ];
    const addressingRaw = readString(form, "addressing");
    const addressing: Addressing = isAddressing(addressingRaw)
      ? addressingRaw
      : "together";

    const gift = await prisma.gift.findFirst({
      where: { AND: [{ id: giftId }, writableGiftsWhere(user.id)] },
      select: {
        id: true,
        description: true,
        eventId: true,
        givers: {
          select: {
            personId: true,
            person: {
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
        },
        recipients: { select: { personId: true } },
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

    const wanted = gift.givers.filter(
      (g) => askedGiverIds.length === 0 || askedGiverIds.includes(g.personId),
    );
    if (wanted.length === 0) return actionError("Choose who to thank.");

    // Everybody being thanked needs somewhere to send it. Refused as a whole rather than
    // sending to the reachable ones and silently dropping the rest, because a note that went
    // to two of three people while the record says all three is worse than one nobody sent.
    const unreachable = wanted.filter((g) => !g.person.contactPoints[0]?.value);
    if (unreachable.length > 0) {
      return actionError(
        `${unreachable.map((g) => g.person.displayName).join(", ")} ${
          unreachable.length === 1 ? "has" : "have"
        } no email address, so there is nowhere to send it.`,
      );
    }

    if (!(await canSendMail(user.id))) {
      return actionError(
        "Hearth needs your permission to send mail before it can do this.",
      );
    }

    const attachments = await readAttachments(form);
    if ("error" in attachments) return actionError(attachments.error);

    const targets = wanted.map((g) => ({
      personId: g.personId,
      displayName: g.person.displayName,
      email: g.person.contactPoints[0]!.value,
    }));

    // The record is created BEFORE the send, with sentAt null on every giver, and stamped as
    // each message actually goes. A send that dies halfway then leaves a truthful record —
    // two thanked, one not — instead of a note that either claims everybody or nobody. It is
    // also what makes `has:unthanked` right about a partial failure.
    const send = await prisma.thankYouSend.create({
      data: {
        giftId: gift.id,
        fromPersonId: recipientId,
        sentByUserId: user.id,
        message,
        addressing: targets.length > 1 ? addressing : "together",
        givers: {
          create: targets.map((t) => ({
            giverPersonId: t.personId,
            giftId: gift.id,
            emailUsed: t.email,
          })),
        },
        ...(attachments.files.length > 0
          ? { attachments: { create: attachments.files } }
          : {}),
      },
      select: { id: true },
    });

    const mailAttachments = attachments.files.map((f) => ({
      filename: f.filename,
      mimeType: f.mimeType,
      bytes: f.bytes,
    }));

    const sent: string[] = [];
    const failed: { name: string; message: string }[] = [];

    const stamp = async (personIds: string[], error?: string) => {
      await prisma.thankYouSendGiver.updateMany({
        where: { sendId: send.id, giverPersonId: { in: personIds } },
        data: error ? { error } : { sentAt: new Date() },
      });
    };

    if (
      targets.length === 1 ||
      addressing === "together" ||
      addressing === "bcc"
    ) {
      // One message. `together` puts everyone in To, which is what makes it read as a shared
      // note; `bcc` hides them from each other and addresses it to the sender, because Gmail
      // requires a visible recipient and a note addressed to nobody looks like spam.
      const me = await ownEmail(user.id);
      const asBcc = addressing === "bcc" && targets.length > 1;
      if (asBcc && !me) {
        return actionError(
          "Hiding the addresses needs an email address of your own to send it to, and your account has none.",
        );
      }
      try {
        await sendMail(
          user.id,
          buildThankYouMail({
            to: asBcc ? [me!] : targets.map((t) => t.email),
            bcc: asBcc ? targets.map((t) => t.email) : undefined,
            giftDescription: gift.description,
            message,
            attachments: mailAttachments,
          }),
        );
        await stamp(targets.map((t) => t.personId));
        sent.push(...targets.map((t) => t.displayName));
      } catch (err) {
        const detail = err instanceof Error ? err.message : "the send failed";
        await stamp(
          targets.map((t) => t.personId),
          detail,
        );
        failed.push(
          ...targets.map((t) => ({ name: t.displayName, message: detail })),
        );
      }
    } else {
      // Separate: the same words, one message each, so nobody sees the others' addresses.
      // One at a time, and each stamped as it goes, so a bounce on the second does not
      // discard the first.
      for (const t of targets) {
        try {
          await sendMail(
            user.id,
            buildThankYouMail({
              to: [t.email],
              giftDescription: gift.description,
              message,
              attachments: mailAttachments,
            }),
          );
          await stamp([t.personId]);
          sent.push(t.displayName);
        } catch (err) {
          const detail = err instanceof Error ? err.message : "the send failed";
          await stamp([t.personId], detail);
          failed.push({ name: t.displayName, message: detail });
        }
      }
    }

    revalidateGift({
      eventId: gift.eventId,
      givers: gift.givers.map((g) => ({ personId: g.personId })),
      recipients: gift.recipients,
    });

    if (sent.length === 0) {
      return actionError(
        `Nothing was sent. ${failed[0]?.message ?? "The send failed."}`,
      );
    }
    if (failed.length > 0) {
      // Said plainly rather than reported as success: the ones that failed are still owed a
      // note, and `has:unthanked` will keep saying so.
      return actionError(
        `Sent to ${sent.join(", ")}, but not to ${failed
          .map((f) => f.name)
          .join(", ")} — ${failed[0]!.message}`,
      );
    }
    return actionOk(
      attachments.files.length > 0
        ? `Sent to ${sent.join(", ")} with ${attachments.files.length} attachment${
            attachments.files.length === 1 ? "" : "s"
          }.`
        : `Sent to ${sent.join(", ")}.`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/** The signed-in user's own address, for a bcc note that needs a visible recipient. */
async function ownEmail(userId: string): Promise<string | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return row?.email ?? null;
}

export async function removeGiftRecipient(form: FormData): Promise<void> {
  const user = await requireUserForAction();
  const eventId = await requireWritableEvent(
    user.id,
    readString(form, "eventId"),
  );
  const personId = readString(form, "id");

  await prisma.eventGiftRecipient.deleteMany({ where: { eventId, personId } });

  // Their gifts are deliberately left alone. Removing someone from the list says
  // "they are not receiving here", not "those presents never happened", and a delete
  // that quietly took records with it would be the worse surprise.
  revalidatePath(`/events/${eventId}`);
}
