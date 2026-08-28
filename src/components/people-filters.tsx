"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import type { Vocabulary } from "@/lib/search/suggest";
import type { Translation } from "@/lib/search/nl";
import {
  activePills,
  filterHref,
  isFilterActive,
  toggleLabelHref,
  type PeopleFilter,
} from "@/lib/people-filter";
import {
  chipsFromQuery,
  queryFromChips,
  removeChip,
  setConnector,
  type Connector,
} from "@/lib/search/chips";
import { type LabelSummary } from "@/components/label-chip";
import { SubmitButton } from "@/components/submit-button";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";

/**
 * One control: a search box that also carries the active filters as removable chips,
 * with a Filter menu beside it.
 *
 * Filters remain links carrying the whole state, which is what keeps them composable,
 * bookmarkable and undoable one at a time with Back. Choosing an option navigates, so
 * the menu never holds a pending selection that could disagree with the list.
 *
 * The menu is a native <details>, not React state, so it opens on the very first click
 * rather than only after hydration — a menu that ignores a click on a freshly loaded
 * page feels broken, and every navigation here loads a fresh page. The effect below
 * only adds what <details> lacks: closing on an outside click or Escape.
 */
const SEARCH_EXAMPLES: readonly { query: string; means: string }[] = [
  { query: "label:Family", means: "in that label" },
  { query: 'city:"Sun Prairie"', means: "any address part" },
  { query: "org:TheStreet", means: "organisation contains" },
  { query: "-has:email", means: "no email address" },
  { query: "has:unthanked", means: "owed a thank-you" },
  { query: "has:photo", means: "has a picture" },
  { query: "is:private", means: "yours, shared with nobody" },
  { query: "google:error", means: "failed to sync" },
  { query: "updated:>30d", means: "changed in the last 30 days" },
  { query: "created:2026-08", means: "added that month" },
  { query: "dept:Technology", means: "a column by name" },
  { query: "label:Family or label:Medical", means: "either one" },
  { query: "phone:262", means: "a contact detail" },
  { query: "semantic:healthcare", means: "about that, by meaning" },
];

/** One chip. Shared so a query chip, a legacy pill and a bracketed query all look alike. */
const CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-50 py-0.5 pl-2 pr-1 text-xs font-medium text-accent-800 transition hover:bg-accent-100 dark:bg-accent-950/60 dark:text-accent-300 dark:hover:bg-accent-900/60";

export interface SavedFilterSummary {
  id: string;
  name: string;
  /** The URL search string it restores. */
  search: string;
  /** The same filter in words, for the hover text. */
  description: string;
}

export function PeopleFilters({
  filter,
  labels,
  resultCount,
  vocab,
  interpret,
  savedFilters,
  currentSearch,
  saveFilter,
  deleteSavedFilter,
}: {
  filter: PeopleFilter;
  labels: readonly (LabelSummary & { count: number })[];
  resultCount: number;
  /** Field and value names for completing a query; built from the same tables the compiler
      accepts, so the box can never teach a language the compiler refuses. */
  vocab: Vocabulary;
  /** Absent when no model is configured, and then the box shows no "ask" button. */
  interpret?: (prev: Translation, form: FormData) => Promise<Translation>;
  savedFilters: readonly SavedFilterSummary[];
  /** What is in force now, so "save this" saves the list somebody is looking at. */
  currentSearch: string;
  saveFilter: (prev: ActionState, form: FormData) => Promise<ActionState>;
  deleteSavedFilter: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Which AND/OR dropdown is open, by connector index. Controlled rather than a <details> per
  // connector so the document listeners below can close it — and so only ever one is open.
  const [openConnector, setOpenConnector] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [saveState, runSave] = useActionState(saveFilter, EMPTY_ACTION_STATE);
  const [deleteState, runDelete] = useActionState(deleteSavedFilter, EMPTY_ACTION_STATE);

  // Close on an outside click or Escape — the two behaviours <details> does not give
  // for free. Without them the menu sits open over the list, which is the
  // space-hogging problem it exists to solve.
  useEffect(() => {
    const close = () => {
      if (menu.current?.open) menu.current.open = false;
      setOpenConnector(null);
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.open && !menu.current.contains(target)) menu.current.open = false;
      // A click inside a connector dropdown is a click on one of its links, which navigates;
      // anywhere else closes it.
      if (!(target instanceof Element) || !target.closest("[data-connector]")) {
        setOpenConnector(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const labelNames = new Map(labels.map((l) => [l.id, l.name]));
  // The query as chips, and the legacy URL parameters as plain pills beside them. The Filter
  // menu no longer offers those parameters — everything it used to set is a predicate in the
  // language now — but a bookmark or a saved filter can still carry them, so they stay
  // removable rather than becoming invisible.
  const row = chipsFromQuery(filter.q);
  const pills = activePills(filter, labelNames);
  const active = isFilterActive(filter);
  // From the vocabulary rather than a second list, so the panel cannot advertise an option
  // the compiler does not have.
  const hasValues = (vocab.values.has ?? []).map((v) =>
    typeof v === "string" ? v : v.value,
  );

  return (
    <div className="mb-4">
      <div className="flex items-start gap-2">
        <form role="search" className="min-w-0 flex-1">
          {/* Carry the other filters through the GET so searching narrows the current
              view rather than resetting it. */}
          {filter.relation ? <input type="hidden" name="rel" value={filter.relation} /> : null}
          {filter.google ? <input type="hidden" name="google" value={filter.google} /> : null}
          {filter.has ? <input type="hidden" name="has" value={filter.has} /> : null}
          {filter.allLabels ? <input type="hidden" name="labelMode" value="all" /> : null}
          {filter.labelIds.map((id) => (
            <input key={id} type="hidden" name="label" value={id} />
          ))}

          <div className="flex min-h-[2.375rem] flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2 py-1 shadow-sm transition focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-900">
            {/*
              The chips come first and the box last, which is the order they are read in: the
              row is the filter in force, and what is being typed is added to the end of it.
            */}
            {row === null && filter.q ? (
              // A query with brackets in it has a shape a flat row cannot hold, so it is shown
              // whole rather than taken apart wrongly. Splitting it would change what a
              // bookmark means.
              <Link
                href={filterHref(filter, { q: null })}
                className={CHIP}
                title={`Remove: ${filter.q} — a bracketed query is kept whole`}
              >
                {filter.q}
                <span aria-hidden className="text-sm leading-none">×</span>
                <span className="sr-only">remove</span>
              </Link>
            ) : null}

            {(row?.chips ?? []).map((chip, i) => (
              <span key={`${i}-${chip}`} className="inline-flex shrink-0 items-center gap-1.5">
                {i > 0 ? (
                  <span className="relative" data-connector={i - 1}>
                    <button
                      type="button"
                      onClick={() => setOpenConnector(openConnector === i - 1 ? null : i - 1)}
                      aria-expanded={openConnector === i - 1}
                      title="Change how these two are joined"
                      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    >
                      {row!.connectors[i - 1]}
                      <span aria-hidden className="text-[0.6rem]">▾</span>
                    </button>
                    {openConnector === i - 1 ? (
                      <span className="absolute left-0 top-full z-30 mt-1 flex w-24 flex-col rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
                        {(["and", "or"] as Connector[]).map((c) => (
                          <Link
                            key={c}
                            href={filterHref(filter, {
                              q: queryFromChips(setConnector(row!, i - 1, c)),
                            })}
                            className={`px-3 py-1 text-left text-xs uppercase ${
                              row!.connectors[i - 1] === c
                                ? "font-semibold text-accent-800 dark:text-accent-300"
                                : "text-neutral-600 dark:text-neutral-300"
                            } hover:bg-neutral-50 dark:hover:bg-neutral-700`}
                          >
                            {c}
                          </Link>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <Link
                  href={filterHref(filter, { q: queryFromChips(removeChip(row!, i)) })}
                  className={CHIP}
                  title={`Remove: ${chip}`}
                >
                  {chip}
                  <span aria-hidden className="text-sm leading-none">×</span>
                  <span className="sr-only">remove</span>
                </Link>
              </span>
            ))}

            {pills.map((p) => (
              <Link
                key={p.id}
                href={p.href}
                className={CHIP}
                title={`Remove filter: ${p.label}`}
              >
                {p.label}
                <span aria-hidden className="text-sm leading-none">×</span>
                <span className="sr-only">remove</span>
              </Link>
            ))}

            <SearchBox
              name="q"
              existing={filter.q}
              placeholder={
                row && row.chips.length > 0
                  ? "Add another term, then Enter"
                  : "Search, or try label:Family -has:email"
              }
              vocab={vocab}
              interpret={interpret}
              className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
          </div>
        </form>

        <details ref={menu} className="relative shrink-0 [&>summary::-webkit-details-marker]:hidden">
          <summary
            className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Saved
            {savedFilters.length > 0 ? (
              <span className="rounded-full bg-accent-600 px-1.5 text-xs font-semibold text-white">
                {savedFilters.length}
              </span>
            ) : null}
            <span aria-hidden className="text-xs">
              ▾
            </span>
          </summary>

          <div
            data-saved-menu
            className="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
              {savedFilters.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  No saved filters yet. Build one with the chips, then name it below.
                </p>
              ) : (
                <Group title="Saved filters">
                  {savedFilters.map((sf) => (
                    <span key={sf.id} className="flex items-center gap-1">
                      <Link
                        href={sf.search ? `/people?${sf.search}` : "/people"}
                        // The whole filter in words. A name alone is a promise somebody has to
                        // remember; the description is what they actually saved.
                        title={sf.description}
                        className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        {sf.name}
                      </Link>
                      <form action={runDelete} className="shrink-0">
                        <input type="hidden" name="id" value={sf.id} />
                        <SubmitButton
                          className="rounded px-1.5 py-1 text-xs text-neutral-400 transition hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                          pendingLabel="…"
                        >
                          ×
                        </SubmitButton>
                      </form>
                    </span>
                  ))}
                </Group>
              )}

              {active ? (
                <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800">
                  <form action={runSave} className="flex items-center gap-1.5 px-1">
                    <input type="hidden" name="search" value={currentSearch} />
                    {/*
                      Controlled, because React 19 resets a form after its action settles and
                      the reset lands after the re-render the revalidation causes — so a failed
                      save would otherwise lose the name that was typed.
                    */}
                    <input
                      name="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Save this filter as…"
                      maxLength={60}
                      className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-900 outline-none focus:border-accent-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    />
                    <SubmitButton
                      className="shrink-0 rounded bg-accent-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-accent-700"
                      pendingLabel="Saving…"
                    >
                      Save
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <p className="mt-2 border-t border-neutral-100 px-2 pt-2 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  Filter the list first, then save it here.
                </p>
              )}

              {saveState.message || deleteState.message ? (
                <p
                  role="status"
                  className={`mt-1 px-2 text-xs ${
                    saveState.ok || deleteState.ok
                      ? "text-neutral-500 dark:text-neutral-400"
                      : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  {saveState.message || deleteState.message}
                </p>
              ) : null}

              {active ? (
                <Link
                  href="/people"
                  className="mt-1 block border-t border-neutral-100 px-2 pt-2 text-xs text-neutral-500 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
                >
                  Clear all filters
                </Link>
              ) : null}
          </div>
        </details>
      </div>

      {/*
        The keys, spelled out. Autocomplete only helps somebody who already suspects there is
        something to complete, and this is a native <details> so it needs no JavaScript and
        costs nothing when closed.
      */}
      <details className="mt-1.5 [&>summary::-webkit-details-marker]:hidden">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-neutral-500 underline decoration-dotted hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200">
          What can I search for?
        </summary>
        <div className="mt-2 rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <p className="mb-2 text-neutral-600 dark:text-neutral-400">
            Words on their own search names, organisations, notes, contact details and label
            names. <code>-</code> before a term excludes it, <code>or</code> and brackets group,
            and quotes hold a phrase together.
          </p>
          <p className="mb-2 text-neutral-600 dark:text-neutral-400">
            Enter turns what you typed into chips. <strong>AND</strong> binds tighter than{" "}
            <strong>OR</strong>, as it does everywhere else: <code>a OR b AND c</code> means{" "}
            <code>a OR (b AND c)</code>. Type the brackets yourself for the other grouping — a
            bracketed query is kept as one chip rather than taken apart wrongly.
          </p>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {SEARCH_EXAMPLES.map((ex) => (
              <li key={ex.query} className="flex flex-wrap items-baseline gap-x-2">
                <code className="rounded bg-neutral-100 px-1 py-0.5 text-[0.7rem] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                  {ex.query}
                </code>
                <span className="text-neutral-500 dark:text-neutral-400">{ex.means}</span>
              </li>
            ))}
          </ul>
          {interpret ? (
            <p className="mt-2 text-neutral-600 dark:text-neutral-400">
              Or type what you want in words and press <strong>ask</strong> — it writes a query
              into the box for you to check before searching.
            </p>
          ) : null}
          <p className="mt-2 text-neutral-500 dark:text-neutral-400">
            Also available: {vocab.fields.slice(0, 24).join(", ")}
            {vocab.fields.length > 24 ? ", …" : ""}
          </p>
          {/* Listed rather than left to autocomplete: there are forty of these and the box
              shows eight at a time, so nobody would find the far end by typing letters. */}
          <p className="mt-1 text-neutral-500 dark:text-neutral-400">
            <code className="text-[0.7rem]">has:</code> takes {hasValues.join(", ")}
            {hasValues.length > 0 ? " — and each of them negates with a minus." : ""}
          </p>
        </div>
      </details>

      {active ? (
        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {resultCount === 1
            ? "1 contact matches"
            : `${resultCount.toLocaleString()} contacts match`}
          {filter.labelIds.length > 1
            ? filter.allLabels
              ? " · all selected labels"
              : " · any selected label"
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 last:mb-0">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {title}
      </p>
      {children}
    </div>
  );
}

function Option({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-pressed={on}
      className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm transition ${
        on
          ? "bg-accent-50 text-accent-900 dark:bg-accent-950/60 dark:text-accent-200"
          : "text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      <span className="min-w-0">{children}</span>
      {on ? (
        <span aria-hidden className="shrink-0 text-accent-600 dark:text-accent-400">
          ✓
        </span>
      ) : null}
    </Link>
  );
}
