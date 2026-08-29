import type { Prisma, SharePermission } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/**
 * Sticky shares: the shares a contact's labels imply.
 *
 * A label carries a set of participants, and the set is SYMMETRIC — a contact filed under the
 * label by any participant is shared with every other participant. Filing a contact is the
 * thing people actually do; sharing is the thing they forget.
 *
 * ## Reconcile, do not react
 *
 * Six paths put a label on a contact: the picker on a contact page, bulk labelling, CSV
 * import, the in-place Google import, ownership transfer (which clears them), and restoring
 * from the trash. A rule applied at each of those is a rule applied at five of them by next
 * spring. So there is one function, called by all of them, and it RECOMPUTES rather than
 * reacting: it works out the shares the contact's labels currently imply and makes the rows
 * match.
 *
 * That is the same choice reconcileCardShares already makes for household cards, and for the
 * same stated reason — "make the graph correct" rather than "add the rows this event implies".
 * The second form has to be right about every event; the first is simply idempotent.
 *
 * The naive alternative is worth naming because it is the obvious one and it is wrong:
 * deleting a contact's shares when a label is removed revokes access that a SECOND label still
 * implies. Recomputation gets that right without knowing it was a hazard.
 *
 * ## What it will and will not touch
 *
 * Only rows with `viaLabelId` set. A hand-made share is never raised, lowered or removed, and
 * a rule-made row coexists with it for the same pair — the access clauses test shares with
 * `some`, so two rows are additive by construction and a manual VIEW beside a rule-made EDIT
 * is simply EDIT. There is no merge logic anywhere, which is why two rows beat one.
 */

/** Deterministic, so a rule can never share one contact with one person twice. */
function stickyShareId(personId: string, withUserId: string): string {
  return `sticky_${personId}_${withUserId}`;
}

/** Least restrictive wins: edit + view = edit. */
function higher(a: SharePermission, b: SharePermission): SharePermission {
  return a === "EDIT" || b === "EDIT" ? "EDIT" : "VIEW";
}

export interface Reconciled {
  created: number;
  updated: number;
  removed: number;
  /**
   * Recipients who lost a share.
   *
   * Returned rather than handled here because withdrawing access has to withdraw it from that
   * person's Google too, and reapUnreachableCopies works outside a transaction — it writes
   * tombstones of its own. The caller reaps after committing.
   */
  lost: string[];
}

const NOTHING: Reconciled = { created: 0, updated: 0, removed: 0, lost: [] };

/**
 * Make one contact's rule-made shares match what its labels say.
 *
 * Takes a transaction client because every caller is already inside one: the labels and the
 * shares they imply have to become true together, or a failed write leaves a contact filed
 * somewhere it is not shared from.
 */
export async function reconcilePersonShares(tx: Tx, personId: string): Promise<Reconciled> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: {
      ownerId: true,
      deletedAt: true,
      labels: {
        select: {
          label: {
            select: {
              id: true,
              participants: { select: { withUserId: true, permission: true } },
            },
          },
        },
      },
      shares: {
        where: { scope: "PERSON", viaLabelId: { not: null } },
        select: { id: true, withUserId: true, permission: true, viaLabelId: true },
      },
    },
  });
  if (!person) return NOTHING;

  // A trashed contact is skipped rather than stripped. Its shares are already dormant — every
  // access clause filters deletedAt — and restoring runs this again, which is the natural
  // place for it. Stripping them would mean a restore had to guess what to put back.
  if (person.deletedAt) return NOTHING;

  /** Recipient -> the permission the labels imply, and which label decided it. */
  const implied = new Map<string, { permission: SharePermission; viaLabelId: string }>();
  for (const { label } of person.labels) {
    for (const rule of label.participants) {
      // The owner needs no share; they already see it as theirs.
      if (rule.withUserId === person.ownerId) continue;
      const existing = implied.get(rule.withUserId);
      if (!existing) {
        implied.set(rule.withUserId, { permission: rule.permission, viaLabelId: label.id });
        continue;
      }
      const next = higher(existing.permission, rule.permission);
      implied.set(rule.withUserId, {
        permission: next,
        // Provenance follows the permission that won, so "via Family" names the label that
        // actually granted what the recipient has. Where two labels imply the same
        // permission the first stays, which keeps the answer stable across runs.
        viaLabelId: next === existing.permission ? existing.viaLabelId : label.id,
      });
    }
  }

  let created = 0;
  let updated = 0;
  const have = new Map(person.shares.map((s) => [s.withUserId, s]));

  for (const [withUserId, want] of implied) {
    const row = have.get(withUserId);
    if (!row) {
      await tx.share.create({
        data: {
          id: stickyShareId(personId, withUserId),
          ownerId: person.ownerId,
          withUserId,
          scope: "PERSON",
          personId,
          permission: want.permission,
          viaLabelId: want.viaLabelId,
        },
      });
      created += 1;
      continue;
    }
    if (row.permission !== want.permission || row.viaLabelId !== want.viaLabelId) {
      await tx.share.update({
        where: { id: row.id },
        data: { permission: want.permission, viaLabelId: want.viaLabelId },
      });
      updated += 1;
    }
  }

  const stale = person.shares.filter((s) => !implied.has(s.withUserId));
  if (stale.length > 0) {
    await tx.share.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }

  return {
    created,
    updated,
    removed: stale.length,
    lost: stale.map((s) => s.withUserId),
  };
}

/**
 * The other direction: the rule itself changed.
 *
 * Adding somebody to a label's participants must reach the seventeen contacts already filed
 * under it, not only the eighteenth.
 *
 * One transaction per contact rather than one for all of them. Prisma's interactive
 * transactions time out after a few seconds and a label with three hundred members would blow
 * it — the same wall `emptyTrash` hit. Per-contact is bounded, and because each pass is a
 * recomputation an interrupted run leaves every contact it reached correct and the rest
 * exactly as they were.
 */
export async function reconcileLabelShares(labelId: string): Promise<Reconciled> {
  const links = await prisma.personLabel.findMany({
    where: { labelId, person: { deletedAt: null } },
    select: { personId: true },
  });

  const total = { created: 0, updated: 0, removed: 0, lost: [] as string[] };
  for (const { personId } of links) {
    const one = await prisma.$transaction((tx) => reconcilePersonShares(tx, personId));
    total.created += one.created;
    total.updated += one.updated;
    total.removed += one.removed;
    total.lost.push(...one.lost);
  }
  total.lost = [...new Set(total.lost)];
  return total;
}

/**
 * Withdraw from Google whatever the recipients can no longer reach.
 *
 * Separate from reconciliation and called after it commits, because reapUnreachableCopies
 * writes tombstones in a transaction of its own. It reasons BACKWARDS — "which copies should
 * this account no longer hold" — so calling it once per affected recipient is correct whether
 * one share went or a hundred.
 */
export async function reapForLostRecipients(lost: readonly string[]): Promise<void> {
  if (lost.length === 0) return;
  const { reapUnreachableCopies } = await import("@/lib/sync/reap");
  for (const userId of new Set(lost)) {
    await reapUnreachableCopies(userId);
  }
}

/**
 * Every label somebody may FILE UNDER: their own, plus sticky labels they participate in.
 *
 * A participant can use the label but not change it, and only on contacts they own — a
 * participant filing somebody else's contact would put three owners in play for one row.
 */
export function usableLabelsWhere(userId: string): Prisma.LabelWhereInput {
  return {
    OR: [{ ownerId: userId }, { participants: { some: { withUserId: userId } } }],
  };
}

/**
 * The labels that may be applied to one contact.
 *
 * Its owner's labels, plus sticky labels the contact's OWNER participates in — not the
 * labels of whoever is doing the filing. A contact carries one set of labels so it reads the
 * same to everyone who can see it, and that set has to be a function of the contact rather
 * than of the viewer.
 */
export function applicableLabelsWhere(personOwnerId: string): Prisma.LabelWhereInput {
  return usableLabelsWhere(personOwnerId);
}
