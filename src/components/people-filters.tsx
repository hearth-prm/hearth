"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  activePills,
  filterHref,
  GOOGLE_STATE_LABELS,
  GOOGLE_STATES,
  HAS_LABELS,
  HAS_OPTIONS,
  isFilterActive,
  RELATION_LABELS,
  RELATIONS,
  toggleLabelHref,
  type PeopleFilter,
} from "@/lib/people-filter";
import { LabelChip, type LabelSummary } from "@/components/label-chip";

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
export function PeopleFilters({
  filter,
  labels,
  resultCount,
}: {
  filter: PeopleFilter;
  labels: readonly (LabelSummary & { count: number })[];
  resultCount: number;
}) {
  const menu = useRef<HTMLDetailsElement>(null);

  // Close on an outside click or Escape — the two behaviours <details> does not give
  // for free. Without them the menu sits open over the list, which is the
  // space-hogging problem it exists to solve.
  useEffect(() => {
    const close = () => {
      if (menu.current?.open) menu.current.open = false;
    };
    const onDown = (e: MouseEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) close();
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
  const pills = activePills(filter, labelNames);
  const active = isFilterActive(filter);

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
            <input
              type="search"
              name="q"
              defaultValue={filter.q}
              placeholder="Search name, organisation, notes, label or contact details…"
              aria-label="Search people"
              className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
            />
            {pills.map((p) => (
              <Link
                key={p.id}
                href={p.href}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-50 py-0.5 pl-2 pr-1 text-xs font-medium text-accent-800 transition hover:bg-accent-100 dark:bg-accent-950/60 dark:text-accent-300 dark:hover:bg-accent-900/60"
                title={`Remove filter: ${p.label}`}
              >
                {p.label}
                <span aria-hidden className="text-sm leading-none">
                  ×
                </span>
                <span className="sr-only">remove</span>
              </Link>
            ))}
          </div>
        </form>

        <details ref={menu} className="relative shrink-0 [&>summary::-webkit-details-marker]:hidden">
          <summary
            className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Filter
            {pills.length > 0 ? (
              <span className="rounded-full bg-accent-600 px-1.5 text-xs font-semibold text-white">
                {pills.length}
              </span>
            ) : null}
            <span aria-hidden className="text-xs">
              ▾
            </span>
          </summary>

          <div className="absolute right-0 z-20 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <Group title="Who">
                {RELATIONS.map((r) => (
                  <Option
                    key={r}
                    href={filterHref(filter, { rel: filter.relation === r ? null : r })}
                    on={filter.relation === r}
                  >
                    {RELATION_LABELS[r]}
                  </Option>
                ))}
              </Group>

              <Group title="Google">
                {GOOGLE_STATES.map((g) => (
                  <Option
                    key={g}
                    href={filterHref(filter, { google: filter.google === g ? null : g })}
                    on={filter.google === g}
                  >
                    {GOOGLE_STATE_LABELS[g]}
                  </Option>
                ))}
              </Group>

              <Group title="Details">
                {HAS_OPTIONS.map((h) => (
                  <Option
                    key={h}
                    href={filterHref(filter, { has: filter.has === h ? null : h })}
                    on={filter.has === h}
                  >
                    {HAS_LABELS[h]}
                  </Option>
                ))}
              </Group>

              {labels.length > 0 ? (
                <Group title="Labels">
                  {labels.map((l) => (
                    <Option
                      key={l.id}
                      href={toggleLabelHref(filter, l.id)}
                      on={filter.labelIds.includes(l.id)}
                    >
                      <span className="flex items-center gap-2">
                        <LabelChip label={l} />
                        <span className="text-xs text-neutral-400">{l.count}</span>
                      </span>
                    </Option>
                  ))}
                  {filter.labelIds.length > 1 ? (
                    <Link
                      href={filterHref(filter, { labelMode: filter.allLabels ? null : "all" })}
                      className="mt-1 block rounded px-2 py-1.5 text-xs text-accent-700 hover:bg-neutral-50 dark:text-accent-400 dark:hover:bg-neutral-800"
                    >
                      {filter.allLabels
                        ? "matching all — switch to any"
                        : "matching any — switch to all"}
                    </Link>
                  ) : null}
                </Group>
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
