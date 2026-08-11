import Link from "next/link";
import {
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
import { inputClass } from "@/components/ui";

/**
 * Filters as links, not a form.
 *
 * Every control is a GET link carrying the whole filter state, which means filters
 * compose without any client-side coordination, the browser's Back button undoes
 * one at a time, and a filtered list is a URL you can keep. The search box is the
 * one exception — text has to be typed — and it submits as a GET, preserving the
 * other filters through hidden inputs.
 */
function Pill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex items-center rounded-full bg-teal-600 px-2.5 py-1 text-xs font-medium text-white"
          : "inline-flex items-center rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 transition hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-100"
      }
    >
      {children}
    </Link>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium uppercase tracking-wide text-neutral-400">
        {title}
      </span>
      {children}
    </div>
  );
}

export function PeopleFilters({
  filter,
  labels,
  resultCount,
}: {
  filter: PeopleFilter;
  labels: readonly (LabelSummary & { count: number })[];
  resultCount: number;
}) {
  const active = isFilterActive(filter);

  return (
    <div className="mb-4 space-y-3">
      <form role="search" className="flex flex-wrap items-center gap-2">
        {/* Carry the other filters through the GET so searching narrows the current
            view rather than resetting it. */}
        {filter.relation ? <input type="hidden" name="rel" value={filter.relation} /> : null}
        {filter.google ? <input type="hidden" name="google" value={filter.google} /> : null}
        {filter.has ? <input type="hidden" name="has" value={filter.has} /> : null}
        {filter.allLabels ? <input type="hidden" name="labelMode" value="all" /> : null}
        {filter.labelIds.map((id) => (
          <input key={id} type="hidden" name="label" value={id} />
        ))}
        <input
          type="search"
          name="q"
          defaultValue={filter.q}
          placeholder="Search name, organisation, notes, label or contact details…"
          aria-label="Search people"
          className={`${inputClass} flex-1`}
        />
      </form>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Group title="Who">
          {RELATIONS.map((r) => (
            <Pill
              key={r}
              active={filter.relation === r}
              href={filterHref(filter, { rel: filter.relation === r ? null : r })}
            >
              {RELATION_LABELS[r]}
            </Pill>
          ))}
        </Group>

        <Group title="Google">
          {GOOGLE_STATES.map((g) => (
            <Pill
              key={g}
              active={filter.google === g}
              href={filterHref(filter, { google: filter.google === g ? null : g })}
            >
              {GOOGLE_STATE_LABELS[g]}
            </Pill>
          ))}
        </Group>

        <Group title="Details">
          {HAS_OPTIONS.map((h) => (
            <Pill
              key={h}
              active={filter.has === h}
              href={filterHref(filter, { has: filter.has === h ? null : h })}
            >
              {HAS_LABELS[h]}
            </Pill>
          ))}
        </Group>
      </div>

      {labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Group title="Labels">
            {labels.map((l) => {
              const on = filter.labelIds.includes(l.id);
              return (
                <Link
                  key={l.id}
                  href={toggleLabelHref(filter, l.id)}
                  className={`inline-flex items-center gap-1 rounded-full ${
                    on ? "ring-2 ring-teal-500" : ""
                  }`}
                  aria-pressed={on}
                >
                  <LabelChip label={l} />
                  <span className="text-[10px] text-neutral-400">{l.count}</span>
                </Link>
              );
            })}
          </Group>
          {filter.labelIds.length > 1 ? (
            <Link
              href={filterHref(filter, { labelMode: filter.allLabels ? null : "all" })}
              className="text-xs text-teal-700 underline dark:text-teal-400"
            >
              {filter.allLabels ? "matching all — switch to any" : "matching any — switch to all"}
            </Link>
          ) : null}
        </div>
      ) : null}

      {active ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {resultCount === 1 ? "1 contact matches" : `${resultCount.toLocaleString()} contacts match`}
          {" · "}
          <Link href="/people" className="text-teal-700 underline dark:text-teal-400">
            clear filters
          </Link>
        </p>
      ) : null}
    </div>
  );
}
