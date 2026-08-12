"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUserForAction } from "@/lib/access";
import { PHOTO_ERROR_MESSAGES, type PhotoError } from "@/lib/photos";
import { validatePhoto } from "@/lib/photos-validate";
import { requeueEveryCopy } from "@/lib/sync/requeue";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/**
 * Setting and clearing a contact's photo.
 *
 * Anyone who can *read* the contact may set a photo, not only someone who can edit it.
 * That is deliberate and is the point of the feature: a photo is how you recognise
 * somebody, and a view-only recipient recognising them by a different picture harms
 * nobody. What they cannot do is change the OWNER's photo — their upload becomes their
 * own row, which only they and their Google account ever see.
 */

/** Which row an upload should land in: your own, always. */
async function readableContact(userId: string, personId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, ...readablePeopleWhere(userId) },
    select: { id: true, ownerId: true, addToGoogle: true },
  });
  return person;
}

export async function setPersonPhoto(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const personId = readString(form, "personId");
  try {
    const user = await requireUserForAction();
    const person = await readableContact(user.id, personId);
    if (!person) return actionError("That contact no longer exists.");

    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) {
      return actionError("Choose an image first.");
    }

    const checked = validatePhoto(Buffer.from(await file.arrayBuffer()));
    if (typeof checked === "string") {
      return actionError(PHOTO_ERROR_MESSAGES[checked as PhotoError]);
    }

    await prisma.$transaction(async (tx) => {
      await tx.personPhoto.upsert({
        where: { personId_userId: { personId, userId: user.id } },
        create: {
          personId,
          userId: user.id,
          data: checked.data,
          mimeType: checked.mimeType,
          width: checked.width,
          height: checked.height,
          etag: checked.etag,
        },
        update: {
          data: checked.data,
          mimeType: checked.mimeType,
          width: checked.width,
          height: checked.height,
          etag: checked.etag,
        },
      });

      // The owner's photo is what recipients inherit, so changing it makes every copy
      // stale. An override only changes what one account should hold — but requeueing
      // all of them is harmless and far simpler than reasoning about which accounts
      // inherit from whom, and the push is a no-op where the photo already matches.
      await requeueEveryCopy(tx, personId, person.addToGoogle);
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return actionOk("Photo saved.");
}

/**
 * Remove your photo for this contact.
 *
 * For the owner that clears the default, and recipients fall back to their own
 * override or to no photo. For a recipient it drops their override, so they go back to
 * seeing the owner's — which is why the button says "use the owner's photo" rather
 * than "delete".
 */
export async function clearPersonPhoto(form: FormData): Promise<void> {
  const personId = readString(form, "personId");
  const user = await requireUserForAction();
  const person = await readableContact(user.id, personId);
  if (!person) return;

  await prisma.$transaction(async (tx) => {
    await tx.personPhoto.deleteMany({ where: { personId, userId: user.id } });
    await requeueEveryCopy(tx, personId, person.addToGoogle);
  });

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
}
