import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, trashedEventsWhere, trashedPeopleWhere } from "@/lib/access";
import { purgeEvent, restoreEvent } from "@/lib/actions/events";
import { purgePerson, restorePerson } from "@/lib/actions/people";
import { getUserSettings } from "@/lib/settings";
import { formatInstant } from "@/lib/time";
import { Card, CardHeader, EmptyState, Hint, PageHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { RestoreForm } from "@/components/restore-form";

/**
 * The trash.
 *
 * Deleting in Hearth moves a record here and stops there. Nothing empties this page on a
 * schedule: there is no retention window, no nightly job, no thirty days. A record leaves
 * only because somebody standing on this page said so, which is the whole point — the
 * cost of keeping a deleted contact is a row, and the cost of losing one is a row you
 * cannot get back.
 *
 * Owner-only, through trashedPeopleWhere / trashedEventsWhere. Somebody else's bin is not
 * a place you can look, even for a record they had shared with you.
 */
export default async function TrashPage() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);

  const [people, events] = await Promise.all([
    prisma.person.findMany({
      where: trashedPeopleWhere(user.id),
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        displayName: true,
        organization: true,
        deletedAt: true,
        linkedUserId: true,
        googleSyncs: { select: { googleResourceName: true } },
        _count: { select: { giftsReceived: true, eventAttendances: true } },
      },
    }),
    prisma.event.findMany({
      where: trashedEventsWhere(user.id),
      orderBy: { deletedAt: "desc" },
      select: {
        id: true,
        title: true,
        startAt: true,
        timeZone: true,
        deletedAt: true,
        _count: { select: { attendees: true, gifts: true } },
      },
    }),
  ]);

  const empty = people.length === 0 && events.length === 0;

  return (
    <div>
      <PageHeader
        title="Trash"
        description="Deleted contacts and events, kept until you say otherwise."
        action={
          <Hint label="How long is this kept?">
            For as long as you leave it here. The trash never empties itself — there is no
            retention period and nothing prunes it in the background. A record is destroyed
            only when you choose <em>Delete permanently</em> on this page.
          </Hint>
        }
      />

      {empty ? (
        <Card>
          <EmptyState
            title="The trash is empty"
            description="Anything you delete will wait here for you."
          />
        </Card>
      ) : null}

      {people.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title="Contacts" description={`${people.length} waiting`} />
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{person.displayName}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {person.organization ? `${person.organization} · ` : ""}
                    deleted{" "}
                    {person.deletedAt
                      ? formatInstant(person.deletedAt, settings.timeZone)
                      : "—"}
                    {/* What restoring brings back with it. Said here because a name alone
                        makes a contact look emptier than it is. */}
                    {person._count.eventAttendances > 0
                      ? ` · ${person._count.eventAttendances} event${
                          person._count.eventAttendances === 1 ? "" : "s"
                        }`
                      : ""}
                    {person._count.giftsReceived > 0
                      ? ` · ${person._count.giftsReceived} gift${
                          person._count.giftsReceived === 1 ? "" : "s"
                        }`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <RestoreForm
                    action={restorePerson}
                    id={person.id}
                    label="Restore"
                  />
                  {/* A card belonging to somebody who uses Hearth may sit here — it can
                      be trashed, as it could always be deleted — but it may not be
                      destroyed while they are attached to it. purgePerson refuses this
                      too; the control is withheld so the refusal is not a surprise. */}
                  {person.linkedUserId ? (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      A Hearth user’s card — unlink it in Settings → Household to delete
                      it for good
                    </span>
                  ) : (
                    <DeleteForm
                      action={purgePerson}
                      id={person.id}
                      label="Delete permanently"
                      pendingLabel="Deleting…"
                      confirmMessage={`Permanently delete ${person.displayName}? This cannot be undone, and its history goes with it.`}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {events.length > 0 ? (
        <Card>
          <CardHeader title="Events" description={`${events.length} waiting`} />
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {formatInstant(event.startAt, event.timeZone, { withTime: false })} ·
                    deleted{" "}
                    {event.deletedAt
                      ? formatInstant(event.deletedAt, settings.timeZone)
                      : "—"}
                    {event._count.attendees > 0
                      ? ` · ${event._count.attendees} there`
                      : ""}
                    {event._count.gifts > 0
                      ? ` · ${event._count.gifts} gift${
                          event._count.gifts === 1 ? "" : "s"
                        }`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <RestoreForm action={restoreEvent} id={event.id} label="Restore" />
                  <DeleteForm
                    action={purgeEvent}
                    id={event.id}
                    label="Delete permanently"
                    pendingLabel="Deleting…"
                    confirmMessage={`Permanently delete "${event.title}"? This cannot be undone.`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {people.some((p) => p.googleSyncs.some((g) => g.googleResourceName)) ? (
        <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
          Contacts in the trash have already been removed from Google — deleted has to mean
          deleted on your phone. Restoring one puts it back on the next sync.{" "}
          <Link href="/settings" className="underline">
            Sync settings
          </Link>
        </p>
      ) : null}
    </div>
  );
}
