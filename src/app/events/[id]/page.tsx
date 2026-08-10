import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readableEventsWhere, readablePeopleWhere, requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import {
  ATTENDEE_ROLE_LABELS,
  ATTENDEE_ROLES,
  RSVP_LABELS,
  RSVP_STATUSES,
} from "@/lib/events";
import { primaryEmail } from "@/lib/people";
import { getUserSettings } from "@/lib/settings";
import { formatInstant } from "@/lib/time";
import {
  addAttendee,
  deleteEvent,
  removeAttendee,
  updateAttendee,
} from "@/lib/actions/events";
import {
  Badge,
  btnDanger,
  btnSecondary,
  Card,
  CardHeader,
  DetailRow,
  inputClass,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { DeleteForm } from "@/components/delete-form";
import { SubmitButton } from "@/components/submit-button";
import { AttendeeSearch } from "@/components/attendee-search";
import { ShareRecordForm } from "@/components/share-forms";
import { shareRecord } from "@/lib/actions/shares";
import { searchPeople } from "@/lib/actions/people-search";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const event = await prisma.event.findFirst({
    where: { id, ...readableEventsWhere(user.id) },
    include: {
      owner: { select: { id: true, email: true } },
      attendees: {
        include: {
          person: {
            select: {
              id: true,
              displayName: true,
              contactPoints: {
                where: { kind: "EMAIL" },
                orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
                take: 1,
              },
            },
          },
        },
        orderBy: [{ role: "asc" }, { person: { displayName: "asc" } }],
      },
    },
  });
  if (!event) notFound();

  const isOwner = event.ownerId === user.id;

  // The registry belongs to the event's owner: a shared event's custom values are
  // keyed by the owner's field definitions, not the viewer's.
  const [defs, settings, myShares] = await Promise.all([
    loadRegistry(event.ownerId, "EVENT"),
    getUserSettings(user.id),
    isOwner
      ? prisma.share.findMany({
          where: { ownerId: user.id, scope: "EVENT", eventId: event.id },
          include: { withUser: { select: { email: true } } },
        })
      : Promise.resolve([]),
  ]);

  // Guests Google cannot be told about: it identifies attendees only by email.
  const uninvitable = event.attendees
    .filter((a) => a.inviteToGoogle && a.person.contactPoints.length === 0)
    .map((a) => a.person.displayName);

  const populated = defs
    // Every core field with a row of its own above, or the registry loop renders
    // it a second time — which is how "location" came to appear twice.
    .filter(
      (d) =>
        !["title", "startAt", "endAt", "allDay", "timeZone", "location", "description"].includes(
          d.key,
        ),
    )
    .map((def) => ({ def, value: readFieldValue(event, def) }))
    .filter(({ def, value }) => formatFieldValue(def, value, event.timeZone).length > 0);

  return (
    <div>
      <PageHeader
        title={event.title}
        description={formatInstant(event.startAt, event.timeZone, {
          withTime: !event.allDay,
        })}
        action={
          <div className="flex items-center gap-2">
            {!isOwner ? (
              <Badge tone="amber">shared by {event.owner.email}</Badge>
            ) : null}
            <Link href={`/events/${event.id}/edit`} className={btnSecondary}>
              Edit
            </Link>
            {isOwner ? (
              <DeleteForm
                action={deleteEvent}
                id={event.id}
                label="Delete"
                className={btnDanger}
                confirmMessage={`Delete "${event.title}"? ${
                  event.googleEventId
                    ? "The Google Calendar event will be removed on the next sync."
                    : ""
                }`}
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Details"
              action={
                <SyncBadge
                  addToGoogle={event.addToGoogle}
                  status={event.googleSyncStatus}
                />
              }
            />
            <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              <DetailRow label="Starts">
                {formatInstant(event.startAt, event.timeZone, {
                  withTime: !event.allDay,
                })}
              </DetailRow>
              {event.endAt ? (
                <DetailRow label="Ends">
                  {formatInstant(event.endAt, event.timeZone, {
                    withTime: !event.allDay,
                  })}
                </DetailRow>
              ) : null}
              <DetailRow label="Time zone">
                {event.timeZone}
                {event.allDay ? " · all day" : ""}
              </DetailRow>
              {event.location ? (
                <DetailRow label="Location">{event.location}</DetailRow>
              ) : null}
              {populated.map(({ def, value }) => (
                <DetailRow key={def.key} label={def.label}>
                  {formatFieldValue(def, value, event.timeZone)}
                </DetailRow>
              ))}
            </dl>
          </Card>

          {event.description ? (
            <Card>
              <CardHeader title="Description" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">
                {event.description}
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Who was there"
              description={`${event.attendees.length} ${
                event.attendees.length === 1 ? "person" : "people"
              }`}
            />

            {event.attendees.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                No one linked yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {event.attendees.map((a) => {
                  const email = primaryEmail(a.person.contactPoints);
                  return (
                    <li key={a.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link
                            href={`/people/${a.person.id}`}
                            className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                          >
                            {a.person.displayName}
                          </Link>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                            {email ?? "no email on file"}
                            {a.rsvpFromGoogleAt ? (
                              <span className="ml-2 text-teal-600 dark:text-teal-400">
                                RSVP from Google
                              </span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={a.rsvp === "ACCEPTED" ? "teal" : a.rsvp === "DECLINED" ? "rose" : "neutral"}>
                            {RSVP_LABELS[a.rsvp]}
                          </Badge>
                          <DeleteForm
                            action={removeAttendee}
                            id={a.id}
                            idName="attendeeId"
                            label="Remove"
                            pendingLabel="Removing…"
                            className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                            confirmMessage={`Remove ${a.person.displayName} from this event?`}
                          />
                        </div>
                      </div>

                      <form
                        action={updateAttendee}
                        className="mt-3 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="attendeeId" value={a.id} />
                        <label className="text-xs text-neutral-500 dark:text-neutral-400">
                          Role
                          <select
                            name="role"
                            defaultValue={a.role}
                            className={`${inputClass} mt-1 py-1.5`}
                          >
                            {ATTENDEE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ATTENDEE_ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs text-neutral-500 dark:text-neutral-400">
                          RSVP
                          <select
                            name="rsvp"
                            defaultValue={a.rsvp}
                            className={`${inputClass} mt-1 py-1.5`}
                          >
                            {RSVP_STATUSES.map((r) => (
                              <option key={r} value={r}>
                                {RSVP_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 pb-2 text-xs text-neutral-500 dark:text-neutral-400">
                          <input
                            type="checkbox"
                            name="inviteToGoogle"
                            defaultChecked={a.inviteToGoogle}
                            className="size-3.5 rounded border-neutral-300 text-teal-600 dark:border-neutral-600"
                          />
                          Invite in Google
                        </label>
                        <SubmitButton
                          className={`${btnSecondary} py-1.5`}
                          pendingLabel="Saving…"
                        >
                          Update
                        </SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
              <form action={addAttendee}>
                <input type="hidden" name="eventId" value={event.id} />
                <AttendeeSearch search={searchPeople} eventId={event.id} />
              </form>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Google" />
            <dl className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
              <DetailRow label="Add to Google">
                {event.addToGoogle ? "Yes" : "No"}
              </DetailRow>
              {event.googleCalendarId ? (
                <DetailRow label="Calendar">{event.googleCalendarId}</DetailRow>
              ) : null}
              {event.addToGoogle && event.googleEventId ? (
                <DetailRow label="Google event">
                  {event.googleHtmlLink ? (
                    <a
                      href={event.googleHtmlLink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-teal-700 hover:underline dark:text-teal-400"
                    >
                      Open in Google Calendar
                    </a>
                  ) : (
                    <>
                      {/* Synced before the link was captured; the day view still
                          gets you there without guessing at an event URL. */}
                      <a
                        href={`https://calendar.google.com/calendar/u/0/r/day/${event.startAt.getUTCFullYear()}/${event.startAt.getUTCMonth() + 1}/${event.startAt.getUTCDate()}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-teal-700 hover:underline dark:text-teal-400"
                      >
                        Open that day in Google Calendar
                      </a>
                      <span className="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                        Re-sync this event to get a direct link.
                      </span>
                    </>
                  )}
                </DetailRow>
              ) : null}
              {uninvitable.length > 0 ? (
                <DetailRow label="Not invited">
                  <span className="text-amber-700 dark:text-amber-400">
                    {uninvitable.join(", ")}
                  </span>
                  <span className="mt-0.5 block text-neutral-500 dark:text-neutral-400">
                    Google identifies guests by email address, so anyone without one
                    cannot be added. They stay on the Hearth guest list.
                  </span>
                </DetailRow>
              ) : null}
              {event.googleSyncedAt ? (
                <DetailRow label="Last synced">
                  {formatInstant(event.googleSyncedAt, settings.timeZone)}
                </DetailRow>
              ) : null}
              {event.googleSyncError ? (
                <DetailRow label="Sync error">
                  <span className="text-rose-600 dark:text-rose-400">
                    {event.googleSyncError}
                  </span>
                </DetailRow>
              ) : null}
            </dl>
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader title="Sharing" description="Give someone else access." />
              <div className="space-y-3 px-5 py-4">
                {myShares.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {myShares.map((sh) => (
                      <li key={sh.id} className="text-neutral-600 dark:text-neutral-400">
                        {sh.withUser.email} —{" "}
                        {sh.permission === "EDIT" ? "can edit" : "view only"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ShareRecordForm action={shareRecord} eventId={event.id} />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Record" />
            <dl className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
              <DetailRow label="Created">
                {formatInstant(event.createdAt, settings.timeZone)}
              </DetailRow>
              <DetailRow label="Updated">
                {formatInstant(event.updatedAt, settings.timeZone)}
              </DetailRow>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
