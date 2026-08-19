import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDisplayName } from "@/lib/people";

/**
 * Household cards: the contact record representing each user of the install.
 *
 * Owned by the head of the household and shared with every user — including the one each
 * card is about, which is the point rather than an accident. A card shared with you
 * lands in your Google Contacts, so your own details end up on your own phone, where its
 * "share contact" can send them to anybody.
 *
 * These are ordinary contacts with an ordinary owner and ordinary Share rows. Nothing in
 * src/lib/access.ts knows they exist, and that is deliberate: an unowned "system" contact
 * would have meant a nullable ownerId threaded through the one file the whole app's
 * authorisation funnels through, and would have left these cards with no field registry
 * and no labels, since both of those follow the owner.
 *
 * The only thing that marks them out is linkedUserId, and the only rule attached to it is
 * that you cannot delete a card while the user it represents exists.
 */

/** Cards are shared at EDIT: one its own subject cannot correct is worse than none. */
const CARD_PERMISSION = "EDIT" as const;

export async function headOfHousehold(): Promise<{ id: string; email: string | null } | null> {
  return prisma.user.findFirst({
    where: { isHeadOfHousehold: true },
    select: { id: true, email: true },
  });
}

/** Deterministic, so a card can never be created twice for one user. */
function cardId(userId: string): string {
  return `usercard_${userId}`;
}

function shareId(personId: string, withUserId: string): string {
  return `usercardshare_${personId}_${withUserId}`;
}

/**
 * Split a Google display name into given and family parts.
 *
 * Everything after the first space is the family name — wrong for some names, right for
 * most, and correctable like any other contact. A single word yields no family name at
 * all; the alternative of repeating the whole name in both columns is worse than leaving
 * one empty.
 */
export function splitName(name: string | null): { givenName: string | null; familyName: string | null } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { givenName: null, familyName: null };
  const at = trimmed.indexOf(" ");
  if (at === -1) return { givenName: trimmed, familyName: null };
  return {
    givenName: trimmed.slice(0, at),
    familyName: trimmed.slice(at + 1).trim() || null,
  };
}

/**
 * Give every household card a share with every user who does not own it.
 *
 * Run after anybody joins, because a new user needs shares for cards that already
 * existed *and* the other users need one for theirs. Expressed as "make the graph
 * correct" rather than "add the rows this event implies": the second form has to be right
 * about every event, and the first is simply idempotent.
 */
export async function reconcileCardShares(tx: Prisma.TransactionClient = prisma): Promise<number> {
  const [cards, users] = await Promise.all([
    tx.person.findMany({
      // A trashed card needs no shares. Ownership transfer below deliberately does NOT
      // filter it out: a card that comes back should belong to the current head.
      where: { linkedUserId: { not: null }, deletedAt: null },
      select: { id: true, ownerId: true, shares: { select: { withUserId: true } } },
    }),
    tx.user.findMany({ select: { id: true } }),
  ]);

  let created = 0;
  for (const card of cards) {
    const have = new Set(card.shares.map((s) => s.withUserId));
    for (const user of users) {
      // The owner needs no share; they already see it as theirs.
      if (user.id === card.ownerId || have.has(user.id)) continue;
      await tx.share.create({
        data: {
          id: shareId(card.id, user.id),
          ownerId: card.ownerId,
          withUserId: user.id,
          scope: "PERSON",
          personId: card.id,
          permission: CARD_PERMISSION,
        },
      });
      created += 1;
    }
  }
  return created;
}

/**
 * Make sure a user has a contact card, and that every card is shared with everyone.
 *
 * Called from the createUser hook, and safe to call again: the card id is derived from
 * the user id, so a second call updates rather than duplicating.
 *
 * The first user to sign in becomes head of household, because somebody has to own the
 * cards and on a fresh install there is exactly one candidate.
 */
export async function ensureContactCard(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) return;

    let head = await tx.user.findFirst({
      where: { isHeadOfHousehold: true },
      select: { id: true },
    });
    if (!head) {
      await tx.user.update({ where: { id: userId }, data: { isHeadOfHousehold: true } });
      head = { id: userId };
    }

    const parts = splitName(user.name);
    const givenName = parts.givenName ?? user.email ?? null;

    await tx.person.upsert({
      where: { id: cardId(userId) },
      create: {
        id: cardId(userId),
        ownerId: head.id,
        linkedUserId: userId,
        givenName,
        familyName: parts.familyName,
        displayName: computeDisplayName({
          givenName,
          familyName: parts.familyName,
          nickname: null,
          organization: null,
        }),
        // Seeded so the card is useful immediately rather than a name with nothing
        // attached. Editable afterwards like any other contact — Hearth does not keep
        // reasserting the Google profile over what someone has corrected.
        contactPoints: user.email
          ? { create: [{ kind: "EMAIL", value: user.email, isPrimary: true, order: 0 }] }
          : undefined,
      },
      // Nothing on update: an existing card may have been edited, and the Google profile
      // is not a better source of truth than what a person typed.
      update: {},
    });

    await reconcileCardShares(tx);
  });
}

/**
 * Hand the household over to somebody else.
 *
 * The cards move with the role, which is what "the head owns them by default" means. A
 * card someone has deliberately transferred elsewhere is left where it is: an explicit
 * choice outranks the default.
 */
export async function setHeadOfHousehold(newHeadId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { isHeadOfHousehold: true },
      select: { id: true },
    });
    if (current?.id === newHeadId) return;

    // Clear before setting: at most one row may have this true, enforced by a partial
    // unique index, so the order of these two statements is load-bearing.
    if (current) {
      await tx.user.update({ where: { id: current.id }, data: { isHeadOfHousehold: false } });
    }
    await tx.user.update({ where: { id: newHeadId }, data: { isHeadOfHousehold: true } });

    if (current) {
      const moving = await tx.person.findMany({
        where: { linkedUserId: { not: null }, ownerId: current.id },
        select: { id: true },
      });
      const ids = moving.map((m) => m.id);
      if (ids.length > 0) {
        // Shares are rebuilt rather than edited: the new owner needs none for their own
        // cards, and the old owner now needs one for each. Deleting and reconciling
        // states that in two steps instead of reasoning about four cases.
        await tx.share.deleteMany({ where: { personId: { in: ids }, scope: "PERSON" } });
        await tx.person.updateMany({
          where: { id: { in: ids } },
          data: { ownerId: newHeadId },
        });
      }
    }

    await reconcileCardShares(tx);
  });
}
