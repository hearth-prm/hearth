import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  isHeadOfHousehold,
  thankableCardsWhere,
  thankYouAuditCardsWhere,
} from "@/lib/access";

/**
 * The thank-yous somebody still owes.
 *
 * Until now this question only existed as `has:unthanked` in the search language and as a
 * link on whichever gift you happened to be looking at, so answering "what do I still owe"
 * meant remembering which presents there had been. It is a standing to-do list, so it gets
 * a page.
 *
 * ## One row per giver, not per gift
 *
 * A present from a couple is one present and two notes owed — you may have written to Karen
 * and not to Kenny — so the unit here is (gift, recipient card, giver). That is the same
 * unit `ThankYouSendGiver` records and the same one `has:unthanked` counts, which is why
 * the page and the search can never disagree about what is outstanding.
 *
 * ## Only a note that actually went counts
 *
 * `sentAt: null` rows exist: a separate send that failed for one giver leaves one behind.
 * Treating those as thanked would report a bounce as a note delivered, so the filter is on
 * `sentAt !== null` — the same rule as everywhere else thanks are counted.
 */
export interface OwedThankYou {
  giftId: string;
  giftDescription: string;
  receivedOn: Date | null;
  eventId: string | null;
  eventTitle: string | null;
  /** The card that owes the note. */
  fromPersonId: string;
  fromDisplayName: string;
  /** Whose list this belongs on — null only if a card lost its user, which cannot happen. */
  owedByUserId: string | null;
  owedByName: string | null;
  giverId: string;
  giverDisplayName: string;
  giverEmail: string | null;
}

export interface OwedThankYous {
  rows: OwedThankYou[];
  /** True when the viewer is a super user and this is everybody's list, not just theirs. */
  everyone: boolean;
}

export async function listThankYousOwed(
  userId: string,
): Promise<OwedThankYous> {
  const { cards, everyone } = await thankYouAuditCardsWhere(userId);
  return { rows: await owedFor(cards), everyone };
}

/**
 * The rows for one set of cards.
 *
 * Split out so the page and the nav badge share the mapping without sharing the clause: the
 * badge must not pay for every household's gifts in order to tell one person what they owe.
 */
async function owedFor(
  cards: Prisma.PersonWhereInput,
): Promise<OwedThankYou[]> {
  // Queried from the RECIPIENT side, because `GiftRecipient.thankYous` is already scoped to
  // that (gift, card) pair by its composite relation — so what has been sent for this
  // person's copy of the present arrives without a second query or a filter that would have
  // to refer back to the row it came from.
  const recipients = await prisma.giftRecipient.findMany({
    where: {
      person: cards,
      gift: { givers: { some: {} } },
    },
    select: {
      giftId: true,
      person: {
        select: {
          id: true,
          displayName: true,
          linkedUserId: true,
          linkedUser: { select: { name: true, email: true } },
        },
      },
      gift: {
        select: {
          description: true,
          receivedOn: true,
          eventId: true,
          event: { select: { title: true } },
          givers: {
            select: {
              person: {
                select: {
                  id: true,
                  displayName: true,
                  deletedAt: true,
                  contactPoints: {
                    where: { kind: "EMAIL" },
                    orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
                    take: 1,
                    select: { value: true },
                  },
                },
              },
            },
            orderBy: { person: { displayName: "asc" } },
          },
        },
      },
      thankYous: {
        select: { givers: { select: { giverPersonId: true, sentAt: true } } },
      },
    },
  });

  const rows: OwedThankYou[] = [];
  for (const r of recipients) {
    const reached = new Set(
      r.thankYous.flatMap((t) =>
        t.givers.filter((g) => g.sentAt !== null).map((g) => g.giverPersonId),
      ),
    );
    for (const g of r.gift.givers) {
      // A giver in the trash is not somebody to write to, and a note owed to them would sit
      // on this list forever with no way to clear it.
      if (g.person.deletedAt !== null) continue;
      if (reached.has(g.person.id)) continue;
      rows.push({
        giftId: r.giftId,
        giftDescription: r.gift.description,
        receivedOn: r.gift.receivedOn,
        eventId: r.gift.eventId,
        eventTitle: r.gift.event?.title ?? null,
        fromPersonId: r.person.id,
        fromDisplayName: r.person.displayName,
        owedByUserId: r.person.linkedUserId,
        owedByName:
          r.person.linkedUser?.name ?? r.person.linkedUser?.email ?? null,
        giverId: g.person.id,
        giverDisplayName: g.person.displayName,
        giverEmail: g.person.contactPoints[0]?.value ?? null,
      });
    }
  }

  // Oldest first: a note owed since last Christmas is more overdue than one from Saturday,
  // and a to-do list sorted by when it arrived is one you can work down.
  rows.sort((a, b) => {
    const at = a.receivedOn?.getTime() ?? 0;
    const bt = b.receivedOn?.getTime() ?? 0;
    if (at !== bt) return at - bt;
    return a.giverDisplayName.localeCompare(b.giverDisplayName);
  });

  return rows;
}

/**
 * Just the number, for the nav badge.
 *
 * Deliberately the viewer's OWN count even for a super user: a badge is a prompt to do
 * something, and somebody else's unwritten note is not a thing you can act on. The page
 * says whose list it is showing; the badge says what you owe.
 */
export async function countThankYousOwedByMe(userId: string): Promise<number> {
  // thankableCardsWhere, never the audit clause: a super user's badge is about their own
  // notes, so this must not widen to every household — and counting everybody's and then
  // filtering would query every gift in the install to render one number in the header.
  const isHead = await isHeadOfHousehold(userId);
  return (await owedFor(thankableCardsWhere(userId, isHead))).length;
}
