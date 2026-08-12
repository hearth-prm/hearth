import { prisma } from "@/lib/db";
import { loadRegistry } from "@/lib/fields/registry";
import { GoogleAuthError } from "@/lib/google/auth";
import {
  backoffMs,
  classifyGoogleError,
  type PeopleClient,
} from "@/lib/google/people-client";
import { hearthIdOf, serializePerson } from "@/lib/google/serialize-person";
import { loadMappings, type ResolvedMappings } from "@/lib/google/mappings";
import { readablePeopleWhere } from "@/lib/access";
import {
  applyMemberships,
  resolveGroups,
  type LabelledContact,
} from "@/lib/sync/label-groups";
import type { FieldDef } from "@/lib/fields/types";

/**
 * One-way push of Hearth contacts into Google Contacts.
 *
 * Hearth is authoritative: this only ever writes. Nothing is read back into
 * Person rows, so a change made directly in Google inside a field Hearth manages
 * is overwritten on the next push (see MANAGED_PERSON_FIELDS).
 *
 * A run pushes every contact this user can *read*, not merely own. That is the
 * point of sharing a contact: one Hearth record, a copy in every shared user's
 * address book, and an edit by any of them updating all of them. Each copy has its
 * own PersonSync row carrying its resource id, etag and retry state, because the
 * copies succeed and fail independently.
 *
 * Custom fields are rendered through the OWNER's registry and the OWNER's mappings,
 * so a shared contact looks the same in everybody's Google. Using each viewer's
 * mappings would make one Hearth record appear differently per account, which is
 * the opposite of a single source of truth.
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
  /** Google contact groups whose membership was reconciled. */
  groupsTouched: number;
  /** Contact photos uploaded to or removed from Google. */
  photosPushed: number;
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
    groupsTouched: 0,
    photosPushed: 0,
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
  if (r.groupsTouched) parts.push(`${r.groupsTouched} label(s) applied`);
  if (r.photosPushed) parts.push(`${r.photosPushed} photo(s)`);
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
      // Contact groups drain in the same pass: both are "a remote thing Hearth can
      // no longer find from its own rows", and both need the same retry treatment.
      target: { in: ["GOOGLE_CONTACT", "GOOGLE_CONTACT_GROUP"] },
      processedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  for (const tombstone of tombstones) {
    try {
      if (tombstone.target === "GOOGLE_CONTACT_GROUP") {
        await deps.people.deleteContactGroup(tombstone.resourceId);
        // Groups have no PersonSync row to clear, so the tombstone is simply marked
        // done rather than going through settleTombstone.
        await prisma.syncTombstone.update({
          where: { id: tombstone.id },
          data: { processedAt: now() },
        });
        result.groupsTouched += 1;
        continue;
      }

      await deps.people.deleteContact(tombstone.resourceId);
      await settleTombstone(tombstone.id, userId, tombstone.resourceId);
      result.deleted += 1;
    } catch (err) {
      const classified = classifyGoogleError(err);

      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);

      if (classified.kind === "not_found") {
        // Already gone — the goal state. Deleting is idempotent, so this counts
        // as success rather than an error to retry forever.
        if (tombstone.target === "GOOGLE_CONTACT_GROUP") {
          await prisma.syncTombstone.update({
            where: { id: tombstone.id },
            data: { processedAt: now() },
          });
        } else {
          await settleTombstone(tombstone.id, userId, tombstone.resourceId);
          result.deleted += 1;
        }
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
    select: { syncSharedContacts: true },
  });

  // The owner's field definitions and mappings decide what a contact looks like in
  // Google, so they are fetched per owner and memoised for the run — a batch can
  // span several owners once contacts are shared.
  const perOwner = new Map<
    string,
    { customFields: FieldDef[]; mappings: ResolvedMappings }
  >();
  const contextFor = async (ownerId: string) => {
    let ctx = perOwner.get(ownerId);
    if (!ctx) {
      const [registry, mappings] = await Promise.all([
        loadRegistry(ownerId, "PERSON"),
        loadMappings(ownerId, "PERSON"),
      ]);
      ctx = { customFields: registry.filter((f) => !f.core), mappings };
      perOwner.set(ownerId, ctx);
    }
    return ctx;
  };

  const queue = await prisma.person.findMany({
    where: {
      AND: [
        // Readable, not owned: a shared contact belongs in this account's Google
        // too. Sync is the one place that used to scope by owner and now must not.
        readablePeopleWhere(userId),
        { addToGoogle: true },
        // Someone who would rather not have a partner's address book in their own
        // Google keeps only what they own.
        settings?.syncSharedContacts === false ? { ownerId: userId } : {},
        {
          OR: [
            // Never pushed to this account.
            { googleSyncs: { none: { userId } } },
            {
              googleSyncs: {
                some: {
                  userId,
                  googleSyncStatus: { in: ["PENDING", "ERROR"] },
                  OR: [
                    { googleSyncNextAttemptAt: null },
                    { googleSyncNextAttemptAt: { lte: now() } },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    include: {
      contactPoints: true,
      googleSyncs: { where: { userId } },
      labels: { select: { labelId: true } },
      // Both candidate photos: this account's own override, and the owner's default.
      // Which one wins is decided per contact below.
      photos: {
        where: { userId: { in: [userId] } },
        select: { userId: true, etag: true },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: batchSize,
  });

  // The owner's photo is the fallback for contacts this user does not own, so those
  // rows are fetched separately rather than widening the include above.
  const ownerPhotoEtags = new Map<string, string>();
  {
    const foreign = queue.filter((p) => p.ownerId !== userId);
    if (foreign.length > 0) {
      const rows = await prisma.personPhoto.findMany({
        where: { personId: { in: foreign.map((p) => p.id) } },
        select: { personId: true, userId: true, etag: true },
      });
      for (const p of foreign) {
        const owners = rows.find((r) => r.personId === p.id && r.userId === p.ownerId);
        if (owners) ownerPhotoEtags.set(p.id, owners.etag);
      }
    }
  }

  // Group membership is reconciled after the contacts themselves, because a contact
  // has to exist in Google before it can join a group. Collected as we go so the
  // reconciliation is one call per group rather than per contact.
  const labelled: LabelledContact[] = [];
  const noteLabels = (personId: string, resourceName: string, labelIds: string[]) => {
    labelled.push({ personId, resourceName, labelIds });
  };

  // Photos likewise: a contact must exist in Google before it can be given a picture,
  // and the upload is a separate endpoint from the field write.
  const photoWork: {
    personId: string;
    resourceName: string;
    /** etag of the photo this account should end up with, or null for none. */
    wantEtag: string | null;
  }[] = [];

  for (const person of queue) {
    const link = person.googleSyncs[0];
    const labelIds = person.labels.map((pl) => pl.labelId);
    // This account's own picture wins; otherwise it inherits the owner's. For a
    // contact this user owns, their own row IS the owner's, so the first term covers it.
    const wantPhotoEtag =
      person.photos.find((ph) => ph.userId === userId)?.etag ??
      ownerPhotoEtags.get(person.id) ??
      null;
    const notePhoto = (resourceName: string) => {
      photoWork.push({ personId: person.id, resourceName, wantEtag: wantPhotoEtag });
    };
    const { customFields, mappings } = await contextFor(person.ownerId);
    const { person: payload, updateFields } = serializePerson(person, {
      customFields,
      mappings,
    });

    try {
      let resourceName = link?.googleResourceName ?? null;
      let etag = link?.googleEtag ?? null;
      const attemptsSoFar = link?.googleSyncAttempts ?? 0;

      // A record that failed before may already have a contact in this account from
      // a create that succeeded remotely but was never recorded. Adopt it rather
      // than adding a duplicate to a real address book.
      if (!resourceName && attemptsSoFar > 0) {
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
          // Deleted in Google since the last write. Create afresh so the contact
          // reappears rather than erroring forever.
          const created = await deps.people.createContact(payload);
          await markSynced(person.id, userId, created.resourceName, created.etag, now());
          noteLabels(person.id, created.resourceName, labelIds);
          notePhoto(created.resourceName);
          result.created += 1;
        } else {
          await markSynced(person.id, userId, written.resourceName, written.etag, now());
          noteLabels(person.id, written.resourceName, labelIds);
          notePhoto(written.resourceName);
          result.updated += 1;
        }
      } else {
        const created = await deps.people.createContact(payload);
        await markSynced(person.id, userId, created.resourceName, created.etag, now());
        noteLabels(person.id, created.resourceName, labelIds);
        notePhoto(created.resourceName);
        result.created += 1;
      }
    } catch (err) {
      const classified = classifyGoogleError(err);

      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);
      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
        break;
      }

      const attempts = (link?.googleSyncAttempts ?? 0) + 1;
      await markFailed(
        person.id,
        userId,
        short(classified.message),
        attempts,
        new Date(now().getTime() + backoffMs(attempts)),
      );
      result.failed += 1;
      result.errors.push(`${person.displayName}: ${classified.message}`);
    }
  }

  // --- 3. photos ---------------------------------------------------------
  //
  // Compared against what this account was last sent, so an unchanged photo costs
  // nothing: the etag is a hash of the bytes, so equality really does mean "Google
  // already has this image". Uploading changes the contact's etag in Google, which
  // makes the stored one stale — harmless, because the next field write recovers from
  // an etag conflict by re-reading.
  //
  // Not fatal, for the same reason as labels: the contact itself is already correct,
  // and failing it would roll back a good push to retry it for a picture.
  for (const work of photoWork) {
    try {
      const current = await prisma.personSync.findFirst({
        where: { personId: work.personId, userId },
        select: { googlePhotoEtag: true },
      });
      if ((current?.googlePhotoEtag ?? null) === work.wantEtag) continue;

      if (work.wantEtag) {
        const bytes = await prisma.personPhoto.findFirst({
          where: { personId: work.personId, etag: work.wantEtag },
          select: { data: true },
        });
        if (!bytes) continue; // deleted between the queue and here
        await deps.people.updateContactPhoto({
          resourceName: work.resourceName,
          data: bytes.data,
        });
      } else {
        // Only reached when a photo was previously pushed and has since been removed.
        await deps.people.deleteContactPhoto(work.resourceName);
      }

      await prisma.personSync.updateMany({
        where: { personId: work.personId, userId },
        data: { googlePhotoEtag: work.wantEtag },
      });
      result.photosPushed += 1;
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);
      if (classified.kind === "rate_limit") {
        result.rateLimited = true;
        break;
      }
      result.errors.push(`photo ${work.personId}: ${classified.message}`);
    }
  }

  // --- 4. labels as Google contact groups --------------------------------
  //
  // Deliberately after the contacts, and deliberately not fatal: the contacts
  // themselves are already correct in Google, and marking them failed over a group
  // problem would roll back a successful push and retry it needlessly. A group
  // problem is reported and retried on the next run, when the labels are re-read
  // from the database anyway.
  if (!result.rateLimited && labelled.length > 0) {
    try {
      const labelIds = [...new Set(labelled.flatMap((c) => c.labelIds))];
      await resolveGroups(userId, labelIds, deps);
      const memberships = await applyMemberships(userId, labelled, deps);
      result.groupsTouched = memberships.groupsTouched;
    } catch (err) {
      const classified = classifyGoogleError(err);
      if (classified.kind === "auth") throw new GoogleAuthError(classified.message);
      if (classified.kind === "rate_limit") result.rateLimited = true;
      result.errors.push(`labels: ${classified.message}`);
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
  userId: string,
  resourceName: string,
  etag: string | null,
  at: Date,
): Promise<void> {
  const state = {
    googleResourceName: resourceName,
    googleEtag: etag,
    googleSyncedAt: at,
    googleSyncStatus: "SYNCED" as const,
    googleSyncError: null,
    googleSyncAttempts: 0,
    googleSyncNextAttemptAt: null,
  };
  // Upsert rather than update: the first push to a given account has no row yet.
  await prisma.personSync.upsert({
    where: { personId_userId: { personId, userId } },
    create: { personId, userId, ...state },
    update: state,
  });
}

async function markFailed(
  personId: string,
  userId: string,
  message: string,
  attempts: number,
  nextAttemptAt: Date,
): Promise<void> {
  const state = {
    googleSyncStatus: "ERROR" as const,
    googleSyncError: message,
    googleSyncAttempts: attempts,
    googleSyncNextAttemptAt: nextAttemptAt,
  };
  await prisma.personSync.upsert({
    where: { personId_userId: { personId, userId } },
    create: { personId, userId, ...state },
    update: state,
  });
}

/**
 * Mark a tombstone done and forget this account's link to the contact — the opt-out
 * case, where the Person row survives the deletion. Without it, re-ticking "Add to
 * Google" would try to update a contact that no longer exists.
 *
 * Scoped to the one account: a shared contact's other copies are unaffected.
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
    prisma.personSync.updateMany({
      where: { userId, googleResourceName: resourceId },
      data: {
        googleResourceName: null,
        googleEtag: null,
        googleSyncStatus: "DISABLED",
      },
    }),
  ]);
}
