import { prisma } from "@/lib/db";

/**
 * Resolving which photo a given viewer sees.
 *
 * The owner's photo is the default and reaches everyone the contact is shared with; a
 * recipient may set their own instead. So "the photo" is always a question about a
 * (contact, viewer) pair, never about the contact alone — which is why every helper
 * here takes a viewer and why there is no `Person.photo` column to be tempted by.
 */

export interface EffectivePhoto {
  etag: string;
  mimeType: string;
  width: number;
  height: number;
  /** True when this is the viewer's own override rather than the owner's photo. */
  isOwn: boolean;
}

/** Metadata only — the bytes are fetched separately, by the route that serves them. */
export async function effectivePhotoFor(
  personId: string,
  viewerId: string,
  ownerId: string,
): Promise<EffectivePhoto | null> {
  const rows = await prisma.personPhoto.findMany({
    where: { personId, userId: { in: [viewerId, ownerId] } },
    select: { userId: true, etag: true, mimeType: true, width: true, height: true },
  });
  const own = rows.find((r) => r.userId === viewerId);
  const owners = rows.find((r) => r.userId === ownerId);
  const chosen = own ?? owners;
  if (!chosen) return null;
  return {
    etag: chosen.etag,
    mimeType: chosen.mimeType,
    width: chosen.width,
    height: chosen.height,
    isOwn: Boolean(own),
  };
}

/**
 * Effective photos for a list of contacts at once.
 *
 * One query for a whole page rather than one per row: a contact list is the main place
 * photos are rendered, and per-row lookups would make the list's cost scale with its
 * length for no reason. Bytes are deliberately not selected — a list of 200 avatars
 * must not pull 200 images through Postgres to render 200 URLs.
 */
export async function effectivePhotoMap(
  people: readonly { id: string; ownerId: string }[],
  viewerId: string,
): Promise<Map<string, EffectivePhoto>> {
  if (people.length === 0) return new Map();

  const rows = await prisma.personPhoto.findMany({
    where: {
      personId: { in: people.map((p) => p.id) },
      userId: { in: [...new Set([viewerId, ...people.map((p) => p.ownerId)])] },
    },
    select: { personId: true, userId: true, etag: true, mimeType: true, width: true, height: true },
  });

  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byPerson.get(r.personId) ?? [];
    list.push(r);
    byPerson.set(r.personId, list);
  }

  const out = new Map<string, EffectivePhoto>();
  for (const person of people) {
    const list = byPerson.get(person.id) ?? [];
    const own = list.find((r) => r.userId === viewerId);
    const owners = list.find((r) => r.userId === person.ownerId);
    const chosen = own ?? owners;
    if (chosen) {
      out.set(person.id, {
        etag: chosen.etag,
        mimeType: chosen.mimeType,
        width: chosen.width,
        height: chosen.height,
        isOwn: Boolean(own),
      });
    }
  }
  return out;
}
