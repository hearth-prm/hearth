"use server";

import { revalidatePath } from "next/cache";
import type { FieldEntity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { coreFieldCanBeDisabled, isValidTarget, NO_TARGET } from "@/lib/google/mapping-targets";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";

const ENTITIES: Record<string, FieldEntity> = { people: "PERSON", events: "EVENT" };

/**
 * Save the whole mapping table for one entity in a single submit.
 *
 * One form rather than a save button per row: mappings are read as a set — "what
 * goes to Google" — and reviewing them one row at a time invites leaving the page
 * half-changed.
 */
export async function updateMappings(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let slug = "";
  try {
    const user = await requireUserForAction();
    slug = readString(form, "entitySlug");
    const entity = ENTITIES[slug];
    if (!entity) return actionError("Unknown record type.");

    const registry = await loadRegistry(user.id, entity, { includeArchived: true });

    const writes: Array<{ fieldKey: string; target: string; targetKey: string | null }> = [];
    const removals: string[] = [];

    for (const def of registry) {
      if (def.core) {
        // Core fields may only be switched off, never re-pointed: their
        // destinations are structural. Read by checkbox presence, because an
        // unchecked checkbox submits nothing — so "off" is the absence of the key,
        // and a missing value here is meaningful rather than something to skip.
        if (!coreFieldCanBeDisabled(entity, def.key)) continue;
        if (form.has(`send_${def.key}`)) {
          // Back to the default: no row at all, rather than a row saying "yes".
          removals.push(def.key);
        } else {
          writes.push({ fieldKey: def.key, target: NO_TARGET, targetKey: null });
        }
        continue;
      }

      const target = readString(form, `target_${def.key}`);
      if (!target) continue;

      if (target === NO_TARGET) {
        removals.push(def.key);
        continue;
      }
      if (!isValidTarget(entity, target, def.type)) {
        return actionError(`“${def.label}” cannot be mapped to that destination.`);
      }
      const targetKey = readString(form, `key_${def.key}`) || null;
      writes.push({ fieldKey: def.key, target, targetKey });
    }

    await prisma.$transaction(async (tx) => {
      if (removals.length) {
        await tx.fieldMapping.deleteMany({
          where: { ownerId: user.id, entity, fieldKey: { in: removals } },
        });
      }
      for (const w of writes) {
        await tx.fieldMapping.upsert({
          where: {
            ownerId_entity_fieldKey: { ownerId: user.id, entity, fieldKey: w.fieldKey },
          },
          create: { ownerId: user.id, entity, ...w },
          update: { target: w.target, targetKey: w.targetKey },
        });
      }
    });

    // Changing where a field goes changes what every record should look like in
    // Google, but touches no record — so nothing would be re-pushed without this.
    const requeued =
      entity === "PERSON"
        ? // Every account holding a copy: the owner's mappings decide how the
          // contact looks everywhere, so all copies are now stale.
          await prisma.personSync.updateMany({
            where: { person: { ownerId: user.id, addToGoogle: true } },
            data: { googleSyncStatus: "PENDING", googleSyncAttempts: 0, googleSyncNextAttemptAt: null },
          })
        : await prisma.event.updateMany({
            where: { ownerId: user.id, addToGoogle: true },
            data: { googleSyncStatus: "PENDING", googleSyncAttempts: 0, googleSyncNextAttemptAt: null },
          });

    revalidatePath(`/settings/mappings/${slug}`);
    return actionOk(
      `Mappings saved. ${requeued.count} record${requeued.count === 1 ? "" : "s"} queued for a fresh push.`,
    );
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
