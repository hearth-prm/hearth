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

// --- error classification -------------------------------------------------

export type SyncErrorKind =
  /** The grant is dead; only a reconnect fixes it. */
  | "auth"
  /** Quota or too many requests: back off, the request itself was fine. */
  | "rate_limit"
  /** Etag mismatch: re-read and try again. */
  | "conflict"
  /** The remote contact is gone: forget the resource name and re-create. */
  | "not_found"
  /** Server-side or network wobble: retry later. */
  | "transient"
  /** Bad request we will keep getting wrong: record it and back off hard. */
  | "permanent";

export interface ClassifiedError {
  kind: SyncErrorKind;
  status?: number;
  message: string;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: number } };
  if (typeof e?.code === "number") return e.code;
  if (typeof e?.status === "number") return e.status;
  return e?.response?.status;
}

function messageOf(err: unknown): string {
  const e = err as {
    message?: string;
    errors?: Array<{ message?: string }>;
    response?: { data?: { error?: { message?: string } } };
  };
  return (
    e?.response?.data?.error?.message ??
    e?.errors?.[0]?.message ??
    e?.message ??
    String(err)
  );
}

/**
 * Map a Google failure onto a retry strategy.
 *
 * Getting this wrong is expensive in both directions: treating a permanent 400 as
 * transient burns quota forever, while treating a rate limit as permanent stops
 * syncing over something that would have healed on its own.
 */
export function classifyGoogleError(err: unknown): ClassifiedError {
  const status = statusOf(err);
  const message = messageOf(err);

  if (/invalid_grant/i.test(message)) {
    return { kind: "auth", status, message };
  }

  switch (status) {
    case 401:
      return { kind: "auth", status, message };
    case 403:
      // 403 is overloaded: quota exhaustion and a genuinely missing permission
      // arrive with the same status and need opposite handling.
      return /quota|rate limit|userRateLimitExceeded/i.test(message)
        ? { kind: "rate_limit", status, message }
        : { kind: "auth", status, message };
    case 429:
      return { kind: "rate_limit", status, message };
    case 404:
      return { kind: "not_found", status, message };
    case 409:
      return { kind: "conflict", status, message };
    case 400:
      // Google reports a stale etag as a 400 mentioning it, not as a 409.
      return /etag/i.test(message)
        ? { kind: "conflict", status, message }
        : { kind: "permanent", status, message };
    case 412:
      return { kind: "conflict", status, message };
    default:
      if (status && status >= 500) return { kind: "transient", status, message };
      if (status && status >= 400) return { kind: "permanent", status, message };
      // No status at all is a socket/DNS problem rather than an API answer.
      return { kind: "transient", status, message };
  }
}

/**
 * Exponential backoff with a ceiling, so a record that keeps failing stops
 * consuming most of every run but is never abandoned outright.
 */
export function backoffMs(attempts: number): number {
  const base = 60_000;
  const ceiling = 6 * 60 * 60 * 1000;
  // The exponent is clamped only to keep the intermediate value sane; `ceiling`
  // is what actually bounds the delay. Clamping attempts instead — as an earlier
  // version did at 8 — capped the result at 2h08m and made the stated six-hour
  // ceiling unreachable.
  const exponent = Math.min(Math.max(0, attempts - 1), 20);
  return Math.min(base * 2 ** exponent, ceiling);
}
