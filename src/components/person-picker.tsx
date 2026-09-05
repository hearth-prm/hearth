"use client";

import { useMemo, useState } from "react";
import { inputClass, labelClass } from "@/components/ui";

export interface PickablePerson {
  id: string;
  displayName: string;
}

/**
 * Tick people out of a long list, by typing.
 *
 * The gift form used to render every readable contact — up to 500 of them — as checkboxes
 * in a 160px scroll box, for both sides of "who gave this to whom". Finding one person meant
 * scrolling past everybody whose name happens to sort earlier.
 *
 * ## Why the ticked ones are pinned
 *
 * A checkbox that is not rendered submits nothing, so filtering a ticked person out of view
 * would quietly drop them from the gift — tick Karen, type "bob", and Karen is no longer a
 * giver. Nothing on screen would say so. Selected people are therefore always rendered,
 * above the matches and outside the filter, which also means the answer to "who have I
 * picked" never requires clearing the box to find out.
 *
 * That is also why selection is state here rather than `defaultChecked` on the inputs: the
 * pinned section cannot be expressed without knowing what is picked.
 *
 * ## Why the list is capped
 *
 * An unfiltered list of 500 is a scroll box again. It shows the first `LIMIT` matches and
 * says how many it is not showing, which turns the cap into a reason to type rather than a
 * silent truncation — the failure mode where somebody concludes a contact does not exist.
 */
const LIMIT = 40;

export function PersonPicker({
  name,
  label,
  people,
  defaultSelected = [],
  help,
}: {
  /** Form field name; one input is submitted per ticked person. */
  name: string;
  label: string;
  people: readonly PickablePerson[];
  defaultSelected?: readonly string[];
  help?: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(defaultSelected),
  );

  const chosen = useMemo(
    () => people.filter((p) => picked.has(p.id)),
    [people, picked],
  );

  // Case- and accent-insensitive, because "renée" should find "Renée" and somebody typing
  // a name they have only ever heard should not have to know which it was.
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();

  const matches = useMemo(() => {
    const q = norm(query.trim());
    const rest = people.filter((p) => !picked.has(p.id));
    if (!q) return rest;
    return rest.filter((p) => norm(p.displayName).includes(q));
  }, [people, picked, query]);

  const shown = matches.slice(0, LIMIT);
  const hidden = matches.length - shown.length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const row = (p: PickablePerson, isPicked: boolean) => (
    <label
      key={p.id}
      className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
    >
      <input
        type="checkbox"
        name={name}
        value={p.id}
        checked={isPicked}
        onChange={() => toggle(p.id)}
        className="size-3.5 rounded border-neutral-300 text-accent-600 dark:border-neutral-600"
      />
      {p.displayName}
    </label>
  );

  return (
    <div>
      <span className={labelClass}>{label}</span>
      <input
        type="search"
        // The accessible name says which of the two pickers this is. A <label htmlFor> would
        // name it "From", which is the name of the whole picker rather than of the box you
        // type in — and there are two of them side by side.
        aria-label={`Filter ${label}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Type to filter ${people.length} people`}
        // Not type=submit's friend: Enter in a search box inside a form submits the form,
        // which here would record the gift while somebody is still choosing who it is from.
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        className={`${inputClass} mt-1.5`}
      />

      {chosen.length > 0 ? (
        <div className="mt-1.5 space-y-1 rounded-md border border-accent-200 bg-accent-50/50 p-2 dark:border-accent-900 dark:bg-accent-950/30">
          {chosen.map((p) => row(p, true))}
        </div>
      ) : null}

      <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
        {shown.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {matches.length === 0 && query.trim()
              ? `Nobody matches “${query.trim()}”.`
              : "Everybody here is picked already."}
          </p>
        ) : (
          shown.map((p) => row(p, false))
        )}
        {hidden > 0 ? (
          <p className="pt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {hidden} more — keep typing to narrow it down.
          </p>
        ) : null}
      </div>

      {help ? (
        <span className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">
          {help}
        </span>
      ) : null}
    </div>
  );
}
