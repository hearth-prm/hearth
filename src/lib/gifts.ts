import { prisma } from "@/lib/db";
import { readableGiftsWhere } from "@/lib/access";
import { primaryEmail } from "@/lib/people";

/**
 * Reading gifts.
 *
 * Every query here goes through readableGiftsWhere, which resolves to "can you read the
 * recipient". Gifts have no access rules of their own; see the note on that clause in
 * src/lib/access.ts for why that is deliberate.
 */

/**
 * What a gift row is, once read.
 *
 * Declared rather than inferred, and that is not merely tidiness. Letting these
 * functions infer their return type from a findMany with nested includes forces the
 * checker to instantiate Prisma's deeply conditional payload type at every use site,
 * and two pages' worth of that ran the Next build worker out of heap. An explicit
 * interface is checked once, at the query, and the pages then read a plain shape.
 */
export interface GiftView {
  id: string;
  eventId: string | null;
  giverId: string;
  recipientId: string;
  description: string;
  notes: string | null;
  receivedOn: Date | null;
  thankedAt: Date | null;
  giver: { id: string; displayName: string };
  recipient: { id: string; displayName: string };
  event: { id: string; title: string; startAt: Date } | null;
}

/** Exactly the columns GiftView names, and no more. */
const giftSelect = {
  id: true,
  eventId: true,
  giverId: true,
  recipientId: true,
  description: true,
  notes: true,
  receivedOn: true,
  thankedAt: true,
  giver: { select: { id: true, displayName: true } },
  recipient: { select: { id: true, displayName: true } },
  event: { select: { id: true, title: true, startAt: true } },
};

export function listGiftsForEvent(userId: string, eventId: string): Promise<GiftView[]> {
  return prisma.gift.findMany({
    where: { AND: [readableGiftsWhere(userId), { eventId }] },
    select: giftSelect,
    orderBy: [{ recipient: { displayName: "asc" } }, { createdAt: "asc" }],
  });
}

/**
 * Both directions for one contact, in a single query.
 *
 * The OR is the whole reason giver and recipient are plain columns rather than a
 * direction flag: "gifts involving this person" is one predicate, and the caller sorts
 * them into given and received by comparing ids.
 */
export function listGiftsForPerson(userId: string, personId: string): Promise<GiftView[]> {
  return prisma.gift.findMany({
    where: {
      AND: [
        readableGiftsWhere(userId),
        { OR: [{ giverId: personId }, { recipientId: personId }] },
      ],
    },
    select: giftSelect,
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
  });
}

export interface GiftRecipientView {
  eventId: string;
  personId: string;
  person: { id: string; displayName: string };
}

export function listGiftRecipients(eventId: string): Promise<GiftRecipientView[]> {
  return prisma.eventGiftRecipient.findMany({
    where: { eventId },
    select: {
      eventId: true,
      personId: true,
      person: { select: { id: true, displayName: true } },
    },
    orderBy: { person: { displayName: "asc" } },
  });
}

/** A gift's date: its own if it has one, otherwise the day of the event it came from. */
export function giftDate(gift: {
  receivedOn: Date | null;
  event: { startAt: Date } | null;
}): Date | null {
  return gift.receivedOn ?? gift.event?.startAt ?? null;
}

export interface ThankYouGift {
  description: string;
  notes: string | null;
  giverName: string;
  giverEmail: string | null;
  giverPhone: string | null;
  giverAddress: string | null;
}

/**
 * Everything the thank-you note needs, for one recipient.
 *
 * The givers' contact details are fetched here rather than in the mail builder so the
 * access check stays in one place: the gifts are scoped, and only givers reached
 * through a scoped gift are looked up.
 */
export async function thankYouList(
  userId: string,
  recipientId: string,
  eventId: string | null,
): Promise<ThankYouGift[]> {
  const gifts = await prisma.gift.findMany({
    where: {
      AND: [
        readableGiftsWhere(userId),
        { recipientId },
        eventId ? { eventId } : { eventId: null },
      ],
    },
    include: {
      giver: {
        select: {
          displayName: true,
          contactPoints: {
            orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
            select: { kind: true, value: true, isPrimary: true, order: true },
          },
        },
      },
    },
    orderBy: [{ giver: { displayName: "asc" } }, { createdAt: "asc" }],
  });

  return gifts.map((gift) => {
    const points = gift.giver.contactPoints;
    return {
      description: gift.description,
      notes: gift.notes,
      giverName: gift.giver.displayName,
      giverEmail: primaryEmail(points.filter((p) => p.kind === "EMAIL")) ?? null,
      giverPhone: points.find((p) => p.kind === "PHONE")?.value ?? null,
      giverAddress: points.find((p) => p.kind === "ADDRESS")?.value ?? null,
    };
  });
}
