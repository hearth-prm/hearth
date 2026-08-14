"use client";

import { useActionState, useState } from "react";
import { LABEL_COLORS, MAX_LABEL_NAME, type LabelColor } from "@/lib/labels";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { colorSwatchClass, LabelChip } from "@/components/label-chip";
import { btnSecondary, FormMessage, helpClass, inputClass, labelClass } from "@/components/ui";

/**
 * Colour picker.
 *
 * Radios rather than a select so every option is visible as the colour it produces
 * — the whole point of the choice is how the chip looks, which a list of colour
 * names cannot convey. "Automatic" is first and is the default: a colour derived
 * from the name is stable and looks deliberate, so most labels never need this.
 */
function ColorPicker({
  name,
  value,
  onChange,
  idPrefix,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
}) {
  return (
    <div role="radiogroup" aria-label="Chip colour" className="flex flex-wrap gap-1.5">
      <label
        htmlFor={`${idPrefix}-auto`}
        className={`cursor-pointer rounded-full border px-2 py-0.5 text-xs ${
          value === ""
            ? "border-accent-500 ring-1 ring-accent-500"
            : "border-neutral-300 dark:border-neutral-600"
        }`}
      >
        <input
          id={`${idPrefix}-auto`}
          type="radio"
          name={name}
          value=""
          checked={value === ""}
          onChange={() => onChange("")}
          className="sr-only"
        />
        Automatic
      </label>
      {LABEL_COLORS.map((c) => (
        <label
          key={c}
          htmlFor={`${idPrefix}-${c}`}
          className={`cursor-pointer rounded-full border px-2 py-0.5 ${colorSwatchClass(c)} ${
            value === c
              ? "border-neutral-900 dark:border-white"
              : "border-transparent"
          }`}
          title={c}
        >
          <input
            id={`${idPrefix}-${c}`}
            type="radio"
            name={name}
            value={c}
            checked={value === c}
            onChange={() => onChange(c)}
            className="sr-only"
          />
          <span className="text-xs">{c}</span>
        </label>
      ))}
    </div>
  );
}

export function CreateLabelForm({
  action,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");

  return (
    <form
      action={async (form) => {
        await formAction(form);
        setName("");
        setColor("");
      }}
      className="space-y-3 px-5 py-5"
    >
      <FormMessage ok={state.ok} message={state.message} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="new-label-name" className={labelClass}>
            New label
          </label>
          <input
            id="new-label-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_LABEL_NAME}
            placeholder="Family, Book club, Work…"
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <SubmitButton className={btnSecondary} pendingLabel="Adding…">
          Add label
        </SubmitButton>
      </div>

      <ColorPicker name="color" value={color} onChange={setColor} idPrefix="new-label" />

      {name.trim() ? (
        <p className={helpClass}>
          Preview:{" "}
          <LabelChip label={{ id: "preview", name: name.trim(), color: color || null }} />
        </p>
      ) : null}
    </form>
  );
}

export function EditLabelForm({
  action,
  label,
  count,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  label: { id: string; name: string; color: string | null };
  count: number;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color ?? "");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="id" value={label.id} />
      <FormMessage ok={state.ok} message={state.message} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label htmlFor={`edit-${label.id}`} className={labelClass}>
            Name
          </label>
          <input
            id={`edit-${label.id}`}
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_LABEL_NAME}
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <SubmitButton className={btnSecondary} pendingLabel="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline dark:text-neutral-400"
        >
          Cancel
        </button>
      </div>

      <ColorPicker
        name="color"
        value={color}
        onChange={setColor}
        idPrefix={`edit-${label.id}`}
      />

      {count > 0 ? (
        <p className={helpClass}>
          Renaming this also renames its Google label for everyone it reaches, and
          re-pushes {count} contact{count === 1 ? "" : "s"}.
        </p>
      ) : null}
    </form>
  );
}

/**
 * Assign labels to one contact.
 *
 * Checkboxes over the owner's labels, submitted as a complete set — unlike sharing,
 * unticking here DOES remove the label. Removing a grouping is the ordinary reason
 * to open this control, and nobody loses access to anything by it.
 */
export function PersonLabelsForm({
  action,
  personId,
  labels,
  selected,
  ownerName,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  personId: string;
  labels: readonly { id: string; name: string; color: string | null }[];
  selected: readonly string[];
  /** Set when viewing someone else's contact, to explain whose labels these are. */
  ownerName?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const chosen = new Set(selected);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        {selected.length ? "Change labels" : "Add labels"}
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="personId" value={personId} />
      <FormMessage ok={state.ok} message={state.message} />

      {ownerName ? (
        <p className={helpClass}>
          These are {ownerName}’s labels. A shared contact carries one set of labels
          so it reads the same for everyone who can see it.
        </p>
      ) : null}

      {labels.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {ownerName
            ? `${ownerName} has no labels yet. One you add below will be created for them.`
            : "No labels yet. Type one below and it will be created."}
        </p>
      ) : (
      <div
        role="group"
        aria-label="Labels"
        className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700"
      >
        {labels.map((l) => (
          <label
            key={l.id}
            htmlFor={`pl-${personId}-${l.id}`}
            className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <input
              id={`pl-${personId}-${l.id}`}
              type="checkbox"
              name="labelId"
              value={l.id}
              defaultChecked={chosen.has(l.id)}
              className="size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 dark:border-neutral-600"
            />
            <LabelChip label={l} />
          </label>
        ))}
      </div>
      )}

      <div>
        <label htmlFor={`newlabel-${personId}`} className={labelClass}>
          New label
        </label>
        <input
          id={`newlabel-${personId}`}
          name="newLabel"
          maxLength={MAX_LABEL_NAME}
          placeholder="Family, Book club…"
          className={`${inputClass} mt-1.5`}
        />
        <p className={helpClass}>
          Created and applied when you save. Manage them all in Settings → Labels.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className={btnSecondary} pendingLabel="Saving…">
          Save labels
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline dark:text-neutral-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
