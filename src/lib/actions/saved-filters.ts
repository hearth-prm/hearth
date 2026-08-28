"use server";

import { revalidatePath } from "next/cache";
import { requireUserForAction } from "@/lib/access";
import { prisma } from "@/lib/db";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";

/**
 * Named filters, saved and removed.
 *
 * What is stored is the URL search string the list was showing. That makes saving trivially
 * correct — whatever the language grows next is already covered — and it makes restoring a
 * navigation rather than a state assignment, which is the property the rest of the filter UI
 * is built on.
 */

const MAX_NAME = 60;
/**
 * A limit on the stored search, because the thing being saved arrives from a form and a form
 * field is somebody else's to fill in. A query long enough to matter is long enough to be a
 * mistake.
 */
const MAX_SEARCH = 2_000;

export async function saveFilter(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUserForAction();

  const name = String(form.get("name") ?? "").trim();
  const search = String(form.get("search") ?? "").trim().replace(/^\?/, "");

  if (!name) return actionError("Give the filter a name.", { name: "Required" });
  if (name.length > MAX_NAME) {
    return actionError(`Keep the name under ${MAX_NAME} characters.`, { name: "Too long" });
  }
  if (!search) return actionError("There is no filter to save — the list is unfiltered.");
  if (search.length > MAX_SEARCH) return actionError("That filter is too long to save.");

  // Upsert on the name: saving twice under one name means "I have changed my mind about what
  // this filter is", not "I would like two menu entries I cannot tell apart".
  await prisma.savedFilter.upsert({
    where: { ownerId_name: { ownerId: user.id, name } },
    create: { ownerId: user.id, name, search },
    update: { search },
  });

  revalidatePath("/people");
  return actionOk(`Saved as “${name}”.`);
}

export async function deleteSavedFilter(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUserForAction();
  const id = String(form.get("id") ?? "");
  if (!id) return actionError("Nothing to remove.");

  // Scoped by owner in the WHERE rather than checked afterwards, so an id belonging to
  // somebody else deletes nothing instead of deleting theirs.
  const removed = await prisma.savedFilter.deleteMany({ where: { id, ownerId: user.id } });
  if (removed.count === 0) return actionError("That filter is already gone.");

  revalidatePath("/people");
  return actionOk("Removed.");
}
