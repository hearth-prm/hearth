/**
 * Files sent with a thank-you.
 *
 * Read from the form, checked, and handed over as bytes. Stored in the database like contact
 * photos, which is what keeps the database the whole install — there is no file store to back
 * up separately, and a dump is everything.
 */

export interface ReadAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /**
   * Backed by its own ArrayBuffer, which is what Prisma's Bytes field requires.
   *
   * A Buffer is typed ArrayBufferLike, and that admits SharedArrayBuffer, which Prisma's type
   * deliberately excludes — the same reason photos.ts carries this note. Copying into a fresh
   * Uint8Array is the honest way to say "this is mine and it is not shared".
   */
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Gmail refuses a message over 25MB, and base64 inflates by a third on the way out.
 *
 * So the real ceiling on raw bytes is nearer 18MB, and that is before the note itself and the
 * headers. 15MB total leaves room and fails HERE — with a sentence saying which file and how
 * big — rather than at the API, where the same problem arrives as a 400 nobody can read.
 */
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

/** Per file, so one enormous video cannot use the whole allowance on its own. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const MAX_FILES = 5;

function human(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/**
 * A filename fit to put in a MIME header and show to somebody.
 *
 * Path separators and control characters removed: a browser sends whatever the file was called,
 * and "../../etc/passwd" is a filename as far as a form is concerned. Nothing here writes to a
 * filesystem, so this is not a path-traversal defence — it is so the header cannot be broken
 * and the name cannot lie about what it is.
 */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "attachment";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "attachment";
}

export type AttachmentsResult =
  | { files: ReadAttachment[] }
  | { error: string };

/**
 * Everything under the `attachment` field, checked as a set.
 *
 * The total matters as much as any one file, because it is the total the message carries — so
 * three 6MB photographs are refused even though each is individually fine.
 */
export async function readAttachments(form: FormData): Promise<AttachmentsResult> {
  const entries = form.getAll("attachment").filter((v): v is File => v instanceof File);
  // A file input that was left alone still submits an entry, with an empty name and no bytes.
  const chosen = entries.filter((f) => f.size > 0 && f.name !== "");
  if (chosen.length === 0) return { files: [] };

  if (chosen.length > MAX_FILES) {
    return { error: `Attach at most ${MAX_FILES} files. That was ${chosen.length}.` };
  }

  let total = 0;
  const files: ReadAttachment[] = [];
  for (const file of chosen) {
    if (file.size > MAX_FILE_BYTES) {
      return {
        error: `${safeFilename(file.name)} is ${human(file.size)}, and the limit for one file is ${human(MAX_FILE_BYTES)}.`,
      };
    }
    total += file.size;
    if (total > MAX_TOTAL_BYTES) {
      return {
        error: `Those files come to more than ${human(MAX_TOTAL_BYTES)} together, which is more than an email can carry.`,
      };
    }
    files.push({
      filename: safeFilename(file.name),
      // A browser that sends no type at all gets the generic one rather than an empty header,
      // which some clients treat as a reason to hide the attachment entirely.
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return { files };
}
