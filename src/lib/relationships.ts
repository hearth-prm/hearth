import type { Person, Relationship, RelationshipType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SYSTEM_RELATIONSHIP_TYPES } from "@/lib/relationship-types";

/**
 * Ensure the built-in relationship types exist.
 *
 * Idempotent, and deliberately not reliant on a unique constraint: Postgres
 * treats NULLs as distinct, so @@unique([ownerId, key]) does not actually
 * prevent duplicate rows for the ownerId = null system types. We check first
 * instead. Called from prisma/seed.ts and lazily by loadRelationshipTypes so a
 * skipped seed cannot leave the app unusable.
 */
export async function ensureSystemRelationshipTypes(): Promise<void> {
  const existing = await prisma.relationshipType.findMany({
    where: { ownerId: null },
    select: { key: true },
  });
  const have = new Set(existing.map((r) => r.key));
  const missing = SYSTEM_RELATIONSHIP_TYPES.filter((t) => !have.has(t.key));
  if (missing.length === 0) return;

  await prisma.relationshipType.createMany({
    data: missing.map((t) => ({ ...t, ownerId: null })),
    skipDuplicates: true,
  });
}

/** System types plus this user's own, in display order. */
export async function loadRelationshipTypes(
  ownerId: string,
): Promise<RelationshipType[]> {
  let types = await prisma.relationshipType.findMany({
    where: { OR: [{ ownerId: null }, { ownerId }] },
    orderBy: [{ order: "asc" }, { label: "asc" }],
  });

  if (types.every((t) => t.ownerId !== null)) {
    await ensureSystemRelationshipTypes();
    types = await prisma.relationshipType.findMany({
      where: { OR: [{ ownerId: null }, { ownerId }] },
      orderBy: [{ order: "asc" }, { label: "asc" }],
    });
  }

  return types;
}

export type RelationshipWithPeople = Relationship & {
  type: RelationshipType;
  from: Pick<Person, "id" | "displayName">;
  to: Pick<Person, "id" | "displayName">;
};

export interface RelationshipView {
  id: string;
  /** How the link reads from the subject's point of view. */
  label: string;
  /** The person at the other end. */
  other: Pick<Person, "id" | "displayName">;
  notes: string | null;
  startedOn: Date | null;
  endedOn: Date | null;
}

/**
 * Render a stored relationship from one person's point of view.
 *
 * A single row serves both directions: on the `from` person's page it reads
 * "Parent of Jill", and on Jill's page the same row reads "Child of Jack".
 * This is why storing one row with an inverse label beats storing two rows —
 * there is no pair of records that can drift out of sync.
 */
export function viewFrom(
  rel: RelationshipWithPeople,
  subjectId: string,
): RelationshipView {
  const outgoing = rel.fromPersonId === subjectId;
  return {
    id: rel.id,
    label: outgoing ? rel.type.label : rel.type.inverseLabel,
    other: outgoing ? rel.to : rel.from,
    notes: rel.notes,
    startedOn: rel.startedOn,
    endedOn: rel.endedOn,
  };
}

/** Every relationship touching `personId`, from that person's perspective. */
export async function loadRelationshipsFor(
  ownerId: string,
  personId: string,
): Promise<RelationshipView[]> {
  const rels = await prisma.relationship.findMany({
    where: {
      ownerId,
      OR: [{ fromPersonId: personId }, { toPersonId: personId }],
    },
    include: {
      type: true,
      from: { select: { id: true, displayName: true } },
      to: { select: { id: true, displayName: true } },
    },
    orderBy: [{ type: { order: "asc" } }, { createdAt: "asc" }],
  });

  return rels.map((r) => viewFrom(r, personId));
}
