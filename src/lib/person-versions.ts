import type { Prisma, PersonVersionSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  sameSnapshot,
  snapshotPerson,
  type PersonSnapshot,
} from "@/lib/person-history";

/**
 * Recording a contact's history.
 *
 * One function, called by every path that changes a contact, so a new way of editing one
 * cannot quietly stop being remembered. It reads the contact back after the write rather
 * than being told what changed: the caller knows what it intended, and the database knows
 * what happened, and history should record the second.
 *
 * Nothing is written when the content matches the previous version. Sync touches updatedAt
 * and the sync columns on every push, and a history full of "nothing changed" would bury
 * the handful of entries that mean something.
 */

/** Everything a snapshot needs, in one query. */
const snapshotInclude = {
  contactPoints: true,
  labels: { include: { label: { select: { name: true } } } },
  googleEvents: true,
  googleRelations: true,
  owner: { select: { email: true } },
} as const;

export async function recordPersonVersion(
  tx: Prisma.TransactionClient,
  personId: string,
  options: { byUserId: string | null; source: PersonVersionSource },
): Promise<void> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    include: snapshotInclude,
  });
  if (!person) return;

  const next = snapshotPerson({
    person: person as unknown as Record<string, unknown>,
    contactPoints: person.contactPoints as unknown as Record<string, unknown>[],
    labels: person.labels.map((pl) => pl.label.name),
    events: person.googleEvents as unknown as Record<string, unknown>[],
    relations: person.googleRelations as unknown as Record<string, unknown>[],
    ownerEmail: person.owner.email,
  });

  const latest = await tx.personVersion.findFirst({
    where: { personId },
    orderBy: { revision: "desc" },
    select: { revision: true, content: true },
  });

  if (sameSnapshot((latest?.content ?? null) as PersonSnapshot | null, next)) return;

  await tx.personVersion.create({
    data: {
      personId,
      revision: (latest?.revision ?? 0) + 1,
      byUserId: options.byUserId,
      source: options.source,
      content: next as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Record outside a transaction.
 *
 * For callers that have already committed. Deliberately not wrapped in one of its own: a
 * history entry that fails to write must not roll back the edit it was describing, and an
 * edit is worth more than its record of itself.
 */
export function recordPersonVersionAfter(
  personId: string,
  options: { byUserId: string | null; source: PersonVersionSource },
): Promise<void> {
  return recordPersonVersion(prisma, personId, options).catch(() => undefined);
}

export interface PersonVersionRow {
  id: string;
  revision: number;
  source: PersonVersionSource;
  createdAt: Date;
  byEmail: string | null;
  content: PersonSnapshot;
}

/**
 * A contact's history, newest first.
 *
 * No access check of its own: the caller has already established that this contact is
 * readable, and a version says nothing the contact itself does not.
 */
export async function loadPersonVersions(
  personId: string,
  take = 50,
): Promise<PersonVersionRow[]> {
  const rows = await prisma.personVersion.findMany({
    where: { personId },
    orderBy: { revision: "desc" },
    take,
    select: {
      id: true,
      revision: true,
      source: true,
      createdAt: true,
      content: true,
      byUser: { select: { email: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    revision: r.revision,
    source: r.source,
    createdAt: r.createdAt,
    byEmail: r.byUser?.email ?? null,
    content: r.content as unknown as PersonSnapshot,
  }));
}
