import { createHash } from "node:crypto";
import {
  MAX_PHOTO_BYTES,
  type PhotoError,
  type PhotoMime,
  type ValidPhoto,
} from "@/lib/photos";

/**
 * Server-side photo validation.
 *
 * The security boundary, not a convenience: the browser resizes before uploading, so
 * the client is the thing being validated. Nothing here trusts a declared MIME type
 * or a claimed size.
 *
 * Separate from photos.ts because that file is imported by a client component, and
 * node:crypto cannot be bundled for the browser.
 */

/** Refuse anything larger than the client should ever produce. */
const MAX_DIMENSION = 4096;

/**
 * Identify the format from the bytes themselves.
 *
 * The upload's declared content type is attacker-controlled and is not consulted:
 * a PNG header is what makes something a PNG.
 */
function sniff(data: Buffer): PhotoMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= 8 && PNG_MAGIC.every((b, i) => data[i] === b)) return "image/png";
  return null;
}

/** PNG puts width and height in the IHDR chunk, at a fixed offset. */
function pngSize(data: Buffer): { width: number; height: number } | null {
  // 8 bytes signature, 4 length, 4 "IHDR", then two big-endian uint32s.
  if (data.length < 24 || data.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * JPEG states its dimensions in a start-of-frame marker, whose position depends on
 * how much metadata precedes it — so the segments have to be walked.
 */
function jpegSize(data: Buffer): { width: number; height: number } | null {
  let i = 2; // past SOI
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) {
      i++; // resync rather than give up: padding between segments is legal
      continue;
    }
    const marker = data[i + 1]!;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = data.readUInt16BE(i + 2);
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in that range.
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    if (length < 2) return null; // malformed; a zero length would loop forever
    i += 2 + length;
  }
  return null;
}

export function validatePhoto(data: Buffer): ValidPhoto | PhotoError {
  if (data.length === 0) return "empty";
  if (data.length > MAX_PHOTO_BYTES) return "too-large";

  const mimeType = sniff(data);
  if (!mimeType) return "unsupported-type";

  const size = mimeType === "image/png" ? pngSize(data) : jpegSize(data);
  if (!size || size.width < 1 || size.height < 1) return "corrupt";
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) return "too-many-pixels";

  const owned = new Uint8Array(new ArrayBuffer(data.length));
  owned.set(data);
  return { data: owned, mimeType, ...size, etag: photoEtag(data) };
}

/**
 * Content hash, used both as the HTTP ETag and as the token in the photo's URL.
 *
 * Deriving it from the bytes rather than a timestamp means re-uploading an identical
 * photo changes nothing — the URL stays the same, the browser keeps its cached copy,
 * and the sync engine can tell that Google already has this image.
 */
export function photoEtag(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 32);
}

