"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { PersonHit } from "@/lib/actions/people-search";
import { btnSecondary, inputClass, labelClass } from "@/components/ui";

/**
 * Type-to-search box for adding a guest, replacing a select listing everyone.
 *
 * Each result is itself the form's submit button, carrying the chosen id as
 * name/value. That avoids a hidden field and a second click: no state has to be
 * kept in sync between "what is highlighted" and "what will be submitted",
 * because the button the user presses *is* the answer.
 */
export function AttendeeSearch({
  search,
  eventId,
}: {
  search: (query: string, options: { excludeEventId?: string }) => Promise<PersonHit[]>;
  eventId: string;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  // Guards against a slow early response landing after a faster later one and
  // repainting the list with results for a query the user has moved on from.
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearched(false);
      return;
    }

    // Debounced: a request per keystroke would be mostly wasted work.
    const handle = setTimeout(() => {
      const mine = ++seq.current;
      startTransition(async () => {
        const results = await search(q, { excludeEventId: eventId });
        if (mine === seq.current) {
          setHits(results);
          setSearched(true);
        }
      });
    }, 200);

    return () => clearTimeout(handle);
  }, [query, eventId, search]);

  return (
    <div>
      <label htmlFor="attendee-search" className={labelClass}>
        Add someone
      </label>
      <input
        id="attendee-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Start typing a name, organisation or email…"
        autoComplete="off"
        className={`${inputClass} mt-1.5`}
      />

      {query.trim() && (
        <div className="mt-2 space-y-1">
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="submit"
              name="personId"
              value={hit.id}
              className={`${btnSecondary} w-full justify-start text-left`}
            >
              <span>{hit.displayName}</span>
              {hit.detail ? (
                <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                  {hit.detail}
                </span>
              ) : null}
            </button>
          ))}

          {hits.length === 0 && searched && !pending ? (
            <p className="px-1 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
              Nobody matches “{query.trim()}” — or they are already on this event.
            </p>
          ) : null}
          {pending && hits.length === 0 ? (
            <p className="px-1 py-1.5 text-sm text-neutral-500 dark:text-neutral-400">
              Searching…
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
