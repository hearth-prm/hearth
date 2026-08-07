import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUser } from "@/lib/access";
import { listFields, loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import { primaryEmail } from "@/lib/people";
import {
  btnPrimary,
  Card,
  EmptyState,
  inputClass,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";

const PAGE_SIZE = 200;

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const defs = await loadRegistry(user.id, "PERSON");
  // displayName already covers the name fields, so don't repeat them as columns.
  const columns = listFields(defs).filter(
    (d) => d.key !== "givenName" && d.key !== "familyName",
  );

  const search: Prisma.PersonWhereInput = query
    ? {
        OR: [
          { displayName: { contains: query, mode: "insensitive" } },
          { nickname: { contains: query, mode: "insensitive" } },
          { organization: { contains: query, mode: "insensitive" } },
          { jobTitle: { contains: query, mode: "insensitive" } },
          { notes: { contains: query, mode: "insensitive" } },
          {
            contactPoints: {
              some: { value: { contains: query, mode: "insensitive" } },
            },
          },
        ],
      }
    : {};

  const people = await prisma.person.findMany({
    where: { AND: [readablePeopleWhere(user.id), search] },
    orderBy: { displayName: "asc" },
    take: PAGE_SIZE,
    include: {
      contactPoints: {
        where: { kind: "EMAIL" },
        orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
        take: 1,
      },
    },
  });

  const total = await prisma.person.count({
    where: { AND: [readablePeopleWhere(user.id), search] },
  });

  return (
    <div>
      <PageHeader
        title="People"
        description={
          total === 1 ? "1 contact" : `${total.toLocaleString()} contacts`
        }
        action={
          <Link href="/people/new" className={btnPrimary}>
            New contact
          </Link>
        }
      />

      <form className="mb-4" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search name, organisation, notes or contact details…"
          aria-label="Search people"
          className={inputClass}
        />
      </form>

      <Card>
        {people.length === 0 ? (
          <EmptyState
            title={query ? `No one matches “${query}”` : "No contacts yet"}
            description={
              query
                ? "Try a different search term."
                : "Add the first person you want to keep track of."
            }
            action={
              !query ? (
                <Link href="/people/new" className={btnPrimary}>
                  New contact
                </Link>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Email
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
                    <td className="px-5 py-3">
                      <Link
                        href={`/people/${person.id}`}
                        className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        {person.displayName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-neutral-600 dark:text-neutral-400">
                      {primaryEmail(person.contactPoints) ?? "—"}
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
                        status={person.googleSyncStatus}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {total > people.length ? (
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          Showing the first {people.length} of {total.toLocaleString()}. Narrow
          the list with search.
        </p>
      ) : null}
    </div>
  );
}
