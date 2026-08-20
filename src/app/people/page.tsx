import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { listFields, loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import { primaryEmail } from "@/lib/people";
import {
  isFilterActive,
  NON_FILTER_PARAMS,
  parseFilter,
  peopleWhere,
  type RawParams,
} from "@/lib/people-filter";
import {
  btnPrimary,
  btnSecondary,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { LabelChips } from "@/components/label-chip";
import { Avatar } from "@/components/avatar";
import { effectivePhotoMap } from "@/lib/photos-db";
import { PeopleFilters } from "@/components/people-filters";
import { PeopleBulkBar } from "@/components/people-bulk-bar";
import { SelectAllPeople } from "@/components/select-all-people";
import {
  bulkLabelPeople,
  bulkSetAddToGoogle,
  bulkTrashPeople,
} from "@/lib/actions/people-bulk";

const PAGE_SIZE = 200;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const filter = parseFilter(params);
  const where = peopleWhere(filter, user.id);

  const defs = await loadRegistry(user.id, "PERSON");
  // displayName already covers the name fields, so don't repeat them as columns.
  const columns = listFields(defs).filter(
    (d) => d.key !== "givenName" && d.key !== "familyName",
  );

  const [people, total, labelRows] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy: { displayName: "asc" },
      take: PAGE_SIZE,
      include: {
        owner: { select: { email: true } },
        // The badge reports THIS account's copy: a shared contact can be synced for
        // its owner and still pending for you.
        googleSyncs: { where: { userId: user.id } },
        labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
        contactPoints: {
          where: { kind: "EMAIL" },
          orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
          take: 1,
        },
      },
    }),
    prisma.person.count({ where }),
    // The filter bar offers the viewer's OWN labels. A label belonging to someone
    // who shared a contact with you is theirs to manage, and offering it here would
    // imply you could.
    prisma.label.findMany({
      where: { ownerId: user.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { people: true } },
      },
    }),
  ]);

  const labels = labelRows.map(({ _count, ...l }) => ({ ...l, count: _count.people }));
  // One query for the page rather than one per row: the effective photo depends on the
  // viewer, so it cannot be included in the person query itself.
  const photos = await effectivePhotoMap(people, user.id);
  const filtered = isFilterActive(filter);

  return (
    <div>
      <PageHeader
        title="People"
        description={total === 1 ? "1 contact" : `${total.toLocaleString()} contacts`}
        action={
          <div className="flex items-center gap-2">
            <Link href="/people/import/google" className={btnSecondary}>
              Import from Google
            </Link>
            <Link href="/people/import" className={btnSecondary}>
              Import CSV
            </Link>
            <Link href="/people/new" className={btnPrimary}>
              New contact
            </Link>
          </div>
        }
      />

      {/* Set by a completed transfer. It confirms here rather than on the contact's own
          page because a transfer un-renders the form that would otherwise show it — and
          when no access was kept, that page is not readable any more either. */}
      {typeof params.gave === "string" && params.gave ? (
        <p
          role="status"
          className="mb-4 rounded-md bg-accent-50 px-3 py-2 text-sm text-accent-800 dark:bg-accent-950/60 dark:text-accent-300"
        >
          <strong className="font-medium">{params.gave}</strong> now belongs to someone
          else.{" "}
          {params.kept === "edit"
            ? "You kept view and edit access."
            : params.kept === "view"
              ? "You kept view-only access."
              : "You no longer have access, and it will leave your Google Contacts on the next sync."}
        </p>
      ) : null}

      <PeopleFilters filter={filter} labels={labels} resultCount={total} />

      <Card>
        {people.length === 0 ? (
          <EmptyState
            title={filtered ? "Nothing matches those filters" : "No contacts yet"}
            description={
              filtered
                ? "Try clearing a filter, or widening the search."
                : "Add the first person you want to keep track of."
            }
            action={
              filtered ? (
                <Link href="/people" className={btnSecondary}>
                  Clear filters
                </Link>
              ) : (
                <Link href="/people/new" className={btnPrimary}>
                  New contact
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            {/* One form around the whole table, so every ticked row is submitted with
                whichever bulk button is pressed — no selection state to keep in step with
                the rows, and it works before hydration. */}
            <form id="people-bulk" className="contents">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th scope="col" className="w-8 pl-5 pr-0 py-3 font-medium">
                    <SelectAllPeople />
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Labels
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="hidden px-5 py-3 font-medium md:table-cell"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="px-5 py-3 font-medium">
                    Google
                  </th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr
                    key={person.id}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800/60 dark:hover:bg-neutral-800/40"
                  >
                    <td className="w-8 pl-5 pr-0 py-3">
                      <input
                        type="checkbox"
                        name="personId"
                        value={person.id}
                        aria-label={`Select ${person.displayName}`}
                        className="size-4 rounded border-neutral-300 dark:border-neutral-600"
                      />
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2.5">
                        <Avatar
                          personId={person.id}
                          name={person.displayName}
                          photo={photos.get(person.id)}
                        />
                        <Link
                          href={`/people/${person.id}`}
                          className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                        >
                          {person.displayName}
                        </Link>
                      </span>
                      {person.ownerId !== user.id ? (
                        <span
                          className="ml-2 text-xs text-amber-700 dark:text-amber-400"
                          title={`Shared by ${person.owner.email}`}
                        >
                          shared
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-neutral-600 dark:text-neutral-400">
                      {primaryEmail(person.contactPoints) ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      {person.labels.length ? (
                        <LabelChips labels={person.labels.map((pl) => pl.label)} linked />
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className="hidden px-5 py-3 text-neutral-600 md:table-cell dark:text-neutral-400"
                      >
                        {formatFieldValue(c, readFieldValue(person, c)) || "—"}
                      </td>
                    ))}
                    <td className="px-5 py-3">
                      <SyncBadge
                        addToGoogle={person.addToGoogle}
                        status={person.googleSyncs[0]?.googleSyncStatus ?? "PENDING"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <PeopleBulkBar
              labelNames={labelRows.map((l) => l.name)}
              total={total}
              shown={people.length}
              filterFields={filterFields(params)}
              labelAction={bulkLabelPeople}
              googleAction={bulkSetAddToGoogle}
              trashAction={bulkTrashPeople}
            />
            </form>
          </div>
        )}
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {total > people.length
            ? `Showing the first ${people.length} of ${total.toLocaleString()}. Narrow the list with search or a filter.`
            : ""}
        </span>
        {/* Export follows the filters, so "export my Family label" needs no separate
            selection mechanism — you filter the list, then export what you see. */}
        <Link
          href={`/api/people/export${buildExportQuery(params)}`}
          className="text-accent-700 underline dark:text-accent-400"
        >
          Export {filtered ? "these" : "all"} as CSV
        </Link>
      </div>
    </div>
  );
}

/**
 * The current filter, as fields the bulk form can carry.
 *
 * Same parameters the export uses, for the same reason: "act on everything matching" has to
 * mean the list you were looking at. Sent as f.* so the action can tell a filter apart from
 * its own inputs, and re-parsed server-side rather than trusted — peopleWhere ANDs the
 * readable clause, so the widest a forged request can reach is that user's own contacts.
 */
function filterFields(params: RawParams): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const [key, value] of Object.entries(params)) {
    if ((NON_FILTER_PARAMS as readonly string[]).includes(key)) continue;
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      out.push({ name: key, value: v });
    }
  }
  return out;
}

/** Pass the current filters straight through to the export endpoint. */
function buildExportQuery(params: RawParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // A transfer confirmation is not a filter and must not narrow the export.
    if ((NON_FILTER_PARAMS as readonly string[]).includes(key)) continue;
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      qs.append(key, v);
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
