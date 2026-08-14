"use client";

import { fieldInputName, type FieldDef } from "@/lib/fields/types";
import {
  fieldCheckedValue,
  fieldInputValue,
  fieldSelectedValues,
} from "@/lib/fields/format";
import { errorClass, helpClass, inputClass, labelClass } from "@/components/ui";

/**
 * Renders one registry field as a form control.
 *
 * This is the payoff of the registry design: a person or event form does not
 * enumerate its inputs, it maps over FieldDef[]. Adding a custom field in
 * Settings makes it appear here with no code change, and core fields go through
 * exactly the same path as user-defined ones.
 */
export function FieldInput({
  def,
  value,
  error,
  timeZone = "UTC",
}: {
  def: FieldDef;
  value: unknown;
  error?: string;
  timeZone?: string;
}) {
  const name = fieldInputName(def.key);
  const id = `field-${def.key}`;
  const describedBy = [
    def.helpText ? `${id}-help` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      {def.type === "BOOLEAN" ? (
        <label className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            name={name}
            defaultChecked={fieldCheckedValue(value)}
            className="size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 dark:border-neutral-600"
            aria-describedby={describedBy || undefined}
          />
          <span className={labelClass}>{def.label}</span>
        </label>
      ) : (
        <>
          <label htmlFor={id} className={labelClass}>
            {def.label}
            {def.required ? (
              <span aria-hidden className="ml-0.5 text-rose-500">
                *
              </span>
            ) : null}
          </label>
          <div className="mt-1.5">
            <Control
              def={def}
              name={name}
              id={id}
              value={value}
              timeZone={timeZone}
              describedBy={describedBy || undefined}
            />
          </div>
        </>
      )}

      {def.helpText ? (
        <p id={`${id}-help`} className={helpClass}>
          {def.helpText}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Control({
  def,
  name,
  id,
  value,
  timeZone,
  describedBy,
}: {
  def: FieldDef;
  name: string;
  id: string;
  value: unknown;
  timeZone: string;
  describedBy?: string;
}) {
  const common = {
    id,
    name,
    className: inputClass,
    "aria-describedby": describedBy,
    required: def.required,
  };

  switch (def.type) {
    case "LONGTEXT":
      return (
        <textarea
          {...common}
          rows={4}
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "SELECT":
      return (
        <select {...common} defaultValue={fieldInputValue(def, value, timeZone)}>
          <option value="">—</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "MULTISELECT": {
      // Checkboxes rather than a multi-select: they need no JavaScript, and
      // FormData.getAll() collects them into the array the validator expects.
      const selected = new Set(fieldSelectedValues(value));
      return (
        <div
          role="group"
          aria-describedby={describedBy}
          className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-neutral-300 px-3 py-2.5 dark:border-neutral-700"
        >
          {def.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={name}
                value={opt}
                defaultChecked={selected.has(opt)}
                className="size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 dark:border-neutral-600"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }

    case "NUMBER":
      return (
        <input
          {...common}
          type="number"
          step="any"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "DATE":
      return (
        <input
          {...common}
          type="date"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "DATETIME":
      return (
        <input
          {...common}
          type="datetime-local"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "EMAIL":
      return (
        <input
          {...common}
          type="email"
          autoComplete="off"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "PHONE":
      return (
        <input
          {...common}
          type="tel"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    case "URL":
      return (
        <input
          {...common}
          type="url"
          placeholder="https://"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );

    default:
      return (
        <input
          {...common}
          type="text"
          defaultValue={fieldInputValue(def, value, timeZone)}
        />
      );
  }
}
