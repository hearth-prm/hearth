import { prisma } from "@/lib/db";
import { readableGiftsWhere } from "@/lib/access";

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
  thankYouNote: string | null;
  /** email is null when there is nowhere to send a thank-you. */
  giver: { id: string; displayName: string; email: string | null };
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
  thankYouNote: true,
  giver: {
    select: {
      id: true,
      displayName: true,
      contactPoints: {
        where: { kind: "EMAIL" as const },
        orderBy: [{ isPrimary: "desc" as const }, { order: "asc" as const }],
        take: 1,
        select: { value: true },
      },
    },
  },
  recipient: { select: { id: true, displayName: true } },
  event: { select: { id: true, title: true, startAt: true } },
};

/**
 * Flatten the giver's single email out of its row.
 *
 * Done here rather than in each page so "can this gift be thanked for" is one question
 * with one answer, asked where the gift is read.
 */
type GiftRow = Omit<GiftView, "giver"> & {
  giver: { id: string; displayName: string; contactPoints: { value: string }[] };
};

function toView(rows: GiftRow[]): GiftView[] {
  return rows.map((row) => ({
    ...row,
    giver: {
      id: row.giver.id,
      displayName: row.giver.displayName,
      email: row.giver.contactPoints[0]?.value ?? null,
    },
  }));
}

export async function listGiftsForEvent(
  userId: string,
  eventId: string,
): Promise<GiftView[]> {
  return toView(
    await prisma.gift.findMany({
      where: { AND: [readableGiftsWhere(userId), { eventId }] },
      select: giftSelect,
      orderBy: [{ recipient: { displayName: "asc" } }, { createdAt: "asc" }],
    }),
  );
}

/**
 * Both directions for one contact, in a single query.
 *
 * The OR is the whole reason giver and recipient are plain columns rather than a
 * direction flag: "gifts involving this person" is one predicate, and the caller sorts
 * them into given and received by comparing ids.
 */
export async function listGiftsForPerson(
  userId: string,
  personId: string,
): Promise<GiftView[]> {
  return toView(
    await prisma.gift.findMany({
      where: {
        AND: [
          readableGiftsWhere(userId),
          { OR: [{ giverId: personId }, { recipientId: personId }] },
        ],
      },
      select: giftSelect,
      orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    }),
  );
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
