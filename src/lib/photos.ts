/**
 * Contact photo rules that both sides need.
 *
 * Deliberately free of Node imports: the upload control is a client component and
 * needs the size limit and the target dimension, so anything reaching for node:crypto
 * here would be bundled for the browser and fail the build. The validation that does
 * need Node lives in photos-validate.ts.
 *
 * Only JPEG and PNG are accepted. Both state their dimensions in a handful of header
 * bytes, so they can be measured without a decoder — which is the whole reason for the
 * narrow list. A canvas can always produce a JPEG, so nothing a browser can upload is
 * lost by refusing the rest.
 */

/** Generous for a 512px avatar; small enough that a mistake cannot fill a disk. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** What the browser resizes to before uploading. Google recommends square-ish. */
export const PHOTO_MAX_EDGE = 512;

export type PhotoMime = "image/jpeg" | "image/png";

export interface ValidPhoto {
  /**
   * Backed by its own ArrayBuffer, which is what Prisma's Bytes field requires: a
   * Buffer (or a Uint8Array built from one) is typed ArrayBufferLike, and that admits
   * SharedArrayBuffer, which Prisma's type deliberately excludes. Copying into a fresh
   * buffer here keeps the awkwardness in one place instead of a cast at every write.
   */
  data: Uint8Array<ArrayBuffer>;
  mimeType: PhotoMime;
  width: number;
  height: number;
  etag: string;
}

export type PhotoError =
  | "empty"
  | "too-large"
  | "unsupported-type"
  | "corrupt"
  | "too-many-pixels";

export const PHOTO_ERROR_MESSAGES: Record<PhotoError, string> = {
  empty: "That file is empty.",
  "too-large": `Photos must be under ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`,
  "unsupported-type": "Photos must be a JPEG or PNG.",
  corrupt: "That file is not a readable JPEG or PNG.",
  "too-many-pixels": "That image has too many pixels; try a smaller one.",
};

/** The URL a contact's photo is served from, for a given viewer's effective photo. */
export function photoUrl(personId: string, etag: string): string {
  return `/api/people/${personId}/photo?v=${etag}`;
}
