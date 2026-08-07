"use client";

import { useActionState, useState } from "react";
import type { FieldEntity, FieldType } from "@prisma/client";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  takesOptions,
  toFieldKey,
} from "@/lib/fields/types";
import { SubmitButton } from "@/components/submit-button";
import {
  btnSecondary,
  Card,
  CardHeader,
  FormMessage,
  helpClass,
  inputClass,
  labelClass,
} from "@/components/ui";

/**
 * Add a user-defined field.
 *
 * The live storage-key preview matters more than it looks: the key is what the
 * value is stored under in JSONB and what the Google field mapping will point
 * at, and it is immutable once created. Showing it before submit avoids
 * "favourite_coffee" vs "favorite_coffee" surprises later.
 */
export function FieldCreateForm({
  action,
  entity,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  entity: FieldEntity;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [type, setType] = useState<FieldType>("TEXT");
  const [label, setLabel] = useState("");

  const key = toFieldKey(label);

  return (
    <Card>
      <CardHeader
        title="Add a field"
        description="Appears on every form for this record type, with no restart or migration."
      />
      <form action={formAction} className="space-y-5 px-5 py-5">
        <input type="hidden" name="entity" value={entity} />

        <FormMessage ok={state.ok} message={state.message} />

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="new-label" className={labelClass}>
              Label
            </label>
            <input
              id="new-label"
              name="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="How we met"
              required
              className={`${inputClass} mt-1.5`}
            />
            <p className={helpClass}>
              Stored as{" "}
              <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800">
                {key || "…"}
              </code>{" "}
              — this cannot be changed later.
            </p>
          </div>

          <div>
            <label htmlFor="new-type" className={labelClass}>
              Type
            </label>
            <select
              id="new-type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as FieldType)}
              className={`${inputClass} mt-1.5`}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className={helpClass}>
              Also fixed once created, because stored values are validated
              against it.
            </p>
          </div>
        </div>

        {takesOptions(type) ? (
          <div>
            <label htmlFor="new-options" className={labelClass}>
              Choices
            </label>
            <textarea
              id="new-options"
              name="options"
              rows={4}
              placeholder={"Work\nUniversity\nThrough a friend"}
              className={`${inputClass} mt-1.5`}
            />
            <p className={helpClass}>One per line.</p>
          </div>
        ) : null}

        <div>
          <label htmlFor="new-help" className={labelClass}>
            Help text <span className="text-neutral-400">(optional)</span>
          </label>
          <input id="new-help" name="helpText" className={`${inputClass} mt-1.5`} />
        </div>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="required"
              className="size-4 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
            />
            Required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="showInList"
              className="size-4 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
            />
            Show as a column in lists
          </label>
        </div>

        <SubmitButton pendingLabel="Adding…">Add field</SubmitButton>
      </form>
    </Card>
  );
}

export interface EditableField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  helpText: string | null;
  required: boolean;
  showInList: boolean;
  order: number;
  archived: boolean;
}

export function FieldEditForm({
  action,
  field,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  field: EditableField;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={field.id} />
      <FormMessage ok={state.ok} message={state.message} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={labelClass}>Label</label>
          <input
            name="label"
            defaultValue={field.label}
            required
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <div>
          <label className={labelClass}>Order</label>
          <input
            name="order"
            type="number"
            defaultValue={field.order}
            className={`${inputClass} mt-1.5`}
          />
        </div>
      </div>

      {takesOptions(field.type) ? (
        <div>
          <label className={labelClass}>Choices</label>
          <textarea
            name="options"
            rows={3}
            defaultValue={field.options.join("\n")}
            className={`${inputClass} mt-1.5`}
          />
          <p className={helpClass}>
            One per line. Removing a choice does not alter values already stored.
          </p>
        </div>
      ) : null}

      <div>
        <label className={labelClass}>Help text</label>
        <input
          name="helpText"
          defaultValue={field.helpText ?? ""}
          className={`${inputClass} mt-1.5`}
        />
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="required"
            defaultChecked={field.required}
            className="size-4 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
          />
          Required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="showInList"
            defaultChecked={field.showInList}
            className="size-4 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
          />
          Show as a column in lists
        </label>
      </div>

      <SubmitButton className={btnSecondary}>Save changes</SubmitButton>
    </form>
  );
}
