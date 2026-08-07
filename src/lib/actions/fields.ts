"use server";

import { revalidatePath } from "next/cache";
import type { FieldEntity, FieldType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { reservedFieldKeys } from "@/lib/fields/core";
import { nextCustomFieldOrder } from "@/lib/fields/registry";
import { FIELD_TYPES, takesOptions, toFieldKey } from "@/lib/fields/types";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";

const ENTITIES = ["PERSON", "EVENT"] as const satisfies readonly FieldEntity[];

function parseEntity(value: string): FieldEntity | null {
  return (ENTITIES as readonly string[]).includes(value)
    ? (value as FieldEntity)
    : null;
}

function parseType(value: string): FieldType | null {
  return (FIELD_TYPES as readonly string[]).includes(value)
    ? (value as FieldType)
    : null;
}

/** One choice per line; blank lines and duplicates dropped, order preserved. */
function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const v = line.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function settingsPath(entity: FieldEntity): string {
  return `/settings/fields/${entity === "PERSON" ? "people" : "events"}`;
}

export async function createFieldDefinition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let entity: FieldEntity | null = null;
  try {
    const user = await requireUserForAction();

    entity = parseEntity(readString(form, "entity"));
    if (!entity) return actionError("Unknown record type.");

    const type = parseType(readString(form, "type"));
    if (!type) return actionError("Choose a field type.");

    const label = readString(form, "label");
    if (!label) return actionError("Give the field a label.");
    if (label.length > 80) return actionError("Labels must be under 80 characters.");

    const key = toFieldKey(readString(form, "key") || label);
    if (!key) {
      return actionError("That label cannot be turned into a field name. Use letters and numbers.");
    }
    if (reservedFieldKeys(entity).has(key)) {
      return actionError(`"${key}" is a built-in field name. Pick another label.`);
    }

    const existing = await prisma.fieldDefinition.findUnique({
      where: { ownerId_entity_key: { ownerId: user.id, entity, key } },
      select: { id: true, archived: true },
    });
    if (existing) {
      return actionError(
        existing.archived
          ? `An archived field already uses the name "${key}". Restore or delete it first.`
          : `A field named "${key}" already exists.`,
      );
    }

    const options = parseOptions(readString(form, "options"));
    if (takesOptions(type) && options.length === 0) {
      return actionError("Add at least one choice for a choice field.");
    }

    await prisma.fieldDefinition.create({
      data: {
        ownerId: user.id,
        entity,
        key,
        label,
        type,
        options: takesOptions(type) ? options : [],
        helpText: readString(form, "helpText") || null,
        required: readCheckbox(form, "required"),
        showInList: readCheckbox(form, "showInList"),
        order: await nextCustomFieldOrder(user.id, entity),
      },
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath(settingsPath(entity));
  return actionOk("Field added.");
}

/**
 * Edit a field's presentation.
 *
 * `key` and `type` are deliberately immutable: values already stored in JSONB
 * were validated against the old type and live under the old key, so changing
 * either would silently invalidate or orphan existing data. Users who need a
 * different type delete the field (which strips its values) and add a new one.
 */
export async function updateFieldDefinition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let entity: FieldEntity | null = null;
  try {
    const user = await requireUserForAction();
    const id = readString(form, "id");

    const existing = await prisma.fieldDefinition.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, entity: true, type: true },
    });
    if (!existing) return actionError("That field was not found.");
    entity = existing.entity;

    const label = readString(form, "label");
    if (!label) return actionError("Give the field a label.");

    const options = parseOptions(readString(form, "options"));
    if (takesOptions(existing.type) && options.length === 0) {
      return actionError("Add at least one choice for a choice field.");
    }

    const orderRaw = readString(form, "order");
    const order = Number.parseInt(orderRaw, 10);

    await prisma.fieldDefinition.update({
      where: { id: existing.id },
      data: {
        label,
        options: takesOptions(existing.type) ? options : [],
        helpText: readString(form, "helpText") || null,
        required: readCheckbox(form, "required"),
        showInList: readCheckbox(form, "showInList"),
        ...(Number.isFinite(order) ? { order } : {}),
      },
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath(settingsPath(entity));
  return actionOk("Field updated.");
}

/**
 * Hide a field without touching stored values.
 *
 * The archived field disappears from forms and list views, but because
 * partitionFieldValues() merges over the existing `custom` bag, its values
 * survive subsequent saves and reappear intact if the field is restored.
 */
export async function setFieldArchived(form: FormData): Promise<void> {
  const user = await requireUserForAction();
  const id = readString(form, "id");
  const archived = readCheckbox(form, "archived");

  const existing = await prisma.fieldDefinition.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, entity: true },
  });
  if (!existing) return;

  await prisma.fieldDefinition.update({
    where: { id: existing.id },
    data: { archived },
  });
  revalidatePath(settingsPath(existing.entity));
}

/**
 * Delete a field and every value stored under it.
 *
 * The JSONB strip is a raw statement because Prisma has no expression for
 * Postgres's `jsonb - text` key-removal operator. Without it, deleted fields
 * would leave unreachable data behind in every record forever.
 */
export async function deleteFieldDefinition(form: FormData): Promise<void> {
  const user = await requireUserForAction();
  const id = readString(form, "id");

  const existing = await prisma.fieldDefinition.findFirst({
    where: { id, ownerId: user.id },
    select: { id: true, entity: true, key: true },
  });
  if (!existing) return;

  await prisma.$transaction(async (tx) => {
    await stripCustomKey(tx, existing.entity, user.id, existing.key);
    await tx.fieldDefinition.delete({ where: { id: existing.id } });
  });

  revalidatePath(settingsPath(existing.entity));
  revalidatePath(existing.entity === "PERSON" ? "/people" : "/events");
}

async function stripCustomKey(
  tx: Prisma.TransactionClient,
  entity: FieldEntity,
  ownerId: string,
  key: string,
): Promise<void> {
  if (entity === "PERSON") {
    await tx.$executeRaw`UPDATE "Person" SET "custom" = "custom" - CAST(${key} AS text) WHERE "ownerId" = ${ownerId}`;
  } else {
    await tx.$executeRaw`UPDATE "Event" SET "custom" = "custom" - CAST(${key} AS text) WHERE "ownerId" = ${ownerId}`;
  }
}
