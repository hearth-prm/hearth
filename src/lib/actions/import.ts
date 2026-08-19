"use server";

import { revalidatePath } from "next/cache";
import { recordPersonVersionAfter } from "@/lib/person-versions";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { computeDisplayName, type PersonNameParts } from "@/lib/people";
import { planImport, type ImportPlan, type RowWrite } from "@/lib/contacts-import";
import { ensureLabel } from "@/lib/actions/labels";
import { requeueEveryCopy } from "@/lib/sync/requeue";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

/** Bigger than any realistic contact export, small enough to refuse a mistake. */
const MAX_CSV_BYTES = 4 * 1024 * 1024;

export interface ImportState extends ActionState {
  /** Present once a file has been read: the preview awaiting confirmation. */
  plan?: ImportPlan;
  /** The file, carried through the confirmation step. */
  csv?: string;
  applied?: { created: number; updated: number; labels: number; shares: number };
}

async function readUpload(form: FormData): Promise<string | ActionState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return actionError("Choose a CSV file to import.");
  }
  if (file.size > MAX_CSV_BYTES) {
    return actionError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_CSV_BYTES / 1024 / 1024} MB.`,
    );
  }
  return await file.text();
}

/**
 * Step one: read the file and show what would happen.
 *
 * Nothing is written. The parsed text comes back with the plan so confirming does
 * not need the file again — a second file picker after a preview is the fastest way
 * to have someone apply a different file than the one they reviewed.
 */
export async function previewImport(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  try {
    const user = await requireUserForAction();
    const csv = await readUpload(form);
    if (typeof csv !== "string") return csv;

    const plan = await planImport(user.id, csv);
    if (plan.fatal) return actionError(plan.fatal);

    return { ok: true, plan, csv };
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

/**
 * Step two: apply the plan.
 *
 * Re-plans from the same text rather than trusting a plan sent back by the browser.
 * The plan names contacts to write and users to share with, so accepting it as
 * submitted would let a hand-made request write to any record and grant access to
 * anyone — the preview is a courtesy to the user, not an authority.
 */
export async function applyImport(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  try {
    const user = await requireUserForAction();
    const csv = readString(form, "csv");
    if (!csv) return actionError("That import expired. Choose the file again.");

    const plan = await planImport(user.id, csv);
    if (plan.fatal) return actionError(plan.fatal);

    let created = 0;
    let updated = 0;
    let labelsMade = 0;
    let sharesMade = 0;

    // One transaction per row rather than one for the file: a 3,000-row import
    // inside a single transaction holds locks for its whole duration, and a failure
    // on row 2,999 would discard 2,998 good rows. Rows are independent, so partial
    // success is the useful outcome — and the report says exactly what landed.
    for (const row of plan.rows) {
      if (!row.write) continue;
      const result = await applyRow(prisma, user.id, row.write);
      if (result.createdPerson) created++;
      else updated++;
      // Per row, after its own transaction, so a row's history matches what that row
      // actually wrote — and so a failure to record cannot lose the row.
      await recordPersonVersionAfter(result.personId, {
        byUserId: user.id,
        source: "CSV_IMPORT",
      });
      labelsMade += result.labelsCreated;
      sharesMade += result.sharesCreated;
    }

    revalidatePath("/people");
    revalidatePath("/settings/labels");
    revalidatePath("/settings/sharing");

    return {
      ok: true,
      message: summarise(created, updated, labelsMade, sharesMade, plan.counts.skip),
      applied: { created, updated, labels: labelsMade, shares: sharesMade },
    };
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

function summarise(
  created: number,
  updated: number,
  labels: number,
  shares: number,
  skipped: number,
): string {
  const bits = [
    created ? `${created} contact${created === 1 ? "" : "s"} added` : "",
    updated ? `${updated} updated` : "",
    labels ? `${labels} new label${labels === 1 ? "" : "s"}` : "",
    shares ? `${shares} share${shares === 1 ? "" : "s"} granted` : "",
    skipped ? `${skipped} row${skipped === 1 ? "" : "s"} skipped` : "",
  ].filter(Boolean);
  return bits.length ? `Import finished: ${bits.join(", ")}.` : "Nothing to import.";
}

async function applyRow(
  db: typeof prisma,
  userId: string,
  write: RowWrite,
): Promise<{
  personId: string;
  createdPerson: boolean;
  labelsCreated: number;
  sharesCreated: number;
}> {
  return db.$transaction(async (tx) => {
    let labelsCreated = 0;
    let sharesCreated = 0;

    const nameParts = write.columns as PersonNameParts;
    const personId = write.personId;

    // Only columns the file actually carried are written, so a narrow CSV — say
    // just IDs and labels — cannot blank out fields it never mentioned.
    const data: Prisma.PersonUncheckedUpdateInput = { ...write.columns };
    if (write.addToGoogle !== null) data.addToGoogle = write.addToGoogle;

    let id: string;
    let createdPerson = false;

    if (personId) {
      // displayName is derived, so recompute it only when a name column was present.
      const touchesName = ["givenName", "familyName", "nickname", "organization"].some(
        (k) => k in write.columns,
      );
      if (touchesName) {
        const current = await tx.person.findUniqueOrThrow({
          where: { id: personId },
          select: { givenName: true, familyName: true, nickname: true, organization: true },
        });
        data.displayName = computeDisplayName({ ...current, ...nameParts });
      }
      if (Object.keys(write.custom).length) {
        const existing = await tx.person.findUniqueOrThrow({
          where: { id: personId },
          select: { custom: true },
        });
        const bag = { ...((existing.custom ?? {}) as Record<string, unknown>) };
        // A null means the file had that column and left the cell blank, which is a
        // request to clear it. Storing null instead of removing the key would leave
        // the bag littered with fields that read as "set to nothing".
        for (const [key, value] of Object.entries(write.custom)) {
          if (value === null) delete bag[key];
          else bag[key] = value;
        }
        data.custom = bag as Prisma.InputJsonValue;
      }
      await tx.person.update({ where: { id: personId }, data });
      id = personId;
    } else {
      const person = await tx.person.create({
        data: {
          // Spread first, then the fields the importer decides: a CSV must not be
          // able to set an owner by supplying a column named after one.
          ...(write.columns as Prisma.PersonUncheckedCreateInput),
          ownerId: userId,
          displayName: computeDisplayName(nameParts),
          // A new contact has no bag to clear, so blank cells are simply omitted.
          custom: Object.fromEntries(
            Object.entries(write.custom).filter(([, v]) => v !== null),
          ) as Prisma.InputJsonValue,
          ...(write.addToGoogle === null ? {} : { addToGoogle: write.addToGoogle }),
        },
        select: { id: true },
      });
      id = person.id;
      createdPerson = true;
    }

    if (write.contactPoints) {
      // Only the kinds present in the file are replaced; the planner has already
      // warned about the ones it is leaving alone.
      const kinds = [...new Set(write.contactPoints.map((c) => c.kind))];
      if (kinds.length) {
        await tx.contactPoint.deleteMany({ where: { personId: id, kind: { in: kinds } } });
        await tx.contactPoint.createMany({
          data: write.contactPoints.map((c, order) => ({
            personId: id,
            kind: c.kind,
            label: c.label,
            value: c.value,
            order,
            // Present only when the file had address blocks; undefined leaves the
            // column null rather than writing an empty string.
            streetAddress: c.streetAddress ?? null,
            extendedAddress: c.extendedAddress ?? null,
            city: c.city ?? null,
            region: c.region ?? null,
            postalCode: c.postalCode ?? null,
            country: c.country ?? null,
            countryCode: c.countryCode ?? null,
            poBox: c.poBox ?? null,
          })),
        });
      }
    }

    if (write.labelNames) {
      const labelIds: string[] = [];
      for (const name of write.labelNames) {
        const label = await ensureLabel(tx, write.ownerId, name);
        if (label.created) labelsCreated++;
        labelIds.push(label.id);
      }
      const stale: Prisma.PersonLabelWhereInput = labelIds.length
        ? { personId: id, labelId: { notIn: labelIds } }
        : { personId: id };
      await tx.personLabel.deleteMany({ where: stale });
      if (labelIds.length) {
        await tx.personLabel.createMany({
          data: labelIds.map((labelId) => ({ personId: id, labelId })),
          skipDuplicates: true,
        });
      }
    }

    for (const share of write.shares) {
      // Grant only: an existing share is updated to the file's permission, and a
      // share the file omits is left alone. Revoking access is never a side effect
      // of importing a spreadsheet.
      const existing = await tx.share.findFirst({
        where: { ownerId: userId, withUserId: share.userId, scope: "PERSON", personId: id },
        select: { id: true, permission: true },
      });
      if (!existing) {
        await tx.share.create({
          data: {
            ownerId: userId,
            withUserId: share.userId,
            scope: "PERSON",
            personId: id,
            permission: share.permission,
          },
        });
        sharesCreated++;
      } else if (existing.permission !== share.permission) {
        await tx.share.update({
          where: { id: existing.id },
          data: { permission: share.permission },
        });
      }
    }

    const addToGoogle =
      write.addToGoogle ??
      (
        await tx.person.findUniqueOrThrow({
          where: { id },
          select: { addToGoogle: true },
        })
      ).addToGoogle;
    await requeueEveryCopy(tx, id, addToGoogle);

    return { personId: id, createdPerson, labelsCreated, sharesCreated };
  });
}
