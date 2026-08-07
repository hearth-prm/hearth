import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readableEventsWhere, readablePeopleWhere, requireUser } from "@/lib/access";
import { genericFields, loadRegistry } from "@/lib/fields/registry";
import { readFieldValue } from "@/lib/fields/values";
import { commonTimeZones, utcToWallClock } from "@/lib/time";
import { updateEvent } from "@/lib/actions/events";
import { PageHeader } from "@/components/ui";
import { EventForm } from "@/components/event-form";

const PEOPLE_LIMIT = 1000;

export default async function EditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const event = await prisma.event.findFirst({
    where: { id, ...readableEventsWhere(user.id) },
    include: { attendees: { select: { personId: true } } },
  });
  if (!event) notFound();

  const [defs, people] = await Promise.all([
    loadRegistry(user.id, "EVENT"),
    prisma.person.findMany({
      where: readablePeopleWhere(user.id),
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: PEOPLE_LIMIT,
    }),
  ]);

  const generic = genericFields(defs);
  const values = Object.fromEntries(
    generic.map((def) => [def.key, readFieldValue(event, def)]),
  );

  return (
    <div>
      <PageHeader title={`Edit ${event.title}`} />
      <EventForm
        action={updateEvent}
        defs={generic}
        values={values}
        eventId={event.id}
        schedule={{
          startAt: utcToWallClock(event.startAt, event.timeZone),
          endAt: event.endAt ? utcToWallClock(event.endAt, event.timeZone) : "",
          allDay: event.allDay,
          timeZone: event.timeZone,
        }}
        timeZones={commonTimeZones()}
        people={people}
        selectedAttendeeIds={event.attendees.map((a) => a.personId)}
        peopleTruncated={people.length === PEOPLE_LIMIT}
        addToGoogle={event.addToGoogle}
        synced={Boolean(event.googleEventId)}
        cancelHref={`/events/${event.id}`}
      />
    </div>
  );
}
