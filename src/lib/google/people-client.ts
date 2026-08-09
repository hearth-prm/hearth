import { google, type people_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

/**
 * The People API surface Hearth needs, behind an interface.
 *
 * Declaring it rather than calling googleapis directly is what makes the sync
 * engine testable: the engine takes a PeopleClient, and the tests pass a fake
 * that can produce etag conflicts, 404s, rate limits and partial failures on
 * demand. Verifying that behaviour against the real API would need live
 * credentials and would be unrepeatable.
 */

export type GooglePerson = people_v1.Schema$Person;

export interface WriteResult {
  resourceName: string;
  etag: string | null;
}

export interface PeopleClient {
  createContact(person: GooglePerson): Promise<WriteResult>;

  /**
   * `updateFields` lists the field groups to replace. Google replaces each group
   * wholesale — omitting it leaves the remote value untouched, including it and
   * sending nothing clears it. That is what makes Hearth authoritative for the
   * fields it manages.
   */
  updateContact(args: {
    resourceName: string;
    etag: string;
    person: GooglePerson;
    updateFields: string[];
  }): Promise<WriteResult>;

  deleteContact(resourceName: string): Promise<void>;

  /** Current etag, or null when the contact no longer exists. */
  getEtag(resourceName: string): Promise<string | null>;

  /** Every contact, for reconciling records whose resource name was lost. */
  listConnections(personFields: string[]): Promise<GooglePerson[]>;
}

/** Cap the reconciliation sweep so a huge address book cannot stall a run. */
const MAX_CONNECTION_PAGES = 20;
const CONNECTIONS_PAGE_SIZE = 200;

export function createPeopleClient(auth: OAuth2Client): PeopleClient {
  const people = google.people({ version: "v1", auth });

  return {
    async createContact(person) {
      const res = await people.people.createContact({
        requestBody: person,
      });
      const resourceName = res.data.resourceName;
      if (!resourceName) {
        throw new Error("Google created the contact but returned no resourceName");
      }
      return { resourceName, etag: res.data.etag ?? null };
    },

    async updateContact({ resourceName, etag, person, updateFields }) {
      const res = await people.people.updateContact({
        resourceName,
        updatePersonFields: updateFields.join(","),
        // The etag is Google's optimistic-concurrency check: a mismatch means the
        // contact changed since we last read it, and the write is rejected rather
        // than silently clobbering.
        requestBody: { ...person, etag },
      });
      return {
        resourceName: res.data.resourceName ?? resourceName,
        etag: res.data.etag ?? null,
      };
    },

    async deleteContact(resourceName) {
      await people.people.deleteContact({ resourceName });
    },

    async getEtag(resourceName) {
      try {
        const res = await people.people.get({
          resourceName,
          personFields: "metadata",
        });
        return res.data.etag ?? null;
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },

    async listConnections(personFields) {
      const out: GooglePerson[] = [];
      let pageToken: string | undefined;
      let pages = 0;

      do {
        const res = await people.people.connections.list({
          resourceName: "people/me",
          personFields: personFields.join(","),
          pageSize: CONNECTIONS_PAGE_SIZE,
          pageToken,
        });
        out.push(...(res.data.connections ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
        pages += 1;
      } while (pageToken && pages < MAX_CONNECTION_PAGES);

      return out;
    },
  };
}

// Error classification and backoff are shared with calendar sync; re-exported so
// existing imports keep working.
export {
  backoffMs,
  classifyGoogleError,
  type ClassifiedError,
  type SyncErrorKind,
} from "./errors";
