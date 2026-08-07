"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/components/ui";

export interface PickablePerson {
  id: string;
  displayName: string;
}

/**
 * Checkbox list of people to attach to an event, with a client-side filter.
 *
 * Filtering in the browser keeps the interaction instant and needs no extra
 * round-trip. The caller caps how many people it passes in and says so when the
 * list is truncated, so this never silently hides contacts.
 */
export function AttendeePicker({
  people,
  selectedIds,
  truncated,
}: {
  people: readonly PickablePerson[];
  selectedIds: readonly string[];
  truncated?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.displayName.toLowerCase().includes(q));
  }, [people, query]);

  if (people.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Add some contacts first, then you can say who was there.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter people…"
        aria-label="Filter people"
        className={inputClass}
      />

      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-sm text-neutral-500 dark:text-neutral-400">
            No one matches “{query}”.
          </p>
        ) : (
          filtered.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <input
                type="checkbox"
                name="attendeeId"
                value={p.id}
                defaultChecked={selected.has(p.id)}
                className="size-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
              />
              {p.displayName}
            </label>
          ))
        )}
      </div>

      {truncated ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Showing the {people.length} most recently updated contacts. Use the
          event page to add anyone not listed here.
        </p>
      ) : null}
    </div>
  );
}
