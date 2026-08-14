"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { ensureContactCard, reconcileCardShares, setHeadOfHousehold } from "@/lib/household";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/**
 * Handing the household over.
 *
 * Only the current head may do it. Not because the cards are sensitive — everyone can
 * already read and edit them — but because ownership carries the power to delete them,
 * and taking that from somebody without asking is not a thing one user should be able to
 * do to another.
 */
export async function handOverHousehold(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { isHeadOfHousehold: true },
    });
    if (!me.isHeadOfHousehold) {
      return actionError("Only the current head of the household can hand it over.");
    }

    const toUserId = readString(form, "toUserId");
    if (!toUserId) return actionError("Choose who should take it on.");
    if (toUserId === user.id) return actionError("You are already the head of the household.");

    const recipient = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, name: true, email: true },
    });
    if (!recipient) return actionError("That user no longer exists.");

    await setHeadOfHousehold(toUserId);

    revalidatePath("/settings/sharing");
    revalidatePath("/people");
    return actionOk(
      `${recipient.name ?? recipient.email} is now the head of the household, and owns everyone's contact card.`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Rebuild any missing household cards and shares.
 *
 * A repair button rather than a background job: the only ways the graph goes wrong are a
 * sign-in whose best-effort hook failed and an upgrade whose backfill was interrupted,
 * both rare and both obvious to the person looking at the page. Idempotent, so pressing
 * it when nothing is wrong does nothing.
 */
export async function repairHousehold(
  _prev: ActionState,
  _form: FormData,
): Promise<ActionState> {
  try {
    await requireUserForAction();

    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) await ensureContactCard(u.id);
    const created = await reconcileCardShares();

    revalidatePath("/settings/sharing");
    revalidatePath("/people");
    return actionOk(
      created > 0
        ? `Repaired: added ${created} missing share${created === 1 ? "" : "s"}.`
        : "Everything was already in order.",
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
