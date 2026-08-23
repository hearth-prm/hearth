"use server";

import { revalidatePath } from "next/cache";
import type { Prisma, SharePermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ownedPeopleWhere,
  requireUserForAction,
  writablePeopleWhere,
} from "@/lib/access";
import { parseFilter, peopleWhere, type RawParams } from "@/lib/people-filter";
import { genericFields, loadRegistry } from "@/lib/fields/registry";
import { fieldInputName } from "@/lib/fields/types";
import { parseOneField } from "@/lib/fields/validation";
import { partitionFieldValues, readCustomBag } from "@/lib/fields/values";
import { computeDisplayName } from "@/lib/people";
import { getUserSettings } from "@/lib/settings";
import { ensureLabel } from "@/lib/actions/labels";
import { normaliseLabelName } from "@/lib/labels";
import { recordPersonVersionAfter } from "@/lib/person-versions";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";
import { queueContactDeletionEverywhere } from "@/lib/sync/tombstones";
import { reapUnreachableCopies } from "@/lib/sync/reap";
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

/**
 * Set or clear any registry field across a selection.
 *
 * Every field, core column and custom alike, because that is what "bulk edit" has to mean to
 * be worth having — but only the ones ticked. A field nobody ticked is not written, which is
 * the difference between "set the department on these twelve" and "overwrite these twelve
 * with a mostly-empty form".
 *
 * Contact points are deliberately absent. An email or an address is a repeatable row that
 * belongs to one person; there is no sense in which two hundred contacts share one.
 *
 * Validated through parseOneField — the same schemas the single-contact form and the CSV
 * import use — because a second set of rules for bulk data is how a value the UI would have
 * refused ends up stored anyway.
 */
export async function bulkSetFields(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const registry = await loadRegistry(user.id, "PERSON");
    // genericFields, not listFields: the latter is "shown as a column in list views", which
    // is a display choice and has nothing to do with what can be edited. Using it offered
    // three fields where there should have been thirty.
    const editable = genericFields(registry).filter((d) => !d.archived);

    const ticked = new Set(form.getAll("field").map(String));
    const chosen = editable.filter((d) => ticked.has(d.key));
    if (chosen.length === 0) return actionError("Tick at least one field to change.");

    // "Clear" is asked for explicitly. An empty box on a ticked field would otherwise be
    // indistinguishable from leaving it alone, and one of those blanks a column on every
    // contact selected.
    const clearing = new Set(form.getAll("clear").map(String));

    const values: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const def of chosen) {
      if (clearing.has(def.key)) {
        if (def.required) {
          errors[def.key] = `${def.label} is required, so it cannot be cleared.`;
          continue;
        }
        values[def.key] = null;
        continue;
      }
      const raw = def.type === "MULTISELECT"
        ? form.getAll(fieldInputName(def.key)).map(String)
        : form.get(fieldInputName(def.key));
      const parsed = parseOneField(def, def.type === "BOOLEAN" ? raw !== null : raw);
      if (parsed.ok) values[def.key] = parsed.value;
      else errors[def.key] = parsed.error;
    }
    if (Object.keys(errors).length > 0) {
      return actionError("Please fix the highlighted fields.", errors);
    }

    const { ids, asked } = await selectedIds(form, user.id, writablePeopleWhere(user.id));
    if (ids.length === 0) return actionError("Nothing selected that you can edit.");

    const settings = await getUserSettings(user.id);
    const people = await prisma.person.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, custom: true, addToGoogle: true,
        givenName: true, familyName: true, nickname: true, organization: true,
      },
    });

    for (const person of people) {
      // The person's OWN bag is merged, not replaced: partitionFieldValues keeps every key
      // it is not given, so setting one custom field cannot drop the others — including the
      // archived ones that are not in the registry at all.
      const { columns, custom } = partitionFieldValues(
        chosen,
        values,
        readCustomBag(person),
        { timeZone: settings.timeZone },
      );

      // displayName is derived, so it has to be recomputed from what the row will hold
      // rather than from what it holds now.
      const nameParts = {
        givenName: (("givenName" in columns ? columns.givenName : person.givenName) ?? null) as string | null,
        familyName: (("familyName" in columns ? columns.familyName : person.familyName) ?? null) as string | null,
        nickname: (("nickname" in columns ? columns.nickname : person.nickname) ?? null) as string | null,
        organization: (("organization" in columns ? columns.organization : person.organization) ?? null) as string | null,
      };

      await prisma.$transaction(async (tx) => {
        await tx.person.update({
          where: { id: person.id },
          data: {
            ...(columns as Prisma.PersonUpdateInput),
            custom: custom as Prisma.InputJsonValue,
            displayName: computeDisplayName(nameParts),
          },
        });
        await requeueEveryCopy(tx, person.id, person.addToGoogle);
      });
      await recordPersonVersionAfter(person.id, { byUserId: user.id, source: "EDITED" });
    }

    revalidatePath("/people");
    const what = chosen.map((d) => d.label).join(", ");
    return actionOk(
      `${what} set on ${people.length} contact${people.length === 1 ? "" : "s"}.${skipped(
        asked,
        ids.length,
        "edit",
      )}`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Share, or stop sharing, a selection with other users of the install.
 *
 * Owner-only, like deleting: an EDIT grant is permission to help maintain a record, not to
 * hand it on. And per-contact, deliberately — "share everything I have" already exists as a
 * standing grant in Settings, which covers records added later. This is the other thing:
 * these fourteen, now.
 *
 * Granting needs no sync nudge. The contacts queue matches on readablePeopleWhere plus
 * "googleSyncs: none for this account", so a newly shared contact enters the recipient's
 * queue by itself. Revoking does need one, because Hearth has stopped managing their copy
 * and a copy nothing will ever update again is worse than none.
 */
export async function bulkSharePeople(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();
    const revoking = readString(form, "shareMode") === "revoke";
    const permission: SharePermission =
      readString(form, "permission") === "EDIT" ? "EDIT" : "VIEW";

    const wanted = [...new Set(form.getAll("userId").map(String).filter(Boolean))]
      .filter((id) => id !== user.id);
    if (wanted.length === 0) return actionError("Choose who to share with.");
    const recipients = await prisma.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, email: true },
    });
    if (recipients.length === 0) return actionError("Choose who to share with.");

    // Sharing is the owner's alone, so the selection narrows to what this user owns.
    const { ids, asked } = await selectedIds(form, user.id, ownedPeopleWhere(user.id));
    if (ids.length === 0) return actionError("Nothing selected that is yours to share.");

    let touched = 0;
    for (const recipient of recipients) {
      if (revoking) {
        const { count } = await prisma.share.deleteMany({
          where: {
            ownerId: user.id,
            withUserId: recipient.id,
            scope: "PERSON",
            personId: { in: ids },
          },
        });
        touched += count;
      } else {
        for (const personId of ids) {
          // Upsert by hand: the unique key here is a composite nobody declared, and an
          // existing share should have its permission updated rather than being refused.
          const existing = await prisma.share.findFirst({
            where: {
              ownerId: user.id, withUserId: recipient.id, scope: "PERSON", personId,
            },
            select: { id: true, permission: true },
          });
          if (!existing) {
            await prisma.share.create({
              data: {
                ownerId: user.id, withUserId: recipient.id, scope: "PERSON",
                permission, personId,
              },
            });
            touched += 1;
          } else if (existing.permission !== permission) {
            await prisma.share.update({
              where: { id: existing.id }, data: { permission },
            });
            touched += 1;
          }
        }
      }
    }

    if (revoking) {
      // One sweep per recipient rather than per contact: reap asks "which copies should this
      // account no longer hold", which is the same answer however many shares were withdrawn.
      for (const recipient of recipients) await reapUnreachableCopies(recipient.id);
    }

    // A blanket grant outranks anything done here, and saying so is the difference between
    // "revoked" and "revoked, and they can still see them".
    const blanket = revoking
      ? await prisma.share.findMany({
          where: {
            ownerId: user.id,
            withUserId: { in: recipients.map((r) => r.id) },
            scope: "ALL_PEOPLE",
          },
          select: { withUser: { select: { email: true } } },
        })
      : [];

    revalidatePath("/people");
    revalidatePath("/settings/sharing");
    const who = recipients.map((r) => r.email ?? "someone").join(", ");
    return actionOk(
      revoking
        ? `Stopped sharing ${touched} contact${touched === 1 ? "" : "s"} with ${who}.` +
            skipped(asked, ids.length, "share") +
            (blanket.length > 0
              ? ` Note that ${blanket
                  .map((b) => b.withUser.email ?? "someone")
                  .join(", ")} can still see all your contacts through a blanket share in Settings.`
              : "")
        : `Shared ${ids.length} contact${ids.length === 1 ? "" : "s"} with ${who}` +
            `${permission === "EDIT" ? ", who can edit them" : " to view"}.` +
            skipped(asked, ids.length, "share"),
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
