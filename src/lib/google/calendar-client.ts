import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * The Calendar API surface Hearth needs, behind an interface, for the same reason
 * as PeopleClient: the paths worth testing — a 404 on an event deleted in Google,
 * quota exhaustion, an RSVP arriving between two pushes — cannot be produced on
 * demand against the real API.
 */

export type GoogleEvent = calendar_v3.Schema$Event;

export interface EventWriteResult {
  id: string;
  etag: string | null;
}

/**
 * Whether Google emails the guests.
 *
 * "none" is not merely a default here but a safety property: Hearth records past
 * gatherings as history, and mailing their attendees would be both wrong and
 * irreversible. The engine decides this per event.
 */
export type SendUpdates = "all" | "none";

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export interface CalendarClient {
  insertEvent(args: {
    calendarId: string;
    event: GoogleEvent;
    sendUpdates: SendUpdates;
  }): Promise<EventWriteResult>;

  /**
   * Patch, not update: patch leaves fields Hearth does not manage alone, where
   * update would replace the whole event and wipe anything else on it.
   *
   * Note that a patch containing `attendees` still replaces the entire attendee
   * list, which is why the engine reads the event first and carries each guest's
   * responseStatus across — otherwise every push would reset everyone's RSVP to
   * "needsAction".
   */
  patchEvent(args: {
    calendarId: string;
    eventId: string;
    event: GoogleEvent;
    sendUpdates: SendUpdates;
  }): Promise<EventWriteResult>;

  /** The event as Google currently has it, or null if it is gone. */
  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent | null>;

  deleteEvent(args: {
    calendarId: string;
    eventId: string;
    sendUpdates: SendUpdates;
  }): Promise<void>;

  /**
   * Events changed since `updatedMin` — one call to find every new RSVP, rather
   * than fetching each synced event in turn.
   */
  listChangedEvents(args: {
    calendarId: string;
    updatedMin: Date;
  }): Promise<GoogleEvent[]>;

  listCalendars(): Promise<CalendarSummary[]>;
}

const CHANGED_PAGE_SIZE = 250;
const MAX_CHANGED_PAGES = 10;

export function createCalendarClient(auth: OAuth2Client): CalendarClient {
  const calendar = google.calendar({ version: "v3", auth });

  return {
    async insertEvent({ calendarId, event, sendUpdates }) {
      const res = await calendar.events.insert({
        calendarId,
        sendUpdates,
        requestBody: event,
      });
      const id = res.data.id;
      if (!id) throw new Error("Google created the event but returned no id");
      return { id, etag: res.data.etag ?? null };
    },

    async patchEvent({ calendarId, eventId, event, sendUpdates }) {
      const res = await calendar.events.patch({
        calendarId,
        eventId,
        sendUpdates,
        requestBody: event,
      });
      return { id: res.data.id ?? eventId, etag: res.data.etag ?? null };
    },

    async getEvent(calendarId, eventId) {
      try {
        const res = await calendar.events.get({ calendarId, eventId });
        return res.data;
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },

    async deleteEvent({ calendarId, eventId, sendUpdates }) {
      await calendar.events.delete({ calendarId, eventId, sendUpdates });
    },

    async listChangedEvents({ calendarId, updatedMin }) {
      const out: GoogleEvent[] = [];
      let pageToken: string | undefined;
      let pages = 0;

      do {
        const res = await calendar.events.list({
          calendarId,
          updatedMin: updatedMin.toISOString(),
          // singleEvents=false keeps recurring events as their parent, which is
          // what Hearth stores — expanding them would return instances whose ids
          // never match anything we wrote.
          singleEvents: false,
          showDeleted: true,
          maxResults: CHANGED_PAGE_SIZE,
          pageToken,
        });
        out.push(...(res.data.items ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
        pages += 1;
      } while (pageToken && pages < MAX_CHANGED_PAGES);

      return out;
    },

    async listCalendars() {
      const res = await calendar.calendarList.list({ maxResults: 250 });
      return (res.data.items ?? [])
        .filter((c): c is calendar_v3.Schema$CalendarListEntry & { id: string } =>
          Boolean(c.id),
        )
        .map((c) => ({
          id: c.id,
          summary: c.summary ?? c.id,
          primary: Boolean(c.primary),
          accessRole: c.accessRole ?? "reader",
        }));
    },
  };
}
