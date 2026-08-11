import { prisma } from "@/lib/db";
import { labelKey } from "@/lib/labels";
import type { GoogleContactGroup, PeopleClient } from "@/lib/google/people-client";

/**
 * Labels as Google contact groups.
 *
 * Google groups belong to an account, not to a contact: the owner's "Family" and a
 * recipient's "Family" are different resources with different ids. A shared contact
 * lands in every recipient's address book, so one Hearth label becomes N Google
 * groups — the same fan-out PersonSync does for the contacts themselves, which is
 * why LabelGroup is keyed on (label, account).
 *
 * Membership is reconciled through modifyGroupMembers rather than by writing
 * `memberships` on the contact. A person update replaces the membership list
 * wholesale, which would drop the contact out of My Contacts and out of any group the
 * user made by hand in Google. Group-at-a-time modification touches only the groups
 * Hearth created, and batches every contact in a sync run into one call per group.
 */

export interface LabelGroupDeps {
  people: PeopleClient;
  now?: () => Date;
}

/** What a contact's labels are, for one sync run. */
export interface LabelledContact {
  personId: string;
  resourceName: string;
  labelIds: string[];
}

/**
 * Ensure every given label has a group in this account, and that its name matches.
 *
 * Adoption by name comes first: a user who already has a "Family" label in Google
 * should have Hearth take that over rather than create a second one that looks
 * identical on their phone. That is also what makes this safe to re-run after a
 * database restore.
 */
export async function resolveGroups(
  userId: string,
  labelIds: readonly string[],
  deps: LabelGroupDeps,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (labelIds.length === 0) return resolved;

  const now = deps.now ?? (() => new Date());

  const labels = await prisma.label.findMany({
    where: { id: { in: [...labelIds] } },
    select: {
      id: true,
      name: true,
      googleGroups: { where: { userId }, select: { id: true, googleResourceName: true, googleEtag: true, googleSyncedAt: true } },
    },
  });

  // Listed once per run, not once per label: the call is the same cost either way,
  // and adopting by name needs the whole set anyway.
  let remote: GoogleContactGroup[] | null = null;
  const listRemote = async (): Promise<GoogleContactGroup[]> => {
    remote ??= await deps.people.listContactGroups();
    return remote;
  };

  for (const label of labels) {
    const link = label.googleGroups[0];

    if (link) {
      // googleSyncedAt is cleared when the label is renamed, which is the signal to
      // push the new name before using the group.
      if (link.googleSyncedAt === null) {
        const updated = await deps.people.updateContactGroup({
          resourceName: link.googleResourceName,
          etag: link.googleEtag,
          name: label.name,
        });
        if (updated) {
          await prisma.labelGroup.update({
            where: { id: link.id },
            data: {
              googleResourceName: updated.resourceName,
              googleEtag: updated.etag,
              googleSyncedAt: now(),
            },
          });
          resolved.set(label.id, updated.resourceName);
          continue;
        }
        // Vanished in Google: drop the link and fall through to recreate it.
        await prisma.labelGroup.delete({ where: { id: link.id } });
      } else {
        resolved.set(label.id, link.googleResourceName);
        continue;
      }
    }

    const existing = (await listRemote()).find(
      (g) => labelKey(g.name) === labelKey(label.name),
    );
    const group = existing ?? (await deps.people.createContactGroup(label.name));
    // Record a freshly created group in the cached listing so a second label with
    // the same name in this run adopts it rather than creating a duplicate.
    if (!existing) (await listRemote()).push(group);

    // A group can already be claimed by another label whose name was since changed;
    // upserting on (userId, googleResourceName) would collide, so claim it only if
    // free.
    const claimed = await prisma.labelGroup.findFirst({
      where: { userId, googleResourceName: group.resourceName },
      select: { labelId: true },
    });
    if (claimed && claimed.labelId !== label.id) continue;

    await prisma.labelGroup.upsert({
      where: { labelId_userId: { labelId: label.id, userId } },
      create: {
        labelId: label.id,
        userId,
        googleResourceName: group.resourceName,
        googleEtag: group.etag,
        googleSyncedAt: now(),
      },
      update: {
        googleResourceName: group.resourceName,
        googleEtag: group.etag,
        googleSyncedAt: now(),
      },
    });
    resolved.set(label.id, group.resourceName);
  }

  return resolved;
}

export interface MembershipResult {
  groupsTouched: number;
  added: number;
  removed: number;
}

/**
 * Reconcile group membership for the contacts touched by a sync run.
 *
 * Removals are computed against every group Hearth manages for this account, not
 * only the ones the contacts are in — that is what makes un-labelling take effect.
 * Restricting the comparison to contacts in this run keeps it a bounded amount of
 * work: a contact nobody edited is already correct.
 */
export async function applyMemberships(
  userId: string,
  contacts: readonly LabelledContact[],
  deps: LabelGroupDeps,
): Promise<MembershipResult> {
  const result: MembershipResult = { groupsTouched: 0, added: 0, removed: 0 };
  if (contacts.length === 0) return result;

  const managed = await prisma.labelGroup.findMany({
    where: { userId },
    select: { labelId: true, googleResourceName: true },
  });
  if (managed.length === 0) return result;

  for (const group of managed) {
    const add: string[] = [];
    const remove: string[] = [];

    for (const contact of contacts) {
      if (contact.labelIds.includes(group.labelId)) add.push(contact.resourceName);
      else remove.push(contact.resourceName);
    }

    if (add.length === 0 && remove.length === 0) continue;

    await deps.people.modifyGroupMembers({
      resourceName: group.googleResourceName,
      add,
      remove,
    });
    result.groupsTouched += 1;
    result.added += add.length;
    result.removed += remove.length;
  }

  return result;
}
