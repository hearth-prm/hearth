import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { currentUser, readablePeopleWhere } from "@/lib/access";

/**
 * Serve a contact's photo, as the signed-in viewer sees it.
 *
 * A route rather than a data: URI in the page because a contact list renders up to 200
 * of them: inlining would put every image in the HTML, uncached, on every render.
 *
 * Access is checked per request against readablePeopleWhere. Photo ids are not secrets
 * to be guessed at — the URL is the contact's own id — so the only thing standing
 * between a photo and a stranger is this query.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const person = await prisma.person.findFirst({
    where: { id, ...readablePeopleWhere(user.id) },
    select: { id: true, ownerId: true },
  });
  if (!person) return new Response("Not found", { status: 404 });

  // The viewer's own photo wins over the owner's; that is the whole per-viewer rule.
  const rows = await prisma.personPhoto.findMany({
    where: { personId: id, userId: { in: [user.id, person.ownerId] } },
    select: { userId: true, data: true, mimeType: true, etag: true },
  });
  const photo = rows.find((r) => r.userId === user.id) ?? rows.find((r) => r.userId === person.ownerId);
  if (!photo) return new Response("No photo", { status: 404 });

  // The URL carries the content hash, so a hit on a matching etag can be answered
  // without sending the bytes at all.
  if (request.headers.get("if-none-match") === `"${photo.etag}"`) {
    return new Response(null, { status: 304 });
  }

  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.mimeType,
      ETag: `"${photo.etag}"`,
      // private: the same URL yields a different image for a different viewer, so a
      // shared cache must never hand one person's copy to another.
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}
