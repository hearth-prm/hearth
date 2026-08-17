import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  canWriteEvent,
  readableEventsWhere,
  readablePeopleWhere,
  requireUser,
} from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
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
  CollapsibleCard,
  DetailRow,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { AttendeesCard } from "@/components/attendees-card";
import { GiftForm, GiftEditForm, GiftRecipientForm, ThankYouButton } from "@/components/gift-forms";
import { listGiftsForEvent, listGiftRecipients } from "@/lib/gifts";
import { canSendMail } from "@/lib/google/mail";
import {
  addGift,
  addGiftRecipient,
  removeGift,
  removeGiftRecipient,
  sendThankYou,
  updateGift,
} from "@/lib/actions/gifts";
import { DeleteForm } from "@/components/delete-form";
import { AttendeeSearch } from "@/components/attendee-search";
import { ShareRecordForm } from "@/components/share-forms";
import { shareRecord } from "@/lib/actions/shares";
import { listOtherUsers } from "@/lib/users";
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
  // A VIEW share grants neither ownership nor editing. Asked of the access layer so
  // the controls offered here match what the actions will accept.
  const canEdit = isOwner || (await canWriteEvent(user.id, event.id));

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

  const shareableUsers = isOwner ? await listOtherUsers(user.id) : [];

  const [gifts, giftRecipients, mailAllowed] = await Promise.all([
    listGiftsForEvent(user.id, event.id),
    listGiftRecipients(event.id),
    canSendMail(user.id),
  ]);

  // Anyone readable can be a giver; recipients are drawn from the gift list, which is
  // what makes "who is this for" a decision made once rather than per present.
  // Which gift recipients can actually be emailed. Gathered here so the button can say
  // why it is disabled rather than failing once pressed.
  const recipientEmails = new Set(
    (
      await prisma.person.findMany({
        where: {
          AND: [
            readablePeopleWhere(user.id),
            { giftEvents: { some: { eventId: event.id } } },
            { contactPoints: { some: { kind: "EMAIL" } } },
          ],
        },
        select: { id: true },
      })
    ).map((p) => p.id),
  );

  const giverChoices = await prisma.person.findMany({
    where: readablePeopleWhere(user.id),
    orderBy: { displayName: "asc" },
    take: 500,
    select: { id: true, displayName: true },
  });

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
            {canEdit ? (
              <Link href={`/events/${event.id}/edit`} className={btnSecondary}>
                Edit
              </Link>
            ) : null}
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

          <AttendeesCard
            attendees={event.attendees.map((a) => ({
              id: a.id,
              personId: a.person.id,
              displayName: a.person.displayName,
              email: primaryEmail(a.person.contactPoints),
              role: a.role,
              rsvp: a.rsvp,
              inviteToGoogle: a.inviteToGoogle,
              rsvpFromGoogle: Boolean(a.rsvpFromGoogleAt),
            }))}
            canEdit={canEdit}
            updateAction={updateAttendee}
            removeAction={removeAttendee}
            addForm={
              <form action={addAttendee}>
                <input type="hidden" name="eventId" value={event.id} />
                <AttendeeSearch search={searchPeople} eventId={event.id} />
              </form>
            }
          />

          {gifts.length > 0 || canEdit ? (
            <CollapsibleCard
              title="Gifts"
              description="Who the presents are for, and what each person was given."
              meta={gifts.length > 0 ? `${gifts.length}` : undefined}
              // Open when there is something recorded, since then it is worth reading;
              // otherwise it stays out of the way of an occasion with no presents.
              defaultOpen={gifts.length > 0}
            >
              {canEdit ? (
                <div className="border-b border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
                  <GiftRecipientForm
                    action={addGiftRecipient}
                    eventId={event.id}
                    people={giverChoices}
                  />
                </div>
              ) : null}

              {giftRecipients.length === 0 ? (
                <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                  Say who the gifts are for, then record what they were given.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                  {giftRecipients.map((entry) => {
                    const theirs = gifts.filter((g) => g.recipientId === entry.personId);
                    return (
                      <li key={entry.personId} className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Link
                            href={`/people/${entry.person.id}`}
                            className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                          >
                            {entry.person.displayName}
                          </Link>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500 dark:text-neutral-400">
                              {theirs.length === 1 ? "1 gift" : `${theirs.length} gifts`}
                            </span>
                            {canEdit ? (
                              <DeleteForm
                                action={removeGiftRecipient}
                                id={entry.personId}
                                extra={{ eventId: event.id }}
                                label="Remove"
                                pendingLabel="Removing…"
                                confirmMessage={`Take ${entry.person.displayName} off the gift list? Gifts already recorded for them are kept.`}
                                className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                              />
                            ) : null}
                          </div>
                        </div>

                        {theirs.length > 0 ? (
                          // Indented under the recipient they belong to, matching how
                          // the contact page sets gift rows in from their heading.
                          <ul className="mt-1.5 space-y-1 pl-5">
                            {theirs.map((gift) => (
                              <li key={gift.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                                <span className="min-w-0">
                                  {gift.description}{" "}
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    from
                                  </span>{" "}
                                  {/* Writing a thank-you starts with looking up who to
                                      thank, so the giver is the one name on this row
                                      worth being a way to their details. */}
                                  <Link
                                    href={`/people/${gift.giver.id}`}
                                    className="text-accent-700 hover:underline dark:text-accent-400"
                                  >
                                    {gift.giver.displayName}
                                  </Link>
                                  {gift.notes ? (
                                    <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                                      {gift.notes}
                                    </span>
                                  ) : null}
                                  {gift.thankedAt ? (
                                    <span className="ml-1 text-xs text-emerald-700 dark:text-emerald-400">
                                      thanked
                                    </span>
                                  ) : null}
                                </span>
                                {canEdit ? (
                                  <span className="flex shrink-0 items-center gap-3">
                                    <GiftEditForm
                                      action={updateGift}
                                      giftId={gift.id}
                                      hasEvent
                                      current={{
                                        description: gift.description,
                                        notes: gift.notes ?? "",
                                        receivedOn: "",
                                      }}
                                    />
                                    <DeleteForm
                                      action={removeGift}
                                      id={gift.id}
                                      label="Remove"
                                      pendingLabel="Removing…"
                                      confirmMessage={`Remove "${gift.description}"?`}
                                      className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                                    />
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}

                        <div className="mt-3">
                          <ThankYouButton
                            action={sendThankYou}
                            recipientId={entry.personId}
                            recipientName={entry.person.displayName}
                            eventId={event.id}
                            canSend={mailAllowed}
                            hasEmail={recipientEmails.has(entry.personId)}
                            giftCount={theirs.length}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {canEdit && giftRecipients.length > 0 ? (
                <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
                  <GiftForm
                    action={addGift}
                    eventId={event.id}
                    givers={giverChoices}
                    recipients={giftRecipients.map((r) => r.person)}
                  />
                </div>
              ) : null}
            </CollapsibleCard>
          ) : null}
        </div>

        <div className="space-y-6">
          {isOwner ? (
            <CollapsibleCard
              title="Sharing"
              description="Give someone else access."
              meta={myShares.length > 0 ? `${myShares.length}` : undefined}
            >
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
                <ShareRecordForm
                  action={shareRecord}
                  users={shareableUsers}
                  alreadyShared={myShares.map((sh) => sh.withUserId)}
                  eventId={event.id}
                />
              </div>
            </CollapsibleCard>
          ) : null}

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
                      className="text-accent-700 hover:underline dark:text-accent-400"
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
                        className="text-accent-700 hover:underline dark:text-accent-400"
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
