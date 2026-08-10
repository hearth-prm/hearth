import type { ContactPoint, Event, EventAttendee, Person } from "@prisma/client";
import { primaryEmail } from "@/lib/people";
import { utcToDateInZone } from "@/lib/time";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import type { FieldDef } from "@/lib/fields/types";
import type { GoogleEvent } from "./calendar-client";
import { noMappings, type ResolvedMappings } from "./mappings";

/**
 * Turn a Hearth event into a Google Calendar event.
 *
 * Pure: no database, no network, no clock beyond what is passed in. The all-day
 * handling in particular needs to be testable directly, because Google's
 * end-date convention is off-by-one against every intuition (see below).
 */

/** Private extended property linking a Google event back to Hearth. */
export const HEARTH_EVENT_KEY = "hearth_id";

/** Google requires an end; a timed event without one gets this long. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

export type AttendeeWithPerson = EventAttendee & {
  person: Pick<Person, "id" | "displayName"> & { contactPoints: ContactPoint[] };
};

export interface SerializeEventOptions {
  /** False when the account has attendee mirroring switched off. */
  includeAttendees: boolean;
  /**
   * Lowercased email -> responseStatus as Google currently has it.
   *
   * Supplying this is what stops a push from resetting everyone's RSVP: a patch
   * containing `attendees` replaces the whole list, so an entry sent without its
   * responseStatus comes back as "needsAction".
   */
  existingResponses?: ReadonlyMap<string, string>;
  /** Registry entries for user-defined fields. */
  customFields?: readonly FieldDef[];
  /** Per-field destinations; defaults to core-only with nothing custom synced. */
  mappings?: ResolvedMappings;
}

export interface SerializedEvent {
  event: GoogleEvent;
  /** Attendees actually sent, and the address used — RSVP matching needs it. */
  invited: Array<{ attendeeId: string; email: string }>;
  /** Attendees left off, and why, so the UI can explain rather than silently drop. */
  skipped: Array<{ attendeeId: string; displayName: string; reason: string }>;
}

/** Shift a "YYYY-MM-DD" string by whole days, without touching local time. */
function addDays(dateString: string, days: number): string {
  const ms = Date.parse(`${dateString}T00:00:00.000Z`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

export function serializeEvent(
  event: Event,
  attendees: readonly AttendeeWithPerson[],
  options: SerializeEventOptions,
): SerializedEvent {
  const mappings = options.mappings ?? noMappings();
  const timeZone = event.timeZone || "UTC";

  // Mapped custom fields, all append-only like the contact side.
  const extendedPrivate: Record<string, string> = {
    [HEARTH_EVENT_KEY]: event.id,
  };
  const descriptionLines: string[] = [];

  for (const def of options.customFields ?? []) {
    const mapping = mappings.customTarget(def.key);
    if (!mapping) continue;
    const text = formatFieldValue(def, readFieldValue(event as unknown as Record<string, unknown>, def), timeZone);
    if (!text) continue;
    const label = def.label || def.key;

    if (mapping.target === "extendedProperty") {
      extendedPrivate[(mapping.targetKey || label).trim()] = text;
    } else if (mapping.target === "description") {
      descriptionLines.push(`${label}: ${text}`);
    }
  }

  let start: GoogleEvent["start"];
  let end: GoogleEvent["end"];

  if (event.allDay) {
    // Google's end.date is EXCLUSIVE: a party on the 25th is start 25th, end 26th,
    // and sending end = 25th produces a zero-length event that renders on the
    // wrong day or not at all. The stored endAt is the last day *inclusive*, so
    // one day is always added.
    const startDate = utcToDateInZone(event.startAt, timeZone);
    const lastDay = event.endAt ? utcToDateInZone(event.endAt, timeZone) : startDate;
    start = { date: startDate };
    end = { date: addDays(lastDay, 1) };
  } else {
    const endAt = event.endAt ?? new Date(event.startAt.getTime() + DEFAULT_DURATION_MS);
    // An absolute instant plus the zone: the offset in dateTime fixes *when*, and
    // timeZone fixes how Google displays and shifts it across DST.
    start = { dateTime: event.startAt.toISOString(), timeZone };
    end = { dateTime: endAt.toISOString(), timeZone };
  }

  const invited: SerializedEvent["invited"] = [];
  const skipped: SerializedEvent["skipped"] = [];
  const googleAttendees: NonNullable<GoogleEvent["attendees"]> = [];

  for (const attendee of attendees) {
    if (!options.includeAttendees) {
      skipped.push({
        attendeeId: attendee.id,
        displayName: attendee.person.displayName,
        reason: "guest mirroring is turned off in Settings",
      });
      continue;
    }
    if (!attendee.inviteToGoogle) {
      skipped.push({
        attendeeId: attendee.id,
        displayName: attendee.person.displayName,
        reason: "not marked to invite in Google",
      });
      continue;
    }

    const email = primaryEmail(attendee.person.contactPoints);
    if (!email) {
      // Google identifies guests only by email, so there is nothing to send.
      skipped.push({
        attendeeId: attendee.id,
        displayName: attendee.person.displayName,
        reason: "no email address on file",
      });
      continue;
    }

    const known = options.existingResponses?.get(email.toLowerCase());
    googleAttendees.push({
      email,
      displayName: attendee.person.displayName,
      optional: attendee.role === "OPTIONAL",
      ...(known ? { responseStatus: known } : {}),
    });
    invited.push({ attendeeId: attendee.id, email });
  }

  return {
    event: {
      summary: event.title,
      description: [
        mappings.coreEnabled("description") ? (event.description ?? "") : "",
        ...descriptionLines,
      ]
        .filter((part) => part.length > 0)
        .join("\n"),
      location: mappings.coreEnabled("location") ? (event.location ?? "") : "",
      start,
      end,
      attendees: googleAttendees,
      // Private to the calendar owner: guests never see it. Carries hearth_id — the
      // same recognition trick as on contacts — plus any field mapped to hidden
      // metadata.
      extendedProperties: { private: extendedPrivate },
    },
    invited,
    skipped,
  };
}

/** Read Hearth's id back off a Google event. */
export function hearthEventIdOf(event: GoogleEvent): string | null {
  return event.extendedProperties?.private?.[HEARTH_EVENT_KEY] ?? null;
}

/** Google's responseStatus values, keyed by email, from a fetched event. */
export function responsesOf(event: GoogleEvent): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of event.attendees ?? []) {
    if (a.email && a.responseStatus) out.set(a.email.toLowerCase(), a.responseStatus);
  }
  return out;
}
