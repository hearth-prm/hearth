/**
 * Timezone helpers.
 *
 * Event start/end are stored as absolute UTC instants, but users enter and read
 * them as wall-clock times in the event's own timezone ("the party starts at
 * 7pm in Chicago"). Converting between the two without a date library needs the
 * offset of the target zone *at that instant*, which Intl can tell us.
 *
 * These are also what M3 will use to build Google Calendar's
 * {dateTime, timeZone} payloads correctly across DST boundaries.
 */

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Offset of `timeZone` from UTC, in ms, at the instant `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - date.getTime();
}

/**
 * Interpret "2026-08-14T19:00" as a wall-clock time in `timeZone` and return
 * the absolute instant.
 *
 * Iterates twice because the offset depends on the instant we are solving for —
 * one correction lands inside the right DST period, the second confirms it.
 */
export function wallClockToUtc(local: string, timeZone: string): Date | null {
  const m = WALL_CLOCK_RE.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0"),
  );
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    ts = naive - zoneOffsetMs(new Date(ts), timeZone);
  }
  const result = new Date(ts);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Render an instant as "YYYY-MM-DDTHH:mm" wall clock in `timeZone`. */
export function utcToWallClock(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const hour = String(Number(parts.hour) % 24).padStart(2, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/** Render an instant as "YYYY-MM-DD" in `timeZone`. */
export function utcToDateInZone(date: Date, timeZone: string): string {
  return utcToWallClock(date, timeZone).slice(0, 10);
}

export function formatInstant(
  date: Date,
  timeZone: string,
  opts: { withTime?: boolean } = {},
): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: "medium",
    ...(opts.withTime === false ? {} : { timeStyle: "short" }),
  }).format(date);
}

/**
 * Format a `@db.Date` column. Prisma returns these as an instant at UTC
 * midnight, so formatting in local time can shift the day backwards — always
 * read the components in UTC.
 */
export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    dateStyle: "medium",
  }).format(date);
}

/** "YYYY-MM-DD" from a `@db.Date` column, for prefilling a date input. */
export function dateOnlyToInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Convert "YYYY-MM-DD" to the UTC-midnight instant a `@db.Date` expects. */
export function inputToDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A short, curated zone list for the picker. `Intl.supportedValuesOf` gives the
 * full IANA set when available; we surface that but keep a fallback so the UI
 * never renders an empty select.
 */
export function commonTimeZones(): string[] {
  const fallback = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Madrid",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported !== "function") return fallback;
  try {
    // UTC put back at the front, and it is not decoration.
    //
    // Intl.supportedValuesOf("timeZone") returns 418 canonical zones and includes neither
    // "UTC" nor "Etc/UTC" — while UserSettings.timeZone DEFAULTS to "UTC". A select whose
    // value matches no option shows the first one instead, so every fresh install displayed
    // "Africa/Abidjan" as its default time zone, and saving that page without touching the
    // picker submitted Africa/Abidjan over the UTC that was stored. A list that cannot express
    // the value it is asked to display is worse than a short list.
    return ["UTC", ...supported("timeZone").filter((tz) => tz !== "UTC")];
  } catch {
    return fallback;
  }
}
