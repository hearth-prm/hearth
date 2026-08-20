import { prisma } from "@/lib/db";
import { computeDisplayName } from "@/lib/people";
import { nextCustomFieldOrder } from "@/lib/fields/registry";
import { recordPersonVersionAfter } from "@/lib/person-versions";
import { savePhotoFromUrl } from "@/lib/google/fetch-photo";
import { reclaimGoogleContact } from "@/lib/sync/tombstones";
import type { PlannedContact } from "./import-plan";

/**
 * Writing one planned Google contact into Hearth.
 *
 * Split out of the import action, and not merely for tidiness: an action reads request
 * headers and cannot be called without a request, so everything in here — the columns, the
 * rescued fields, the adoption link, the picture — was reachable only by driving a browser
 * against a real Google account. The pieces each had tests and the wiring between them had
 * none, which is exactly where this codebase has been bitten before.
 */

/**
 * Make sure a rescued value has somewhere to live, and a way home.
 *
 * The mapping is what closes the loop. Without one the value would sit in Hearth and be
 * absent from the next push, and Google replaces the whole userDefined group — so the
 * field it came from would be deleted, having been "preserved".
 */
export async function ensureRescueField(
  ownerId: string,
  key: string,
  label: string,
): Promise<void> {
  const existing = await prisma.fieldDefinition.findFirst({
    where: { ownerId, entity: "PERSON", key },
    select: { id: true },
  });
  if (!existing) {
    await prisma.fieldDefinition.create({
      data: {
        ownerId,
        entity: "PERSON",
        key,
        label,
        type: "TEXT",
        order: await nextCustomFieldOrder(ownerId, "PERSON"),
        helpText: "Imported from Google Contacts.",
      },
    });
  }

  await prisma.fieldMapping.upsert({
    where: { ownerId_entity_fieldKey: { ownerId, entity: "PERSON", fieldKey: key } },
    create: { ownerId, entity: "PERSON", fieldKey: key, target: "userDefined", targetKey: label },
    update: {},
  });
}

export async function importOne(
  userId: string,
  contact: PlannedContact,
  labelIdsByGroup: Map<string, string>,
): Promise<void> {
  const custom: Record<string, string> = {};
  for (const rescued of contact.rescued) {
    await ensureRescueField(userId, rescued.key, rescued.label);
    custom[rescued.key] = rescued.value;
  }

  const labelIds = contact.groupIds
    .map((g) => labelIdsByGroup.get(g))
    .filter((id): id is string => Boolean(id));

  // Re-importing a contact that was deleted here but still exists in Google. Two things
  // are in the way, both invisible until it happens: a deletion still waiting to be sent,
  // which would fire afterwards and disable the row just created, and the trashed
  // original still claiming the resource name that @@unique([userId, googleResourceName])
  // allows only one contact to hold. Taking the contact back settles both.
  await prisma.$transaction(async (tx) => {
    await reclaimGoogleContact(tx, { userId, resourceName: contact.resourceName });
  });

  const created = await prisma.person.create({
    select: { id: true },
    data: {
      ownerId: userId,
      givenName: contact.columns.givenName,
      middleName: contact.columns.middleName,
      familyName: contact.columns.familyName,
      honorificPrefix: contact.columns.honorificPrefix,
      honorificSuffix: contact.columns.honorificSuffix,
      phoneticGivenName: contact.columns.phoneticGivenName,
      phoneticMiddleName: contact.columns.phoneticMiddleName,
      phoneticFamilyName: contact.columns.phoneticFamilyName,
      nickname: contact.columns.nickname,
      organization: contact.columns.organization,
      jobTitle: contact.columns.jobTitle,
      orgDepartment: contact.columns.orgDepartment,
      orgJobDescription: contact.columns.orgJobDescription,
      orgSymbol: contact.columns.orgSymbol,
      orgDomain: contact.columns.orgDomain,
      orgLocation: contact.columns.orgLocation,
      orgPhoneticName: contact.columns.orgPhoneticName,
      orgType: contact.columns.orgType,
      notes: contact.columns.notes,
      gender: contact.columns.gender,
      birthday: contact.columns.birthday
        ? new Date(`${contact.columns.birthday}T00:00:00.000Z`)
        : null,
      birthdayText: contact.columns.birthdayText,
      displayName: computeDisplayName({
        givenName: contact.columns.givenName,
        familyName: contact.columns.familyName,
        nickname: contact.columns.nickname,
        organization: contact.columns.organization,
      }),
      custom,
      contactPoints: {
        // Spread, so a part added to PlannedContactPoint reaches the database without
        // this list having to be remembered — the shape is checked at the write.
        create: contact.contactPoints.map((cp) => ({ ...cp })),
      },
      googleEvents: {
        create: contact.events.map((e, order) => ({ ...e, order })),
      },
      googleRelations: {
        create: contact.relations.map((r, order) => ({ ...r, order })),
      },
      labels: { create: labelIds.map((labelId) => ({ labelId })) },
      // The link that makes this an adoption rather than a duplicate: the next sync
      // finds a resourceName and updates that contact instead of creating one.
      googleSyncs: {
        create: {
          userId,
          googleResourceName: contact.resourceName,
          googleEtag: contact.etag,
          googleSyncStatus: "PENDING",
        },
      },
    },
  });

  // The picture, if it has one. Downloaded rather than referenced: a URL in a custom field
  // is a link that rots — Google's contact photo URLs are not permanent, and a contact whose
  // picture is a dead link is worse than one with initials. Google resizes on demand, which
  // is what makes this possible with no image decoder on the server.
  if (contact.photoUrl) {
    const outcome = await savePhotoFromUrl(created.id, userId, contact.photoUrl);
    // A picture that will not download is not a reason to lose a contact. The import
    // carries on and the contact keeps its initials.
    if (outcome !== "saved") {
      console.warn(`[hearth] photo for ${contact.displayName}: ${outcome}`);
    }
  }

  // The first version of an adopted contact is what Google had, which makes the history
  // start where the data did rather than at the first edit somebody makes afterwards.
  await recordPersonVersionAfter(created.id, {
    byUserId: userId,
    source: "GOOGLE_IMPORT",
  });
}
