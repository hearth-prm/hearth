import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUser } from "@/lib/access";
import { genericFields, loadRegistry } from "@/lib/fields/registry";
import { getUserSettings } from "@/lib/settings";
import { commonTimeZones, utcToWallClock } from "@/lib/time";
import { createEvent } from "@/lib/actions/events";
import { PageHeader } from "@/components/ui";
import { searchPlaces } from "@/lib/actions/places";
import { EventForm } from "@/components/event-form";

const PEOPLE_LIMIT = 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

export default async function NewEventPage() {
  const user = await requireUser();
  const [defs, settings, people] = await Promise.all([
    loadRegistry(user.id, "EVENT"),
    getUserSettings(user.id),
    prisma.person.findMany({
      where: readablePeopleWhere(user.id),
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: PEOPLE_LIMIT,
    }),
  ]);

  // Default to the next half-hour boundary, an hour long.
  const start = new Date(Math.ceil(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return (
    <div>
      <PageHeader title="New event" />
      <EventForm
        action={createEvent}
        defs={genericFields(defs)}
        values={{}}
        schedule={{
          startAt: utcToWallClock(start, settings.timeZone),
          endAt: utcToWallClock(end, settings.timeZone),
          allDay: false,
          timeZone: settings.timeZone,
        }}
        timeZones={commonTimeZones()}
        people={people}
        selectedAttendeeIds={[]}
        peopleTruncated={people.length === PEOPLE_LIMIT}
        // Events are Hearth-only unless explicitly sent: see AddToGoogleToggle.
        addToGoogle={false}
        searchPlaces={searchPlaces}
        cancelHref="/events"
        submitLabel="Create event"
      />
    </div>
  );
}
