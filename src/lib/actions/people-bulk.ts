"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ownedPeopleWhere,
  requireUserForAction,
  writablePeopleWhere,
} from "@/lib/access";
import { parseFilter, peopleWhere, type RawParams } from "@/lib/people-filter";
import { ensureLabel } from "@/lib/actions/labels";
import { normaliseLabelName } from "@/lib/labels";
import { recordPersonVersionAfter } from "@/lib/person-versions";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";
import { queueContactDeletionEverywhere } from "@/lib/sync/tombstones";
import { requeueEveryCopy } from "@/lib/sync/requeue";

/**
 * Doing one thing to many contacts.
 *
 * Only operations that MEAN something in bulk. A name or an address is per person by
 * definition; labels, whether a contact belongs in Google, and deleting are the three that
 * a list of two hundred rows actually needs.
 *
 * Two ways to say which contacts. Explicit ids, from the checkboxes — or `scope=filtered`
 * plus the filter the page was showing, which is how "select all 330" works without posting
 * 330 ids through a form. The filter is re-read here rather than trusted from the browser:
 * peopleWhere already ANDs readablePeopleWhere, so the widest thing a forged request can ask
 * for is everything that request's own user may see.
 *
 * Every one of these reports what it did NOT do. A selection spanning contacts somebody
 * shared with you will contain records you may not delete, and silently doing four of five
 * things is how a bulk control loses trust.
 */

/** The contacts a bulk request is about, narrowed to what this user may act on. */
async function selectedIds(
  form: FormData,
  userId: string,
  permission: Prisma.PersonWhereInput,
): Promise<{ ids: string[]; asked: number }> {
  if (readString(form, "scope") === "filtered") {
    // Rebuilt from the same parameters the page was rendered with, so what you saw is what
    // acts. Only the filter travels through the form; the access clause is added here.
    const params: RawParams = {};
    for (const [key, value] of form.entries()) {
      if (!key.startsWith("f.")) continue;
      const name = key.slice(2);
      const existing = params[name];
      const next = String(value);
      params[name] = existing === undefined
        ? next
        : Array.isArray(existing)
          ? [...existing, next]
          : [existing, next];
    }
    const filtered = peopleWhere(parseFilter(params), userId);
    const [all, allowed] = await Promise.all([
      prisma.person.count({ where: filtered }),
      prisma.person.findMany({
        where: { AND: [filtered, permission] },
        select: { id: true },
      }),
    ]);
    return { ids: allowed.map((p) => p.id), asked: all };
  }

  const asked = [...new Set(form.getAll("personId").map(String).filter(Boolean))];
  if (asked.length === 0) return { ids: [], asked: 0 };
  const allowed = await prisma.person.findMany({
    where: { AND: [{ id: { in: asked } }, permission] },
    select: { id: true },
  });
  return { ids: allowed.map((p) => p.id), asked: asked.length };
}

function skipped(asked: number, did: number, what: string): string {
  const left = asked - did;
  return left > 0 ? ` ${left} ${left === 1 ? "was" : "were"} not yours to ${what}.` : "";
}

/**
 * Add or remove labels across a selection.
 *
 * Labels are matched BY NAME rather than by id, which is what makes a mixed selection work
 * at all: a label belongs to a contact's owner, so applying "Family" to a contact your
 * partner shared with you means their "Family", not yours. ensureLabel does that per
 * contact, exactly as the single-contact form does when you type a new one.
 */
export async function bulkLabelPeople(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const mode = readString(form, "mode") === "remove" ? "remove" : "add";

    // Chosen from the viewer's own labels, or typed. Both arrive as names.
    const names = [
      ...form.getAll("labelName").map((v) => normaliseLabelName(String(v))),
      normaliseLabelName(readString(form, "newLabel")),
    ].filter((n): n is string => Boolean(n));
    if (names.length === 0) return actionError("Choose a label first.");

    const { ids, asked } = await selectedIds(form, user.id, writablePeopleWhere(user.id));
    if (ids.length === 0) return actionError("Nothing selected that you can edit.");

    const people = await prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, ownerId: true, addToGoogle: true },
    });

    let changed = 0;
    for (const person of people) {
      await prisma.$transaction(async (tx) => {
        const labelIds: string[] = [];
        for (const name of names) {
          if (mode === "add") {
            const label = await ensureLabel(tx, person.ownerId, name);
            labelIds.push(label.id);
          } else {
            const existing = await tx.label.findFirst({
              where: { ownerId: person.ownerId, name },
              select: { id: true },
            });
            if (existing) labelIds.push(existing.id);
          }
        }
        if (labelIds.length === 0) return;

        const before = await tx.personLabel.count({
          where: { personId: person.id, labelId: { in: labelIds } },
        });
        if (mode === "add") {
          await tx.personLabel.createMany({
            data: labelIds.map((labelId) => ({ personId: person.id, labelId })),
            skipDuplicates: true,
          });
          if (before === labelIds.length) return;
        } else {
          if (before === 0) return;
          await tx.personLabel.deleteMany({
            where: { personId: person.id, labelId: { in: labelIds } },
          });
        }
        changed += 1;
        // A label is a Google group, so a change here is a change to every copy.
        await requeueEveryCopy(tx, person.id, person.addToGoogle);
      });
    }

    revalidatePath("/people");
    return actionOk(
      `${mode === "add" ? "Added" : "Removed"} ${names.join(", ")} on ${changed} contact${
        changed === 1 ? "" : "s"
      }.${skipped(asked, ids.length, "edit")}`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/** Tick or untick "Add to Google" across a selection. */
export async function bulkSetAddToGoogle(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const addToGoogle = readString(form, "addToGoogle") === "on";
    const { ids, asked } = await selectedIds(form, user.id, writablePeopleWhere(user.id));
    if (ids.length === 0) return actionError("Nothing selected that you can edit.");

    // Only the ones actually changing, so the sync is not asked to redo work and the count
    // reported is the number of contacts this altered rather than the number ticked.
    const changing = await prisma.person.findMany({
      where: { id: { in: ids }, addToGoogle: !addToGoogle },
      select: { id: true },
    });

    for (const person of changing) {
      await prisma.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: person.id },
          data: { addToGoogle },
        });
        if (addToGoogle) {
          await requeueEveryCopy(tx, person.id, true);
        } else {
          // Unticking is a request to remove the copies that exist, which is the same
          // bookkeeping a deletion needs: the resource ids die with the links.
          await queueContactDeletionEverywhere(tx, {
            personId: person.id,
            reason: "opted_out",
          });
        }
      });
    }

    revalidatePath("/people");
    return actionOk(
      `${changing.length} contact${changing.length === 1 ? "" : "s"} ${
        addToGoogle ? "will be added to" : "will be removed from"
      } Google on the next sync.${skipped(asked, ids.length, "edit")}`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Move a selection to the trash.
 *
 * Owner-only, per record, like the single delete — an EDIT share is permission to help
 * maintain a contact, not to destroy it. One transaction each rather than one around the
 * lot: each contact's tombstones and its own trashing are the pairing that must be atomic,
 * and a selection of three hundred would otherwise exceed the transaction timeout and
 * delete nothing.
 */
export async function bulkTrashPeople(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const { ids, asked } = await selectedIds(form, user.id, ownedPeopleWhere(user.id));
    if (ids.length === 0) return actionError("Nothing selected that you can delete.");

    for (const id of ids) {
      await prisma.$transaction(async (tx) => {
        await queueContactDeletionEverywhere(tx, { personId: id, reason: "deleted" });
        await tx.person.update({ where: { id }, data: { deletedAt: new Date() } });
      });
      await recordPersonVersionAfter(id, { byUserId: user.id, source: "TRASHED" });
    }

    revalidatePath("/people");
    revalidatePath("/trash");
    return actionOk(
      `${ids.length} contact${ids.length === 1 ? "" : "s"} moved to the trash.${skipped(
        asked,
        ids.length,
        "delete",
      )}`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
