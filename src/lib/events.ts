import type { AttendeeRole, RsvpStatus } from "@prisma/client";
import { isValidTimeZone, wallClockToUtc } from "@/lib/time";
import { fieldInputName } from "@/lib/fields/validation";
import { readCheckbox, readString } from "@/lib/actions/shared";

export const ATTENDEE_ROLES = [
  "HOST",
  "REQUIRED",
  "OPTIONAL",
] as const satisfies readonly AttendeeRole[];

export const ATTENDEE_ROLE_LABELS: Record<AttendeeRole, string> = {
  HOST: "Host",
  REQUIRED: "Required",
  OPTIONAL: "Optional",
};

export const RSVP_STATUSES = [
  "NEEDS_ACTION",
  "ACCEPTED",
  "DECLINED",
  "TENTATIVE",
] as const satisfies readonly RsvpStatus[];

export const RSVP_LABELS: Record<RsvpStatus, string> = {
  NEEDS_ACTION: "No reply",
  ACCEPTED: "Going",
  DECLINED: "Not going",
  TENTATIVE: "Maybe",
};

export interface Schedule {
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timeZone: string;
}

/**
 * Parse an event's "when" block.
 *
 * Handled outside parseFields() because the four scheduling fields are
 * interdependent in a way a per-field validator cannot express: the all-day
 * toggle changes the input type from datetime-local to date, the timezone
 * decides what instant a wall-clock time refers to, and the end must follow the
 * start. They remain in the field registry (flagged `generic: false`) so the
 * Google mapping UI can still see and describe them.
 */
export function parseSchedule(
  form: FormData,
  fallbackTimeZone: string,
):
  | { ok: true; schedule: Schedule }
  | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const allDay = readCheckbox(form, fieldInputName("allDay"));
  const timeZone = readString(form, fieldInputName("timeZone")) || fallbackTimeZone;
  if (!isValidTimeZone(timeZone)) {
    errors.timeZone = "Unknown time zone";
  }

  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const rawStart = readString(form, fieldInputName("startAt"));
  const rawEnd = readString(form, fieldInputName("endAt"));

  const startAt = toInstant(rawStart, allDay, zone);
  if (!startAt) {
    errors.startAt = allDay ? "Enter a start date" : "Enter a start date and time";
  }

  let endAt: Date | null = null;
  if (rawEnd) {
    endAt = toInstant(rawEnd, allDay, zone);
    if (!endAt) {
      errors.endAt = allDay ? "Enter a valid end date" : "Enter a valid end date and time";
    }
  }

  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    errors.endAt = "The end must not be before the start";
  }

  if (Object.keys(errors).length || !startAt) {
    return { ok: false, errors };
  }
  return { ok: true, schedule: { startAt, endAt, allDay, timeZone: zone } };
}

/**
 * Interpret a form value as an absolute instant.
 *
 * An all-day input submits "YYYY-MM-DD"; a timed one submits
 * "YYYY-MM-DDTHH:mm". Slicing handles both, including the case where the user
 * toggled all-day after already entering a time.
 */
function toInstant(raw: string, allDay: boolean, timeZone: string): Date | null {
  if (!raw) return null;
  const local = allDay ? `${raw.slice(0, 10)}T00:00` : raw.slice(0, 16);
  return wallClockToUtc(local, timeZone);
}

export function parseRole(value: string): AttendeeRole {
  return (ATTENDEE_ROLES as readonly string[]).includes(value)
    ? (value as AttendeeRole)
    : "OPTIONAL";
}

export function parseRsvp(value: string): RsvpStatus {
  return (RSVP_STATUSES as readonly string[]).includes(value)
    ? (value as RsvpStatus)
    : "NEEDS_ACTION";
}
