"use server";

import { revalidatePath } from "next/cache";
import { recordPersonVersionAfter } from "@/lib/person-versions";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireOwnedPerson, requireUserForAction } from "@/lib/access";
import { reapUnreachableCopies } from "@/lib/sync/reap";
import { requeueEveryCopy } from "@/lib/sync/requeue";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/**
 * Hand a contact over to another user.
 *
 * Ownership is not a label on a record — it decides which field definitions read it,
 * whose labels may be applied, who can delete it, and who can share it. So a transfer
 * has to move or drop each of those, and the ones it drops are exactly what the
 * confirmation has to warn about.
 *
 * The previous owner's own access is a choice rather than a rule, because both answers
 * are reasonable: handing over a mutual friend after a falling-out means wanting them
 * gone, while handing over a contact you simply no longer maintain does not.
 */

export type KeptAccess = "none" | "view" | "edit";

function parseKept(value: string): KeptAccess {
  return value === "view" || value === "edit" ? value : "none";
}

export async function transferOwnership(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const personId = readString(form, "personId");
  let actorId: string | null = null;
  let outcome: KeptAccess = "none";
  let givenName = "";

  try {
    const user = await requireUserForAction();
    actorId = user.id;
    // Only an owner may give a record away. An EDIT share is permission to help
    // maintain a contact, not to decide who it belongs to.
    await requireOwnedPerson(user.id, personId);

    const toUserId = readString(form, "toUserId");
    if (!toUserId) return actionError("Choose who should own this contact.");
    if (toUserId === user.id) return actionError("You already own this contact.");

    const kept = parseKept(readString(form, "kept"));
    outcome = kept;

    const recipient = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, email: true, name: true },
    });
    if (!recipient) return actionError("That user no longer exists.");

    const person = await prisma.person.findUniqueOrThrow({
      where: { id: personId },
      select: { displayName: true, addToGoogle: true },
    });

    await prisma.$transaction(async (tx) => {
      // Labels belong to the old owner and cannot describe a record they no longer
      // own. Dropping the links rather than trying to recreate them under the new
      // owner: a label is that person's own filing system, and inventing entries in it
      // is not ours to do.
      await tx.personLabel.deleteMany({ where: { personId } });

      // Shares the old owner granted move with the record, so nobody the contact was
      // shared with silently loses it. The exception is a share TO the new owner,
      // which becomes meaningless.
      await tx.share.deleteMany({
        where: { personId, scope: "PERSON", withUserId: toUserId },
      });
      await tx.share.updateMany({
        where: { personId, scope: "PERSON" },
        data: { ownerId: toUserId },
      });

      await tx.person.update({ where: { id: personId }, data: { ownerId: toUserId } });

      if (kept !== "none") {
        await tx.share.create({
          data: {
            ownerId: toUserId,
            withUserId: user.id,
            scope: "PERSON",
            personId,
            permission: kept === "edit" ? "EDIT" : "VIEW",
          },
        });
      }

      // Every copy is stale: the owner decides the field definitions and labels the
      // Google payload is built from, so all of them now render differently.
      await requeueEveryCopy(tx, personId, person.addToGoogle);
    });

    // After the commit, so the readability check sees the new ownership. With no
    // access kept this is what takes the contact out of the old owner's Google.
    await reapUnreachableCopies(user.id);

    givenName = person.displayName;
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  // A transfer changes who owns a contact, which is a change to the contact.
  await recordPersonVersionAfter(personId, { byUserId: actorId, source: "TRANSFERRED" });

  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);

  // Always redirect, never return a message. A successful transfer removes the very
  // component that would show it: the form only renders for an owner, and the point of
  // the action is that they are not one any more. With no access kept the page is not
  // even readable. Confirming on the list is the one place that survives either way.
  redirect(
    `/people?gave=${encodeURIComponent(givenName)}&kept=${outcome}`,
  );
}
