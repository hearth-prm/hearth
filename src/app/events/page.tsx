import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readableEventsWhere, requireUser } from "@/lib/access";
import { listFields, loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import { formatInstant } from "@/lib/time";
import {
  Badge,
  btnPrimary,
  Card,
  CardHeader,
  EmptyState,
  inputClass,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const defs = await loadRegistry(user.id, "EVENT");
  const columns = listFields(defs).filter(
    (d) => d.key !== "title" && d.key !== "startAt",
  );

  const search: Prisma.EventWhereInput = query
    ? {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { location: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          {
            attendees: {
              some: {
                person: { displayName: { contains: query, mode: "insensitive" } },
              },
            },
          },
        ],
      }
    : {};

  const where = { AND: [readableEventsWhere(user.id), search] };
  const now = new Date();

  // Upcoming ascending (soonest first) and past descending (most recent first)
  // — two queries rather than one sort, because "nearest in time" runs in
  // opposite directions on either side of now.
  const [upcoming, past] = await Promise.all([
    prisma.event.findMany({
      where: { AND: [...where.AND, { startAt: { gte: now } }] },
      orderBy: { startAt: "asc" },
      include: { _count: { select: { attendees: true } }, owner: { select: { email: true } } },
      take: 100,
    }),
    prisma.event.findMany({
      where: { AND: [...where.AND, { startAt: { lt: now } }] },
      orderBy: { startAt: "desc" },
      include: { _count: { select: { attendees: true } }, owner: { select: { email: true } } },
      take: 100,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Events"
        description="Dinners, parties, meetings — and who was there."
        action={
          <Link href="/events/new" className={btnPrimary}>
            New event
          </Link>
        }
      />

      <form className="mb-4" role="search">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search title, location, description or attendee…"
          aria-label="Search events"
          className={inputClass}
        />
      </form>

      {upcoming.length === 0 && past.length === 0 ? (
        <Card>
          <EmptyState
            title={query ? `No events match “${query}”` : "No events yet"}
            description={
              query
                ? "Try a different search term."
                : "Record a gathering and link the people who were there."
            }
            action={
              !query ? (
                <Link href="/events/new" className={btnPrimary}>
                  New event
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <EventGroup title="Upcoming" events={upcoming} columns={columns} viewerId={user.id} />
          <EventGroup title="Past" events={past} columns={columns} viewerId={user.id} />
        </div>
      )}
    </div>
  );
}

type EventRow = Prisma.EventGetPayload<{
  include: {
    _count: { select: { attendees: true } };
    owner: { select: { email: true } };
  };
}>;

function EventGroup({
  title,
  events,
  columns,
  viewerId,
}: {
  title: string;
  events: EventRow[];
  columns: ReturnType<typeof listFields>;
  viewerId: string;
}) {
  if (events.length === 0) return null;

  return (
    <Card>
      <CardHeader title={title} description={`${events.length} event${events.length === 1 ? "" : "s"}`} />
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
          >
            <div className="min-w-0">
              <Link
                href={`/events/${event.id}`}
                className="font-medium text-accent-700 hover:underline dark:text-accent-400"
              >
                {event.title}
              </Link>
              {event.ownerId !== viewerId ? (
                <span
                  className="ml-2 text-xs text-amber-700 dark:text-amber-400"
                  title={`Shared by ${event.owner.email}`}
                >
                  shared
                </span>
              ) : null}
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {formatInstant(event.startAt, event.timeZone, {
                  withTime: !event.allDay,
                })}
                {event.allDay ? " · all day" : ""}
                {event.location ? ` · ${event.location}` : ""}
              </p>
              {columns.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500 dark:text-neutral-400">
                  {columns.map((c) => {
                    const text = formatFieldValue(
                      c,
                      readFieldValue(event, c),
                      event.timeZone,
                    );
                    if (!text) return null;
                    return (
                      <span key={c.key}>
                        <span className="text-neutral-400">{c.label}:</span> {text}
                      </span>
                    );
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge>
                {event._count.attendees}{" "}
                {event._count.attendees === 1 ? "person" : "people"}
              </Badge>
              <SyncBadge
                addToGoogle={event.addToGoogle}
                status={event.googleSyncStatus}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
