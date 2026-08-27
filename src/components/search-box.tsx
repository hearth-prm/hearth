"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  applySuggestion,
  suggestQuery,
  type SuggestResult,
  type Vocabulary,
} from "@/lib/search/suggest";
import type { Translation } from "@/lib/search/nl";

/**
 * The search input, with completion for the query language.
 *
 * Controlled, unlike most inputs in this app, and for a reason: the suggestion list is a
 * function of the text and the cursor, so both have to be things this component knows. It is
 * one input on one page rather than two hundred rows, so the cost of controlling it is
 * nothing.
 *
 * Still a plain GET form around it. Accepting a suggestion edits the box; submitting is the
 * same navigation it always was, so a query stays a URL you can bookmark and hit Back out of.
 */
export function SearchBox({
  name,
  defaultValue,
  placeholder,
  vocab,
  className,
  interpret,
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
  vocab: Vocabulary;
  className?: string;
  /**
   * Turns a sentence into a query, when a model is configured for this install. Absent means
   * no model, and then no button — a control that can never work is worse than none.
   */
  interpret?: (prev: Translation, form: FormData) => Promise<Translation>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [result, setResult] = useState<SuggestResult>({ from: 0, to: 0, items: [] });
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  // The translator writes into this box, which is the point: what the model understood is
  // visible and editable before anything is searched.
  const [asked, setAsked] = useState<string | null>(null);
  const [translation, runInterpret, interpreting] = useActionState<Translation, FormData>(
    // A no-op stand-in when no model is configured, so the hook is called unconditionally.
    interpret ?? (async () => ({ ok: false })),
    { ok: false },
  );
  useEffect(() => {
    if (translation.ok && translation.query) {
      setValue(translation.query);
      setOpen(false);
    }
  }, [translation]);

  const recompute = (text: string, cursor: number) => {
    const next = suggestQuery(text, cursor, vocab);
    setResult(next);
    setActive(0);
    setOpen(next.items.length > 0);
  };

  const accept = (index: number) => {
    const item = result.items[index];
    if (!item) return;
    const applied = applySuggestion(value, result, item);
    setValue(applied.value);
    setOpen(false);
    // The cursor has to be placed after React has written the value, or the browser puts it
    // at the end and the next keystroke lands in the wrong place.
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(applied.cursor, applied.cursor);
      recompute(applied.value, applied.cursor);
    });
  };

  return (
    <div className="relative min-w-32 flex-1">
      <input
        ref={input}
        // Not type="search": the browser's own clear button and history dropdown both fight
        // the suggestion list for the same corner and the same Escape key.
        type="text"
        name={name}
        value={value}
        placeholder={placeholder}
        aria-label="Search people"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="search-suggestions"
        aria-autocomplete="list"
        className={className}
        onChange={(e) => {
          setValue(e.target.value);
          recompute(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          if (!open || result.items.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => (i + 1) % result.items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => (i - 1 + result.items.length) % result.items.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            // Enter accepts the highlighted suggestion INSTEAD of submitting, which is the
            // one place this diverges from a plain form. Escape first, then Enter, submits —
            // so the keyboard path to "just search for what I typed" is always two keys.
            e.preventDefault();
            accept(active);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => {
          // A click on a suggestion blurs the input first, so the list cannot be torn down
          // synchronously or the click lands on nothing.
          setTimeout(() => setOpen(false), 120);
        }}
      />

      {interpret ? (
        <>
          {/*
            type="button" with a manual dispatch, rather than formAction: this sits inside the
            page's GET search form, and a submit button would navigate instead of calling the
            action. Enter therefore still means "search", which is what it should mean.
          */}
          <button
            type="button"
            disabled={interpreting || value.trim().length === 0}
            onClick={() => {
              const data = new FormData();
              data.set("sentence", value);
              setAsked(value);
              runInterpret(data);
            }}
            title="Describe what you are looking for in words, and have it turned into a query"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-accent-700 transition hover:bg-accent-50 disabled:opacity-40 dark:text-accent-400 dark:hover:bg-accent-950/60"
          >
            {interpreting ? "asking…" : "ask"}
          </button>
        </>
      ) : null}

      {/* What it made of the sentence, or why it could not. Below the box so it does not
          move the box, and dismissable by typing. */}
      {translation.ok && asked && !interpreting ? (
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Read “{asked}” as the query above. Edit it, or press Enter to search.
        </p>
      ) : null}
      {!translation.ok && translation.message && !interpreting ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{translation.message}</p>
      ) : null}

      {open && result.items.length > 0 ? (
        <ul
          id="search-suggestions"
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        >
          {result.items.map((item, i) => (
            <li key={item.insert} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  // mouseDown rather than click: by the time click fires the blur timeout
                  // above may already have closed the list.
                  e.preventDefault();
                  accept(i);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                  i === active
                    ? "bg-accent-50 text-accent-900 dark:bg-accent-950/60 dark:text-accent-200"
                    : "text-neutral-700 dark:text-neutral-300"
                }`}
              >
                <span className="font-medium">{item.label}</span>
                {item.detail ? (
                  <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                    {item.detail}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
