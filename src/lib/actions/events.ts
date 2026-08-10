"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  filterReadablePeopleIds,
  requireOwnedEvent,
  requireUserForAction,
  requireWritableEvent,
} from "@/lib/access";
import { genericFields, loadRegistry } from "@/lib/fields/registry";
import { parseFields } from "@/lib/fields/validation";
import { partitionFieldValues, readCustomBag } from "@/lib/fields/values";
import { parseRole, parseRsvp, parseSchedule } from "@/lib/events";
import { getUserSettings } from "@/lib/settings";
import { actionError, type ActionState } from "@/lib/actions/types";
import {
  asColumnData,
  isFrameworkError,
  readCheckbox,
  readString,
  toActionError,
} from "@/lib/actions/shared";
import { cancelPendingDeletion, queueEventDeletion } from "@/lib/sync/tombstones";

export async function createEvent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const user = await requireUserForAction();
    const settings = await getUserSettings(user.id);
    const registry = await loadRegistry(user.id, "EVENT");

    const parsed = parseFields(genericFields(registry), form);
    if (!parsed.ok) {
      return actionError("Please fix the highlighted fields.", parsed.errors);
    }
    const when = parseSchedule(form, settings.timeZone);
    if (!when.ok) {
      return actionError("Please check the event's dates.", when.errors);
    }

    const addToGoogle = form.has("addToGooglePresent")
      ? readCheckbox(form, "addToGoogle")
      : settings.defaultAddToGoogle;

    const attendeeIds = await filterReadablePeopleIds(
      user.id,
      form.getAll("attendeeId").map(String).filter(Boolean),
    );

    const { columns, custom } = partitionFieldValues(
      genericFields(registry),
      parsed.values,
      {},
      { timeZone: when.schedule.timeZone },
    );

    const created = await prisma.event.create({
      data: {
        ...asColumnData<Prisma.EventUncheckedCreateInput>(columns),
        ownerId: user.id,
        title: String(parsed.values.title ?? "Untitled event"),
        startAt: when.schedule.startAt,
        endAt: when.schedule.endAt,
        allDay: when.schedule.allDay,
        timeZone: when.schedule.timeZone,
        custom: custom as Prisma.InputJsonValue,
        addToGoogle,
        googleSyncStatus: addToGoogle ? "PENDING" : "DISABLED",
        attendees: attendeeIds.length
          ? {
              create: attendeeIds.map((personId) => ({
                personId,
                inviteToGoogle: settings.inviteAttendees,
              })),
            }
          : undefined,
      },
      select: { id: true },
    });
    newId = created.id;
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/events");
  redirect(`/events/${newId}`);
}

export async function updateEvent(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const id = readString(form, "id");
  try {
    const user = await requireUserForAction();
    await requireWritableEvent(user.id, id);

    const existing = await prisma.event.findUniqueOrThrow({
      where: { id },
      select: {
        custom: true,
        addToGoogle: true,
        googleEventId: true,
        googleCalendarId: true,
        googleEtag: true,
        attendees: { select: { id: true, personId: true } },
      },
    });

    const settings = await getUserSettings(user.id);
    const registry = await loadRegistry(user.id, "EVENT");

    const parsed = parseFields(genericFields(registry), form);
    if (!parsed.ok) {
      return actionError("Please fix the highlighted fields.", parsed.errors);
    }
    const when = parseSchedule(form, settings.timeZone);
    if (!when.ok) {
      return actionError("Please check the event's dates.", when.errors);
    }

    const addToGoogle = readCheckbox(form, "addToGoogle");
    const optedOut = existing.addToGoogle && !addToGoogle;
    const optedIn = !existing.addToGoogle && addToGoogle;

    const selectedIds = new Set(
      await filterReadablePeopleIds(
        user.id,
        form.getAll("attendeeId").map(String).filter(Boolean),
      ),
    );
    const currentIds = new Set(existing.attendees.map((a) => a.personId));
    // Diff rather than replace: an EventAttendee row carries the RSVP, which
    // must survive an unrelated edit to the event's title.
    const toAdd = [...selectedIds].filter((pid) => !currentIds.has(pid));
    const toRemove = existing.attendees
      .filter((a) => !selectedIds.has(a.personId))
      .map((a) => a.id);

    const { columns, custom } = partitionFieldValues(
      genericFields(registry),
      parsed.values,
      readCustomBag(existing),
      { timeZone: when.schedule.timeZone },
    );

    await prisma.$transaction(async (tx) => {
      if (optedOut && existing.googleEventId) {
        await queueEventDeletion(tx, {
          ownerId: user.id,
          eventId: existing.googleEventId,
          calendarId: existing.googleCalendarId,
          etag: existing.googleEtag,
          reason: "opted_out",
        });
      }
      if (optedIn && existing.googleEventId) {
        await cancelPendingDeletion(tx, "GOOGLE_EVENT", existing.googleEventId);
      }

      await tx.event.update({
        where: { id },
        data: {
          ...asColumnData<Prisma.EventUncheckedUpdateInput>(columns),
          startAt: when.schedule.startAt,
          endAt: when.schedule.endAt,
          allDay: when.schedule.allDay,
          timeZone: when.schedule.timeZone,
          custom: custom as Prisma.InputJsonValue,
          addToGoogle,
          googleSyncStatus: addToGoogle ? "PENDING" : "DISABLED",
          googleSyncError: null,
        },
      });

      if (toRemove.length) {
        await tx.eventAttendee.deleteMany({ where: { id: { in: toRemove } } });
      }
      if (toAdd.length) {
        await tx.eventAttendee.createMany({
          data: toAdd.map((personId) => ({
            eventId: id,
            personId,
            inviteToGoogle: settings.inviteAttendees,
          })),
          skipDuplicates: true,
        });
      }
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  redirect(`/events/${id}`);
}

export async function deleteEvent(form: FormData): Promise<void> {
  const id = readString(form, "id");
  const user = await requireUserForAction();
  // Owner-only, as with contacts.
  await requireOwnedEvent(user.id, id);

  const existing = await prisma.event.findUnique({
    where: { id },
    select: { googleEventId: true, googleCalendarId: true, googleEtag: true },
  });

  await prisma.$transaction(async (tx) => {
    if (existing?.googleEventId) {
      await queueEventDeletion(tx, {
        ownerId: user.id,
        eventId: existing.googleEventId,
        calendarId: existing.googleCalendarId,
        etag: existing.googleEtag,
        reason: "deleted",
      });
    }
    await tx.event.delete({ where: { id } });
  });

  revalidatePath("/events");
  redirect("/events");
}

// --- attendee management (event detail page) -------------------------------

export async function addAttendee(form: FormData): Promise<void> {
  const eventId = readString(form, "eventId");
  const personId = readString(form, "personId");
  const user = await requireUserForAction();
  await requireWritableEvent(user.id, eventId);
  const [allowed] = await filterReadablePeopleIds(user.id, [personId]);
  if (!allowed) return;

  const settings = await getUserSettings(user.id);
  await prisma.eventAttendee.createMany({
    data: [{ eventId, personId: allowed, inviteToGoogle: settings.inviteAttendees }],
    skipDuplicates: true,
  });
  await markEventPending(eventId);
  revalidatePath(`/events/${eventId}`);
}

export async function updateAttendee(form: FormData): Promise<void> {
  const attendeeId = readString(form, "attendeeId");
  const user = await requireUserForAction();

  const row = await prisma.eventAttendee.findUnique({
    where: { id: attendeeId },
    select: { eventId: true },
  });
  if (!row) return;
  await requireWritableEvent(user.id, row.eventId);

  await prisma.eventAttendee.update({
    where: { id: attendeeId },
    data: {
      role: parseRole(readString(form, "role")),
      rsvp: parseRsvp(readString(form, "rsvp")),
      inviteToGoogle: readCheckbox(form, "inviteToGoogle"),
      // Set locally, so clear the marker saying the value came from Google.
      rsvpFromGoogleAt: null,
    },
  });
  await markEventPending(row.eventId);
  revalidatePath(`/events/${row.eventId}`);
}

export async function removeAttendee(form: FormData): Promise<void> {
  const attendeeId = readString(form, "attendeeId");
  const user = await requireUserForAction();

  const row = await prisma.eventAttendee.findUnique({
    where: { id: attendeeId },
    select: { eventId: true },
  });
  if (!row) return;
  await requireWritableEvent(user.id, row.eventId);

  await prisma.eventAttendee.delete({ where: { id: attendeeId } });
  await markEventPending(row.eventId);
  revalidatePath(`/events/${row.eventId}`);
}

/** An attendee change alters the Google invite list, so the event needs a push. */
async function markEventPending(eventId: string): Promise<void> {
  await prisma.event.updateMany({
    where: { id: eventId, addToGoogle: true },
    data: { googleSyncStatus: "PENDING" },
  });
}
