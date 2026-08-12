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

  // --- contact groups (Google's "labels") ---------------------------------
  //
  // Groups are separate resources from contacts, and per account: the owner's
  // "Family" and a recipient's "Family" are different objects. Membership is
  // changed through modifyGroupMembers rather than by writing `memberships` on the
  // contact, because a person update replaces the membership list wholesale — which
  // would drop the contact out of My Contacts and out of any group the user made by
  // hand in Google. Hearth only ever touches groups it created.

  /** User-created groups only; system groups like myContacts are not ours to manage. */
  listContactGroups(): Promise<GoogleContactGroup[]>;

  createContactGroup(name: string): Promise<GoogleContactGroup>;

  // --- photos ---------------------------------------------------------------
  //
  // A separate endpoint from updateContact: `photos` is read-only on a person, so a
  // picture cannot ride along with the field update the way names and phones do.

  /** Replace a contact's photo. Returns the etag the contact now carries. */
  updateContactPhoto(args: {
    resourceName: string;
    /** Raw image bytes; the client base64-encodes them. */
    data: Uint8Array;
  }): Promise<{ etag: string | null }>;

  /** Remove the photo Hearth put there. */
  deleteContactPhoto(resourceName: string): Promise<void>;

  /** Remove a group. The contacts in it are not deleted, only ungrouped. */
  deleteContactGroup(resourceName: string): Promise<void>;

  /** Rename an existing group. Returns null if it no longer exists. */
  updateContactGroup(args: {
    resourceName: string;
    etag: string | null;
    name: string;
  }): Promise<GoogleContactGroup | null>;

  /**
   * Add and remove members of one group.
   *
   * Additive and subtractive rather than a replacement, so a contact's other groups
   * survive. Removing someone who is not a member is a no-op.
   */
  modifyGroupMembers(args: {
    resourceName: string;
    add: string[];
    remove: string[];
  }): Promise<void>;
}

export interface GoogleContactGroup {
  resourceName: string;
  name: string;
  etag: string | null;
}

/** Cap the reconciliation sweep so a huge address book cannot stall a run. */
const MAX_CONNECTION_PAGES = 20;
const CONNECTIONS_PAGE_SIZE = 200;

const CONTACT_GROUP_PAGE_SIZE = 200;
const MAX_CONTACT_GROUP_PAGES = 10;
/** Google's per-request cap on members added or removed in one modify call. */
const GROUP_MEMBER_CHUNK = 1_000;

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

    async listContactGroups() {
      const out: GoogleContactGroup[] = [];
      let pageToken: string | undefined;
      let pages = 0;

      do {
        const res = await people.contactGroups.list({
          pageSize: CONTACT_GROUP_PAGE_SIZE,
          pageToken,
        });
        for (const g of res.data.contactGroups ?? []) {
          // USER_CONTACT_GROUP excludes myContacts, starred and the other system
          // groups — renaming or deleting one of those is not something Hearth
          // should ever be able to do.
          if (g.groupType !== "USER_CONTACT_GROUP") continue;
          if (!g.resourceName || !g.name) continue;
          out.push({ resourceName: g.resourceName, name: g.name, etag: g.etag ?? null });
        }
        pageToken = res.data.nextPageToken ?? undefined;
        pages += 1;
      } while (pageToken && pages < MAX_CONTACT_GROUP_PAGES);

      return out;
    },

    async createContactGroup(name) {
      const res = await people.contactGroups.create({
        requestBody: { contactGroup: { name } },
      });
      const resourceName = res.data.resourceName;
      if (!resourceName) {
        throw new Error("Google created the group but returned no resourceName");
      }
      return { resourceName, name: res.data.name ?? name, etag: res.data.etag ?? null };
    },

    async updateContactPhoto({ resourceName, data }) {
      const res = await people.people.updateContactPhoto({
        resourceName,
        requestBody: { photoBytes: Buffer.from(data).toString("base64") },
      });
      return { etag: res.data.person?.etag ?? null };
    },

    async deleteContactPhoto(resourceName) {
      try {
        await people.people.deleteContactPhoto({ resourceName });
      } catch (err) {
        // Nothing to remove is the goal state, not a failure.
        if ((err as { code?: number }).code === 404) return;
        throw err;
      }
    },

    async deleteContactGroup(resourceName) {
      // deleteContacts defaults to false, but saying so is worth the two words: a
      // label being removed must never take the people in it with it.
      await people.contactGroups.delete({ resourceName, deleteContacts: false });
    },

    async updateContactGroup({ resourceName, etag, name }) {
      try {
        const res = await people.contactGroups.update({
          resourceName,
          requestBody: {
            contactGroup: { resourceName, name, ...(etag ? { etag } : {}) },
            updateGroupFields: "name",
          },
        });
        return {
          resourceName: res.data.resourceName ?? resourceName,
          name: res.data.name ?? name,
          etag: res.data.etag ?? null,
        };
      } catch (err) {
        // A group deleted in Google is not an error worth failing a sync over: the
        // next run recreates it and re-adds its members.
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },

    async modifyGroupMembers({ resourceName, add, remove }) {
      // Google caps a single modify at 1000 members each way, so long lists are
      // chunked rather than silently truncated.
      for (let i = 0; i < Math.max(add.length, remove.length); i += GROUP_MEMBER_CHUNK) {
        const addChunk = add.slice(i, i + GROUP_MEMBER_CHUNK);
        const removeChunk = remove.slice(i, i + GROUP_MEMBER_CHUNK);
        if (addChunk.length === 0 && removeChunk.length === 0) continue;
        await people.contactGroups.members.modify({
          resourceName,
          requestBody: {
            resourceNamesToAdd: addChunk,
            resourceNamesToRemove: removeChunk,
          },
        });
      }
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
