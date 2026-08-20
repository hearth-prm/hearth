"use client";

/**
 * The header checkbox that ticks every row.
 *
 * A tiny client island rather than state over the table: it walks up to the form it sits in
 * and sets the row boxes directly, which keeps two hundred uncontrolled inputs uncontrolled.
 * Dispatching a change event afterwards is what lets the bulk bar recount — one listener on
 * the form hears both this and an individual tick.
 */
export function SelectAllPeople() {
  return (
    <input
      type="checkbox"
      aria-label="Select all listed contacts"
      className="size-4 rounded border-neutral-300 dark:border-neutral-600"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        form
          .querySelectorAll<HTMLInputElement>('input[name="personId"]')
          .forEach((box) => { box.checked = e.currentTarget.checked; });
        form.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}
