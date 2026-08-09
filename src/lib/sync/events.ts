import type { RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { GoogleAuthError } from "@/lib/google/auth";
import { backoffMs, classifyGoogleError } from "@/lib/google/errors";
import type { CalendarClient, SendUpdates } from "@/lib/google/calendar-client";
import {
  responsesOf,
  serializeEvent,
  type AttendeeWithPerson,
} from "@/lib/google/serialize-event";
import { queueEventDeletion } from "./tombstones";

/**
 * Push Hearth events to Google Calendar, and pull guest RSVPs back.
 *
 * The RSVP pull is the single place in Hearth where Google is authoritative.
 * Everything else is one-way outward: a guest's reply is information Hearth cannot
 * possibly know, whereas an event's title is something it owns.
 */

export interface EventSyncResult {
  created: number;
  updated: number;
  deleted: number;
  /** Events moved because the target calendar changed. */
  moved: number;
  failed: number;
  /** Attendee RSVPs changed by a Google reply. */
  rsvpsUpdated: number;
  /** Attendees that could not be sent, most often for want of an email. */
  attendeesSkipped: number;
  rateLimited: boolean;
  errors: string[];
}

export interface EventSyncDeps {
  calendar: CalendarClient;
  now?: () => Date;
}

export interface EventSyncOptions {
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 25;

/** How far back to look on the very first RSVP poll. */
const FIRST_POLL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Overlap applied to every poll window.
 *
 * `updatedMin` is exclusive-ish and clocks drift, so re-reading a few minutes of
 * already-seen changes is far cheaper than missing an RSVP permanently — the poll
 * is idempotent, since it only ever writes the status Google reports.
 */
const POLL_OVERLAP_MS = 5 * 60 * 1000;

const RSVP_FROM_GOOGLE: Record<string, RsvpStatus> = {
  needsAction: "NEEDS_ACTION",
  declined: "DECLINED",
  tentative: "TENTATIVE",
  accepted: "ACCEPTED",
};

function emptyResult(): EventSyncResult {
  return {
    created: 0,
    updated: 0,
    deleted: 0,
    moved: 0,
    failed: 0,
    rsvpsUpdated: 0,
    attendeesSkipped: 0,
    rateLimited: false,
    errors: [],
  };
}

export function summariseEvents(r: EventSyncResult): string {
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} created`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.moved) parts.push(`${r.moved} moved calendar`);
  if (r.deleted) parts.push(`${r.deleted} removed`);
  if (r.rsvpsUpdated) parts.push(`${r.rsvpsUpdated} RSVP${r.rsvpsUpdated === 1 ? "" : "s"}`);
  if (r.attendeesSkipped) parts.push(`${r.attendeesSkipped} guest${r.attendeesSkipped === 1 ? "" : "s"} skipped`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.rateLimited) parts.push("paused on Google's rate limit");
  return parts.length ? parts.join(", ") : "nothing to do";
}

function short(message: string): string {
  return message.length > 500 ? `${message.slice(0, 497)}…` : message;
}

/**
 * Whether Google should email the guests for this event.
 *
 * Suppressed for anything already finished even when notifications are on,
 * because Hearth is routinely used to record past gatherings and mailing their
 * attendees would be both wrong and impossible to undo.
 */
export function sendUpdatesFor(
  event: { startAt: Date; endAt: Date | null },
  sendInvites: boolean,
  now: Date,
): SendUpdates {
  if (!sendInvites) return "none";
  const finishesAt = event.endAt ?? event.startAt;
  return finishesAt.getTime() >= now.getTime() ? "all" : "none";
}

export async function syncEventsForUser(
  userId: string,
  deps: EventSyncDeps,
  options: EventSyncOptions = {},
): Promise<EventSyncResult> {
  const now = deps.now ?? (() => new Date());
  const runStartedAt = now();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const result = emptyResult();

  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      googleCalendarId: true,
      inviteAttendees: true,
      sendInvites: true,
      importRsvps: true,
      calendarRsvpCheckedAt: true,
    },
  });
  if (!settings) return result;

  const targetCalendar = settings.googleCalendarId || "primary";

  // --- 1. deletions ------------------------------------------------------
  const tombstones = await prisma.syncTombstone.findMany({
    where: {
      ownerId: userId,
      target: "GOOGLE_EVENT",
      processedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  for (const tombstone of tombstones) {
    try {
      await deps.calendar.deleteEvent({
        // The event may have lived on a calendar the user has since changed away
        // from, so the tombstone's own calendarId is authoritative here.
        calendarId: tombstone.calendarId || targetCalendar,
        eventId: tombstone.resourceId,
        sendUpdates: "none",
      });
      await settleEventTombstone(tombstone.id, userId, tombstone.resourceId);
      result.deleted += 1;
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);

      // Google answers 410 Gone for an event already deleted; either way the goal
      // state is reached, so treat it as done rather than retrying forever.
      if (classified.kind === "not_found" || classified.status === 410) {
        await settleEventTombstone(tombstone.id, userId, tombstone.resourceId);
        result.deleted += 1;
        continue;
      }
      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
        break;
      }

      const attempts = tombstone.attempts + 1;
      await prisma.syncTombstone.update({
        where: { id: tombstone.id },
        data: {
          attempts,
          nextAttemptAt: new Date(now().getTime() + backoffMs(attempts)),
          lastError: short(classified.message),
        },
      });
      result.failed += 1;
      result.errors.push(`delete event ${tombstone.resourceId}: ${classified.message}`);
    }
  }

  if (result.rateLimited) return result;

  // --- 2. pushes ---------------------------------------------------------
  const queue = await prisma.event.findMany({
    where: {
      ownerId: userId,
      addToGoogle: true,
      googleSyncStatus: { in: ["PENDING", "ERROR"] },
      OR: [
        { googleSyncNextAttemptAt: null },
        { googleSyncNextAttemptAt: { lte: now() } },
      ],
    },
    include: {
      attendees: {
        include: {
          person: {
            select: {
              id: true,
              displayName: true,
              contactPoints: {
                where: { kind: "EMAIL" },
                orderBy: [{ isPrimary: "desc" }, { order: "asc" }],
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: batchSize,
  });

  for (const event of queue) {
    try {
      const sendUpdates = sendUpdatesFor(event, settings.sendInvites, now());

      // A changed target calendar means the old copy has to go, or it is orphaned
      // on a calendar Hearth no longer touches.
      if (event.googleEventId && event.googleCalendarId && event.googleCalendarId !== targetCalendar) {
        await prisma.$transaction(async (tx) => {
          await queueEventDeletion(tx, {
            ownerId: userId,
            eventId: event.googleEventId!,
            calendarId: event.googleCalendarId,
            etag: event.googleEtag,
            reason: "opted_out",
          });
          await tx.event.update({
            where: { id: event.id },
            data: { googleEventId: null, googleEtag: null },
          });
        });
        event.googleEventId = null;
        event.googleCalendarId = null;
        result.moved += 1;
      }

      let existingResponses: Map<string, string> | undefined;
      let mustCreate = !event.googleEventId;

      if (event.googleEventId) {
        // Read before patching for two reasons: a patch containing `attendees`
        // replaces the list, so each guest's responseStatus has to be carried
        // across or every push resets their RSVP; and the same response makes the
        // freshest RSVPs available without a second call.
        const remote = await deps.calendar.getEvent(targetCalendar, event.googleEventId);
        if (!remote || remote.status === "cancelled") {
          mustCreate = true;
        } else {
          existingResponses = responsesOf(remote);
          result.rsvpsUpdated += await applyResponses(event.id, existingResponses, now());
        }
      }

      const { event: payload, invited, skipped } = serializeEvent(
        event,
        event.attendees as AttendeeWithPerson[],
        {
          includeAttendees: settings.inviteAttendees,
          existingResponses,
        },
      );
      result.attendeesSkipped += skipped.length;

      const written = mustCreate
        ? await deps.calendar.insertEvent({
            calendarId: targetCalendar,
            event: payload,
            sendUpdates,
          })
        : await deps.calendar.patchEvent({
            calendarId: targetCalendar,
            eventId: event.googleEventId!,
            event: payload,
            sendUpdates,
          });

      await prisma.$transaction(async (tx) => {
        await tx.event.update({
          where: { id: event.id },
          data: {
            googleEventId: written.id,
            googleCalendarId: targetCalendar,
            googleEtag: written.etag,
            googleHtmlLink: written.htmlLink,
            googleSyncedAt: now(),
            googleSyncStatus: "SYNCED",
            googleSyncError: null,
            googleSyncAttempts: 0,
            googleSyncNextAttemptAt: null,
          },
        });

        // Record which address each guest was invited under: RSVP matching keys on
        // it, and a person's primary email can change later.
        for (const { attendeeId, email } of invited) {
          await tx.eventAttendee.update({
            where: { id: attendeeId },
            data: { googleInviteEmail: email },
          });
        }
        for (const { attendeeId } of skipped) {
          await tx.eventAttendee.update({
            where: { id: attendeeId },
            data: { googleInviteEmail: null },
          });
        }
      });

      if (mustCreate) result.created += 1;
      else result.updated += 1;
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);
      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
        break;
      }

      const attempts = event.googleSyncAttempts + 1;
      await prisma.event.update({
        where: { id: event.id },
        data: {
          googleSyncStatus: "ERROR",
          googleSyncError: short(classified.message),
          googleSyncAttempts: attempts,
          googleSyncNextAttemptAt: new Date(now().getTime() + backoffMs(attempts)),
        },
      });
      result.failed += 1;
      result.errors.push(`${event.title}: ${classified.message}`);
    }
  }

  if (result.rateLimited) return result;

  // --- 3. RSVP poll ------------------------------------------------------
  if (settings.importRsvps) {
    try {
      const since = new Date(
        (settings.calendarRsvpCheckedAt?.getTime() ??
          runStartedAt.getTime() - FIRST_POLL_LOOKBACK_MS) - POLL_OVERLAP_MS,
      );

      const changed = await deps.calendar.listChangedEvents({
        calendarId: targetCalendar,
        updatedMin: since,
      });

      for (const remote of changed) {
        if (!remote.id || remote.status === "cancelled") continue;
        const local = await prisma.event.findFirst({
          where: { ownerId: userId, googleEventId: remote.id },
          select: { id: true },
        });
        if (!local) continue;
        result.rsvpsUpdated += await applyResponses(local.id, responsesOf(remote), now());
      }

      await prisma.userSettings.updateMany({
        where: { userId },
        data: { calendarRsvpCheckedAt: runStartedAt },
      });
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);
      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
      } else {
        // A failed poll must not fail the whole run: the pushes above already
        // succeeded, and the watermark is deliberately left alone so the next run
        // re-covers this window.
        result.errors.push(`RSVP poll: ${classified.message}`);
      }
    }
  }

  return result;
}

/**
 * Write Google's replies onto Hearth's attendees.
 *
 * Matches on the address the guest was actually invited under, not the person's
 * current primary email — those can differ once someone changes their email, and
 * the invite Google holds still carries the old one.
 */
async function applyResponses(
  eventId: string,
  responses: ReadonlyMap<string, string>,
  at: Date,
): Promise<number> {
  if (responses.size === 0) return 0;

  const attendees = await prisma.eventAttendee.findMany({
    where: { eventId, googleInviteEmail: { not: null } },
    select: { id: true, rsvp: true, googleInviteEmail: true },
  });

  let changed = 0;
  for (const attendee of attendees) {
    const status = responses.get((attendee.googleInviteEmail ?? "").toLowerCase());
    if (!status) continue;
    const mapped = RSVP_FROM_GOOGLE[status];
    // Only write a real change, so rsvpFromGoogleAt marks the last actual reply
    // rather than the last time anything was polled.
    if (!mapped || mapped === attendee.rsvp) continue;

    await prisma.eventAttendee.update({
      where: { id: attendee.id },
      data: { rsvp: mapped, rsvpFromGoogleAt: at },
    });
    changed += 1;
  }
  return changed;
}

async function settleEventTombstone(
  tombstoneId: string,
  userId: string,
  resourceId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.syncTombstone.update({
      where: { id: tombstoneId },
      data: { processedAt: new Date(), lastError: null },
    }),
    prisma.event.updateMany({
      where: { ownerId: userId, googleEventId: resourceId },
      data: { googleEventId: null, googleEtag: null },
    }),
  ]);
}
