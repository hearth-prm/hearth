import { prisma } from "@/lib/db";
import { loadRegistry } from "@/lib/fields/registry";
import { GoogleAuthError } from "@/lib/google/auth";
import {
  backoffMs,
  classifyGoogleError,
  type PeopleClient,
} from "@/lib/google/people-client";
import { hearthIdOf, serializePerson } from "@/lib/google/serialize-person";

/**
 * One-way push of Hearth contacts into Google Contacts.
 *
 * Hearth is authoritative: this only ever writes. Nothing is read back into
 * Person rows, so a change made directly in Google inside a field Hearth manages
 * is overwritten on the next push (see MANAGED_PERSON_FIELDS).
 *
 * The engine takes its PeopleClient as an argument rather than constructing one,
 * so the tests can drive etag conflicts, 404s and rate limits deterministically.
 */

export interface ContactSyncResult {
  created: number;
  updated: number;
  /** Contacts removed from Google (deleted locally, or opted out). */
  deleted: number;
  /** Existing Google contacts re-linked to a Hearth record. */
  adopted: number;
  failed: number;
  /** True when the run stopped early because Google asked us to slow down. */
  rateLimited: boolean;
  errors: string[];
}

export interface SyncDeps {
  people: PeopleClient;
  now?: () => Date;
}

export interface SyncOptions {
  /** Records to attempt per run. Keeps a single pass bounded. */
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 50;

function emptyResult(): ContactSyncResult {
  return {
    created: 0,
    updated: 0,
    deleted: 0,
    adopted: 0,
    failed: 0,
    rateLimited: false,
    errors: [],
  };
}

export function summarise(r: ContactSyncResult): string {
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} created`);
  if (r.updated) parts.push(`${r.updated} updated`);
  if (r.deleted) parts.push(`${r.deleted} removed`);
  if (r.adopted) parts.push(`${r.adopted} re-linked`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.rateLimited) parts.push("paused on Google's rate limit");
  return parts.length ? parts.join(", ") : "nothing to do";
}

/** Truncated so a huge Google error cannot bloat every row it touches. */
function short(message: string): string {
  return message.length > 500 ? `${message.slice(0, 497)}…` : message;
}

export async function syncContactsForUser(
  userId: string,
  deps: SyncDeps,
  options: SyncOptions = {},
): Promise<ContactSyncResult> {
  const now = deps.now ?? (() => new Date());
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const result = emptyResult();

  // Built on demand: only needed when a create has failed before and might have
  // left an orphaned contact behind. One listing serves the whole run.
  let adoptionMap: Map<string, { resourceName: string; etag: string | null }> | null =
    null;
  const adoptionIndex = async () => {
    if (!adoptionMap) {
      adoptionMap = new Map();
      for (const contact of await deps.people.listConnections([
        "userDefined",
        "metadata",
      ])) {
        const id = hearthIdOf(contact);
        if (id && contact.resourceName) {
          adoptionMap.set(id, {
            resourceName: contact.resourceName,
            etag: contact.etag ?? null,
          });
        }
      }
    }
    return adoptionMap;
  };

  // --- 1. deletions first ------------------------------------------------
  //
  // Opting a contact out is the change a user is most likely to be watching for,
  // and clearing tombstones first means a delete followed by a re-create in the
  // same run cannot collide on the remote copy.
  const tombstones = await prisma.syncTombstone.findMany({
    where: {
      ownerId: userId,
      target: "GOOGLE_CONTACT",
      processedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  for (const tombstone of tombstones) {
    try {
      await deps.people.deleteContact(tombstone.resourceId);
      await settleTombstone(tombstone.id, userId, tombstone.resourceId);
      result.deleted += 1;
    } catch (err) {
      const classified = classifyGoogleError(err);

      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);

      if (classified.kind === "not_found") {
        // Already gone — the goal state. Deleting is idempotent, so this counts
        // as success rather than an error to retry forever.
        await settleTombstone(tombstone.id, userId, tombstone.resourceId);
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
      result.errors.push(`delete ${tombstone.resourceId}: ${classified.message}`);
    }
  }

  if (result.rateLimited) return result;

  // --- 2. pushes ---------------------------------------------------------
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { syncCustomFields: true },
  });
  const customFields = settings?.syncCustomFields
    ? (await loadRegistry(userId, "PERSON")).filter((f) => !f.core)
    : [];

  const queue = await prisma.person.findMany({
    where: {
      ownerId: userId,
      addToGoogle: true,
      googleSyncStatus: { in: ["PENDING", "ERROR"] },
      OR: [
        { googleSyncNextAttemptAt: null },
        { googleSyncNextAttemptAt: { lte: now() } },
      ],
    },
    include: { contactPoints: true },
    orderBy: { updatedAt: "asc" },
    take: batchSize,
  });

  for (const person of queue) {
    const { person: payload, updateFields } = serializePerson(person, {
      customFields,
    });

    try {
      let resourceName = person.googleResourceName;
      let etag = person.googleEtag;

      // A record that failed before may already have a contact in Google from a
      // create that succeeded remotely but never got recorded locally. Adopt it
      // instead of creating a duplicate in the user's real address book.
      if (!resourceName && person.googleSyncAttempts > 0) {
        const existing = (await adoptionIndex()).get(person.id);
        if (existing) {
          resourceName = existing.resourceName;
          etag = existing.etag;
          result.adopted += 1;
        }
      }

      if (resourceName) {
        const written = await updateWithEtagRecovery(deps, {
          resourceName,
          etag,
          person: payload,
          updateFields,
        });

        if (written === "gone") {
          // Deleted in Google since we last wrote. Forget the resource name and
          // create afresh, so the contact reappears rather than erroring forever.
          const created = await deps.people.createContact(payload);
          await markSynced(person.id, created.resourceName, created.etag, now());
          result.created += 1;
        } else {
          await markSynced(person.id, written.resourceName, written.etag, now());
          result.updated += 1;
        }
      } else {
        const created = await deps.people.createContact(payload);
        await markSynced(person.id, created.resourceName, created.etag, now());
        result.created += 1;
      }
    } catch (err) {
      const classified = classifyGoogleError(err);

      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);

      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
        break;
      }

      const attempts = person.googleSyncAttempts + 1;
      await prisma.person.update({
        where: { id: person.id },
        data: {
          googleSyncStatus: "ERROR",
          googleSyncError: short(classified.message),
          googleSyncAttempts: attempts,
          googleSyncNextAttemptAt: new Date(now().getTime() + backoffMs(attempts)),
        },
      });
      result.failed += 1;
      result.errors.push(`${person.displayName}: ${classified.message}`);
    }
  }

  return result;
}

/**
 * Update, recovering from a stale etag.
 *
 * An etag mismatch means the contact changed in Google since Hearth last saw it.
 * Re-reading and retrying once is correct here *because* Hearth is authoritative:
 * we are deliberately overwriting the remote edit. Returns "gone" when the
 * contact no longer exists, which the caller turns into a create.
 */
async function updateWithEtagRecovery(
  deps: SyncDeps,
  args: {
    resourceName: string;
    etag: string | null;
    person: Parameters<PeopleClient["createContact"]>[0];
    updateFields: string[];
  },
): Promise<{ resourceName: string; etag: string | null } | "gone"> {
  const attempt = async (etag: string) =>
    deps.people.updateContact({
      resourceName: args.resourceName,
      etag,
      person: args.person,
      updateFields: args.updateFields,
    });

  if (args.etag) {
    try {
      return await attempt(args.etag);
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "not_found") return "gone";
      if (classified.kind !== "conflict") throw err;
    }
  }

  const fresh = await deps.people.getEtag(args.resourceName);
  if (fresh === null) return "gone";
  return attempt(fresh);
}

async function markSynced(
  personId: string,
  resourceName: string,
  etag: string | null,
  at: Date,
): Promise<void> {
  await prisma.person.update({
    where: { id: personId },
    data: {
      googleResourceName: resourceName,
      googleEtag: etag,
      googleSyncedAt: at,
      googleSyncStatus: "SYNCED",
      googleSyncError: null,
      googleSyncAttempts: 0,
      googleSyncNextAttemptAt: null,
    },
  });
}

/**
 * Mark a tombstone done and detach the resource name from any record still
 * carrying it — the opt-out case, where the Person row survives the deletion.
 * Without this, re-ticking "Add to Google" would try to update a contact that no
 * longer exists.
 */
async function settleTombstone(
  tombstoneId: string,
  userId: string,
  resourceId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.syncTombstone.update({
      where: { id: tombstoneId },
      data: { processedAt: new Date(), lastError: null },
    }),
    prisma.person.updateMany({
      where: { ownerId: userId, googleResourceName: resourceId },
      data: { googleResourceName: null, googleEtag: null },
    }),
  ]);
}
