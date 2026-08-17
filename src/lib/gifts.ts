import { prisma } from "@/lib/db";
import { readableGiftsWhere, thankableCardIds } from "@/lib/access";

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
export interface GiftRecipientView {
  id: string;
  displayName: string;
  thankedAt: Date | null;
  thankYouNote: string | null;
  /** Whether the reader may write this person's thanks; see thankableCardIds. */
  canThank: boolean;
}

export interface GiftView {
  id: string;
  eventId: string | null;
  giverId: string;
  description: string;
  notes: string | null;
  receivedOn: Date | null;
  /** email is null when there is nowhere to send a thank-you. */
  giver: { id: string; displayName: string; email: string | null };
  /**
   * Everyone it was for, each with their own thanks.
   *
   * A present shared between two children earns two notes, so the state belongs to the
   * pair rather than to the gift — and `canThank` is per person for the same reason:
   * you may be entitled to write for one recipient and not the other.
   */
  recipients: GiftRecipientView[];
  event: { id: string; title: string; startAt: Date } | null;
}

/** Exactly the columns GiftView names, and no more. */
const giftSelect = {
  id: true,
  eventId: true,
  giverId: true,
  description: true,
  notes: true,
  receivedOn: true,
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
  recipients: {
    select: {
      thankedAt: true,
      thankYouNote: true,
      person: { select: { id: true, displayName: true } },
    },
    orderBy: { person: { displayName: "asc" as const } },
  },
  event: { select: { id: true, title: true, startAt: true } },
};

/**
 * Flatten the giver's single email out of its row.
 *
 * Done here rather than in each page so "can this gift be thanked for" is one question
 * with one answer, asked where the gift is read.
 */
type GiftRow = Omit<GiftView, "giver" | "recipients"> & {
  giver: { id: string; displayName: string; contactPoints: { value: string }[] };
  recipients: {
    thankedAt: Date | null;
    thankYouNote: string | null;
    person: { id: string; displayName: string };
  }[];
};

function toView(rows: GiftRow[], mayThankFor: Set<string>): GiftView[] {
  return rows.map((row) => ({
    ...row,
    giver: {
      id: row.giver.id,
      displayName: row.giver.displayName,
      email: row.giver.contactPoints[0]?.value ?? null,
    },
    // Decided once, here, from the same set the action checks — so the control offered
    // and the control accepted can never disagree.
    recipients: row.recipients.map((r) => ({
      id: r.person.id,
      displayName: r.person.displayName,
      thankedAt: r.thankedAt,
      thankYouNote: r.thankYouNote,
      canThank: mayThankFor.has(r.person.id),
    })),
  }));
}

export async function listGiftsForEvent(
  userId: string,
  eventId: string,
): Promise<GiftView[]> {
  const [rows, mayThankFor] = await Promise.all([
    prisma.gift.findMany({
      where: { AND: [readableGiftsWhere(userId), { eventId }] },
      select: giftSelect,
      orderBy: { createdAt: "asc" },
    }),
    thankableCardIds(userId),
  ]);
  return toView(rows, mayThankFor);
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
  const [rows, mayThankFor] = await Promise.all([
    prisma.gift.findMany({
      where: {
        AND: [
          readableGiftsWhere(userId),
          {
            OR: [
              { giverId: personId },
              { recipients: { some: { personId } } },
            ],
          },
        ],
      },
      select: giftSelect,
      orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    }),
    thankableCardIds(userId),
  ]);
  return toView(rows, mayThankFor);
}

/** Somebody named as a recipient of gifts at an event — not a gift's own recipient. */
export interface EventGiftRecipientView {
  eventId: string;
  personId: string;
  person: { id: string; displayName: string };
}

export function listGiftRecipients(
  eventId: string,
): Promise<EventGiftRecipientView[]> {
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
