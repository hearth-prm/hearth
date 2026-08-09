import { getGoogleClient } from "@/lib/google/auth";
import { createCalendarClient, type CalendarSummary } from "@/lib/google/calendar-client";
import { prisma } from "@/lib/db";
import { CALENDAR_SYNC_SCOPES, grantCovers } from "@/lib/google/scopes";

/**
 * The user's calendars, for the target-calendar picker.
 *
 * Returns null rather than throwing on any failure: this is called while
 * rendering Settings, and a Google hiccup must degrade to the free-text field
 * rather than break the page someone opened to fix their connection.
 */
export async function listUserCalendars(
  userId: string,
): Promise<CalendarSummary[] | null> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: "google" },
      select: { scope: true },
    });
    // calendar.readonly is what allows listing; without it there is no point
    // spending a token refresh to find out.
    if (!grantCovers(account?.scope, CALENDAR_SYNC_SCOPES)) return null;

    const auth = await getGoogleClient(userId);
    const calendars = await createCalendarClient(auth).listCalendars();
    // Only calendars we could actually write events to.
    return calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
  } catch {
    return null;
  }
}
