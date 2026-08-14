"use client";

import { useActionState, useRef, useState } from "react";
import { PHOTO_MAX_EDGE } from "@/lib/photos";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, Hint } from "@/components/ui";

/**
 * Resize in the browser, then upload.
 *
 * A phone photo is several megabytes and thousands of pixels wide, none of which
 * survives being displayed at 96px. Shrinking here rather than on the server keeps a
 * native image library out of the Docker image, makes the upload fast on a slow
 * connection, and strips EXIF — including the location the photo was taken — as a side
 * effect of re-encoding, which is worth having for pictures of people.
 *
 * The server still validates independently; this is a convenience, not a control. A
 * hand-made request can send anything, so src/lib/photos.ts sniffs the bytes and
 * refuses what it does not recognise.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    // JPEG at 0.85: visually indistinguishable at this size, and a fraction of PNG for
    // a photograph. The server accepts either.
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) throw new Error("could not encode the image");
  return blob;
}

export function PhotoForm({
  action,
  personId,
  hasOwn,
  isOwner,
  ownerHasPhoto,
  clear,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  personId: string;
  /** The signed-in user has a photo row of their own for this contact. */
  hasOwn: boolean;
  /** They own the contact, so their row IS the default everyone else inherits. */
  isOwner: boolean;
  /** The owner has a photo, so clearing an override falls back to something. */
  ownerHasPhoto: boolean;
  clear: (form: FormData) => Promise<void>;
}) {
  // Clearing an override hands the viewer back the owner's picture rather than leaving
  // them with none, so the button has to promise the right thing.
  const clearingFallsBack = !isOwner && ownerHasPhoto;
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      {error ? <FormMessage message={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="personId" value={personId} />
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            setBusy(true);
            try {
              const blob = await shrink(file);
              const data = new FormData();
              data.set("personId", personId);
              data.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
              await formAction(data);
            } catch (err) {
              // Logged as well as shown: "could not be read" covers a decode failure, an
              // encode failure and a missing canvas alike, and without the detail there
              // is no way to tell which from a bug report.
              console.error("photo resize failed", err);
              setError("That image could not be read. Try a JPEG or PNG.");
            } finally {
              setBusy(false);
              // Clear the input so picking the same file again still fires onChange.
              if (input.current) input.current.value = "";
            }
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className={btnSecondary}
        >
          {busy ? "Uploading…" : hasOwn ? "Change photo" : "Add a photo"}
        </button>
      </form>

      {/* A sibling of the upload form, never a child: a <form> inside a <form> is
          invalid HTML, and React declines to submit the inner one at all. Wrapped
          together in a flex row so they still read as one control. */}
      {hasOwn ? (
        <ClearButton clear={clear} personId={personId} fallsBack={clearingFallsBack} />
      ) : null}

        <Hint label="How photos work">
          {isOwner
            ? `Resized to ${PHOTO_MAX_EDGE}px before uploading. Pushed to your Google Contacts, and to everyone you have shared this contact with, unless they have chosen their own picture.`
            : hasOwn
              ? "This is your own picture for this contact. It replaces the owner’s for you and in your Google Contacts, and does not change theirs."
              : "You are seeing the owner’s photo. Adding one of your own replaces it for you and in your Google Contacts — it does not change theirs."}
        </Hint>
      </div>
    </div>
  );
}

function ClearButton({
  clear,
  personId,
  fallsBack,
}: {
  clear: (form: FormData) => Promise<void>;
  personId: string;
  fallsBack: boolean;
}) {
  return (
    <form action={clear}>
      <input type="hidden" name="personId" value={personId} />
      <SubmitButton className={btnSecondary} pendingLabel="Removing…">
        {/* For a recipient this is not a deletion — it hands them back the owner's
            picture, which is a different promise and should read as one. */}
        {fallsBack ? "Use the owner’s photo" : "Remove photo"}
      </SubmitButton>
    </form>
  );
}
