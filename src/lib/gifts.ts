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
/** One of a gift's givers. email is null when there is nowhere to send a thank-you. */
export interface GiftGiverView {
  id: string;
  displayName: string;
  email: string | null;
  /**
   * Whether this person is in the trash.
   *
   * A gift outlives the contact on either end of it: trashing somebody does not un-give what
   * they gave, so the name stays and only the link to their page goes.
   */
  deleted: boolean;
}

/** One note, as sent, and what became of it for each giver it was addressed to. */
export interface ThankYouView {
  id: string;
  message: string;
  /** together | separate | bcc — how it was addressed, as recorded at the time. */
  addressing: string;
  createdAt: Date;
  givers: {
    id: string;
    displayName: string;
    /** Null when this one never went — a bounce in a separate send leaves the rest sent. */
    sentAt: Date | null;
    error: string | null;
  }[];
}

export interface GiftRecipientView {
  id: string;
  displayName: string;
  deleted: boolean;
  /** Whether the reader may write this person's thanks; see thankableCardIds. */
  canThank: boolean;
  /** Every note this recipient has sent for this gift, newest first. */
  thankYous: ThankYouView[];
  /**
   * Givers this recipient has not successfully thanked yet.
   *
   * Derived here so the page and `has:unthanked` cannot disagree: both mean "no note has
   * actually reached this giver from this recipient", and both treat a send that failed for
   * one giver as still owed rather than as delivered.
   */
  outstandingGiverIds: string[];
}

export interface GiftView {
  id: string;
  eventId: string | null;
  description: string;
  notes: string | null;
  receivedOn: Date | null;
  /**
   * Everyone it was from.
   *
   * More than one, because a present from a couple is one present — and a thank-you for it
   * can go to all of them together or to each of them separately.
   */
  givers: GiftGiverView[];
  /**
   * Everyone it was for, each with their own thanks.
   *
   * A present shared between two children earns two notes, so the state belongs to the
   * recipient rather than to the gift — and `canThank` is per person for the same reason:
   * you may be entitled to write for one and not the other.
   */
  recipients: GiftRecipientView[];
  event: { id: string; title: string; startAt: Date } | null;
}

const emailSelect = {
  where: { kind: "EMAIL" as const },
  orderBy: [{ isPrimary: "desc" as const }, { order: "asc" as const }],
  take: 1,
  select: { value: true },
};

/** Exactly the columns GiftView names, and no more. */
const giftSelect = {
  id: true,
  eventId: true,
  description: true,
  notes: true,
  receivedOn: true,
  givers: {
    select: {
      person: {
        select: {
          id: true,
          displayName: true,
          deletedAt: true,
          contactPoints: emailSelect,
        },
      },
    },
    orderBy: { person: { displayName: "asc" as const } },
  },
  recipients: {
    select: {
      person: { select: { id: true, displayName: true, deletedAt: true } },
      thankYous: {
        select: {
          id: true,
          message: true,
          addressing: true,
          createdAt: true,
          givers: {
            select: {
              giverPersonId: true,
              sentAt: true,
              error: true,
              person: { select: { displayName: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" as const },
      },
    },
    orderBy: { person: { displayName: "asc" as const } },
  },
  event: { select: { id: true, title: true, startAt: true } },
};

type GiftRow = Omit<GiftView, "givers" | "recipients"> & {
  givers: {
    person: {
      id: string;
      displayName: string;
      deletedAt: Date | null;
      contactPoints: { value: string }[];
    };
  }[];
  recipients: {
    person: { id: string; displayName: string; deletedAt: Date | null };
    thankYous: {
      id: string;
      message: string;
      addressing: string;
      createdAt: Date;
      givers: {
        giverPersonId: string;
        sentAt: Date | null;
        error: string | null;
        person: { displayName: string };
      }[];
    }[];
  }[];
};

function toView(rows: GiftRow[], mayThankFor: Set<string>): GiftView[] {
  return rows.map((row) => {
    const giverIds = row.givers.map((g) => g.person.id);
    return {
      ...row,
      givers: row.givers.map((g) => ({
        id: g.person.id,
        displayName: g.person.displayName,
        email: g.person.contactPoints[0]?.value ?? null,
        deleted: g.person.deletedAt !== null,
      })),
      // canThank is decided once, here, from the same set the action checks — so the control
      // offered and the control accepted can never disagree.
      recipients: row.recipients.map((r) => {
        // Only a note that ACTUALLY went counts. A separate send that failed for one giver
        // leaves a row behind, and treating it as thanked would report a bounce as delivered.
        const reached = new Set(
          r.thankYous.flatMap((t) =>
            t.givers.filter((g) => g.sentAt !== null).map((g) => g.giverPersonId),
          ),
        );
        return {
          id: r.person.id,
          displayName: r.person.displayName,
          deleted: r.person.deletedAt !== null,
          canThank: mayThankFor.has(r.person.id),
          thankYous: r.thankYous.map((t) => ({
            id: t.id,
            message: t.message,
            addressing: t.addressing,
            createdAt: t.createdAt,
            givers: t.givers.map((g) => ({
              id: g.giverPersonId,
              displayName: g.person.displayName,
              sentAt: g.sentAt,
              error: g.error,
            })),
          })),
          outstandingGiverIds: giverIds.filter((id) => !reached.has(id)),
        };
      }),
    };
  });
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
 * The OR is the whole reason givers and recipients are separate relations rather than one
 * table with a direction flag: "gifts involving this person" is one predicate, and the caller
 * sorts them into given and received by looking at which side the person is on.
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
              { givers: { some: { personId } } },
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
