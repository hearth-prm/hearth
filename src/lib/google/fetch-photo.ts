import { prisma } from "@/lib/db";
import { MAX_PHOTO_BYTES, PHOTO_MAX_EDGE, type ValidPhoto } from "@/lib/photos";
import { validatePhoto } from "@/lib/photos-validate";
import { sizedPhotoUrl } from "./photo-source";

/**
 * Download a contact's picture and check it is one.
 *
 * Node-only, and kept apart from photo-source.ts for that reason — the plan module is
 * imported by a page and must not drag a fetch into a browser bundle.
 *
 * Everything that comes back goes through the same validatePhoto as an upload from the
 * form. An import is not a reason to trust bytes: the URL comes from a Google contact, but
 * a contact's custom field can say anything, and this runs on the server where a
 * malformed image is a server's problem.
 */

/** Long enough for a slow CDN, short enough that 300 contacts cannot hang an import. */
const TIMEOUT_MS = 10_000;

export type PhotoFetchFailure =
  | "unreachable"
  | "not-an-image"
  | "too-large"
  | "rejected";

export async function fetchContactPhoto(
  url: string,
): Promise<ValidPhoto | PhotoFetchFailure> {
  let response: Response;
  try {
    response = await fetch(sizedPhotoUrl(url, PHOTO_MAX_EDGE), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return "unreachable";
  }
  if (!response.ok) return "unreachable";

  const type = response.headers.get("content-type") ?? "";
  if (!/^image\//i.test(type)) return "not-an-image";

  // Checked before reading and again after, because Content-Length is a claim rather than
  // a fact — a server may omit it or lie, and this is the one place the byte count is
  // decided by somebody else.
  const claimed = Number(response.headers.get("content-length") ?? "0");
  if (claimed > MAX_PHOTO_BYTES) return "too-large";

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) return "too-large";

  const checked = validatePhoto(bytes);
  return typeof checked === "string" ? "rejected" : checked;
}

/**
 * Download a picture and make it this contact's, or say why not.
 *
 * Split out of the import action so it can be driven directly by the test suite — an
 * action reads request headers and cannot be called without a request, and "the picture
 * actually landed in the database" is not something the fetch alone proves.
 *
 * Returns the failure rather than throwing: a picture that will not download is not a
 * reason to lose the contact it belonged to.
 */
export async function savePhotoFromUrl(
  personId: string,
  userId: string,
  url: string,
): Promise<"saved" | PhotoFetchFailure> {
  const photo = await fetchContactPhoto(url);
  if (typeof photo === "string") return photo;

  await prisma.personPhoto.upsert({
    where: { personId_userId: { personId, userId } },
    create: {
      personId,
      // A photo is per-viewer, and for a contact this user owns their row IS the default
      // that everyone it is shared with inherits.
      userId,
      data: photo.data,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      etag: photo.etag,
    },
    update: {
      data: photo.data,
      mimeType: photo.mimeType,
      width: photo.width,
      height: photo.height,
      etag: photo.etag,
    },
  });
  return "saved";
}
