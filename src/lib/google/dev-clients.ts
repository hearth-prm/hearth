import { randomBytes } from "node:crypto";
import type {
  CalendarClient,
  EventWriteResult,
  GoogleEvent,
} from "@/lib/google/calendar-client";
import type {
  GoogleContactGroup,
  GooglePerson,
  PeopleClient,
  WriteResult,
} from "@/lib/google/people-client";

/**
 * The clients a development install gets.
 *
 * Reads are delegated to the real API — an import, a calendar picker and the reconciliation
 * sweep all want the actual account, and reading changes nothing. Writes are answered here:
 * logged, given a synthetic result of the right shape, and never sent.
 *
 * ## Why the interface and not the HTTP layer
 *
 * `getGoogleClient` already refuses non-GET requests in development, and that would have
 * been the smaller change — but at the HTTP layer a refusal is all it can be. To let the
 * code continue past the send, something has to answer with what Google would have said,
 * and inventing People API response bodies per endpoint is guesswork. Here every method has
 * a declared return type, so the invention is checked by the compiler, and a method added
 * to `PeopleClient` next year will not compile until somebody decides what it does in
 * development.
 *
 * The HTTP-level refusal stays, as a backstop that must never fire. If it ever does, a
 * write reached the network without passing through here — which is the one failure this
 * design can have, and the only way to notice it.
 *
 * ## The results are marked
 *
 * A synthetic resource name says `dev-` in it. It will be written to Hearth's sync columns
 * and it should be obvious there, because a database that has recorded a contact as pushed
 * to a Google account that has never heard of it is a database whose sync state is fiction.
 * That is fine on a stack standing on a copy — it is not fine to have to guess about.
 */

const devId = () => `dev-${randomBytes(6).toString("hex")}`;

function note(what: string, detail?: unknown): void {
  console.log(
    `[hearth] development mode: NOT sending to Google — ${what}`,
    detail === undefined ? "" : JSON.stringify(detail).slice(0, 200),
  );
}

export function devPeopleClient(real: PeopleClient): PeopleClient {
  return {
    // --- reads: the real account ------------------------------------------
    getEtag: (resourceName) => real.getEtag(resourceName),
    listConnections: (personFields) => real.listConnections(personFields),
    listContactGroups: () => real.listContactGroups(),

    // --- writes: answered here --------------------------------------------
    async createContact(person: GooglePerson): Promise<WriteResult> {
      note(
        "createContact",
        person.names?.[0]?.displayName ?? person.names?.[0],
      );
      return { resourceName: `people/${devId()}`, etag: devId() };
    },
    async updateContact({ resourceName, updateFields }): Promise<WriteResult> {
      note("updateContact", { resourceName, updateFields });
      // The resource name is echoed rather than invented: an update is not a create, and a
      // record whose id changed on every push would exercise the adoption path forever.
      return { resourceName, etag: devId() };
    },
    async deleteContact(resourceName: string): Promise<void> {
      note("deleteContact", resourceName);
    },
    async createContactGroup(name: string): Promise<GoogleContactGroup> {
      note("createContactGroup", name);
      return { resourceName: `contactGroups/${devId()}`, name, etag: devId() };
    },
    async updateContactPhoto({
      resourceName,
      data,
    }): Promise<{ etag: string | null }> {
      note("updateContactPhoto", { resourceName, bytes: data.byteLength });
      return { etag: devId() };
    },
    async deleteContactPhoto(resourceName: string): Promise<void> {
      note("deleteContactPhoto", resourceName);
    },
    async deleteContactGroup(resourceName: string): Promise<void> {
      note("deleteContactGroup", resourceName);
    },
    async updateContactGroup({
      resourceName,
      name,
    }): Promise<GoogleContactGroup | null> {
      note("updateContactGroup", { resourceName, name });
      return { resourceName, name, etag: devId() };
    },
    async modifyGroupMembers({ resourceName, add, remove }): Promise<void> {
      note("modifyGroupMembers", {
        resourceName,
        add: add.length,
        remove: remove.length,
      });
    },
  };
}

export function devCalendarClient(real: CalendarClient): CalendarClient {
  return {
    // --- reads --------------------------------------------------------------
    getEvent: (calendarId, eventId) => real.getEvent(calendarId, eventId),
    listChangedEvents: (args) => real.listChangedEvents(args),
    listCalendars: () => real.listCalendars(),

    // --- writes -------------------------------------------------------------
    async insertEvent({
      calendarId,
      event,
      sendUpdates,
    }): Promise<EventWriteResult> {
      // sendUpdates is logged because it is the field that decides whether real people get
      // an invitation email, and it is the one somebody will want to have seen.
      note("insertEvent", { calendarId, summary: event.summary, sendUpdates });
      return { id: devId(), etag: devId(), htmlLink: null };
    },
    async patchEvent({
      calendarId,
      eventId,
      event,
      sendUpdates,
    }): Promise<EventWriteResult> {
      note("patchEvent", {
        calendarId,
        eventId,
        summary: event.summary,
        sendUpdates,
      });
      return { id: eventId, etag: devId(), htmlLink: null };
    },
    async deleteEvent({ calendarId, eventId, sendUpdates }): Promise<void> {
      note("deleteEvent", { calendarId, eventId, sendUpdates });
    },
  };
}

/** Exported for the checks: what a simulated identifier looks like. */
export const DEV_ID_PREFIX = "dev-";
export type { GoogleEvent };
