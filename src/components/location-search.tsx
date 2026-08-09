"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { PlaceSearchResult } from "@/lib/actions/places";
import type { PlaceSuggestion } from "@/lib/places";
import { errorClass, helpClass, inputClass, labelClass } from "@/components/ui";

/**
 * Location field with place lookup.
 *
 * Still a plain text input underneath — the suggestions only ever write into it, so
 * typing an address by hand, pasting one, or the provider being down all leave the
 * field fully usable. That matters more than the autocomplete: a location you
 * cannot enter because a third party is unreachable would be a worse field than the
 * one this replaces.
 */
export function LocationSearch({
  name,
  defaultValue,
  search,
  error,
}: {
  name: string;
  defaultValue: string;
  search: (query: string) => Promise<PlaceSearchResult>;
  error?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Only the newest query may paint results; a slow earlier response landing later
  // would otherwise replace them with stale ones.
  const seq = useRef(0);
  // Suppress the lookup that a programmatic setValue would otherwise trigger when
  // the user picks a suggestion.
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }

    const handle = setTimeout(() => {
      const mine = ++seq.current;
      startTransition(async () => {
        const result = await search(q);
        if (mine !== seq.current) return;
        if (result.status === "ok") {
          setSuggestions(result.suggestions);
          setNotice(null);
          setOpen(true);
        } else if (result.status === "off") {
          setSuggestions([]);
          setNotice(null);
        } else {
          setSuggestions([]);
          setNotice("Place lookup is unavailable — type the address yourself.");
        }
      });
    }, 350);

    return () => clearTimeout(handle);
  }, [value, search]);

  function choose(suggestion: PlaceSuggestion) {
    skipNext.current = true;
    setValue(suggestion.address);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div>
      <label htmlFor="field-location" className={labelClass}>
        Location
      </label>
      <input
        id="field-location"
        name={name}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        placeholder="Search for a place, or type an address"
        className={`${inputClass} mt-1.5`}
      />

      {open && suggestions.length > 0 ? (
        <ul className="mt-1 divide-y divide-neutral-100 overflow-hidden rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => choose(s)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span className="font-medium">{s.label}</span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                  {s.address}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {pending && value.trim().length >= 3 && suggestions.length === 0 ? (
        <p className={helpClass}>Searching…</p>
      ) : null}
      {notice ? <p className={helpClass}>{notice}</p> : null}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
