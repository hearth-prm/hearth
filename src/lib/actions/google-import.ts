"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { getGoogleClient } from "@/lib/google/auth";
import { createPeopleClient } from "@/lib/google/people-client";
import {
  GOOGLE_IMPORT_FIELDS,
  planGoogleImport,
  type GoogleImportPlan,
  type PlannedContact,
} from "@/lib/google/import-plan";

import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readString, toActionError } from "@/lib/actions/shared";
import { importOne } from "@/lib/google/import-one";

/**
 * Importing contacts that already exist in Google.
 *
 * Nothing is written to Google here, which is the point. A PersonSync row carrying the
 * existing resourceName is enough: the ordinary sync sees a link and calls updateContact
 * rather than createContact, so the contact is adopted in place and hearth_id arrives
 * through the serializer that already has tests. Writing hearth_id here as well would be
 * a second, untested path to the same end.
 *
 * The consequence, spelled out in the preview, is that the first sync makes Hearth
 * authoritative for every managed field group. Anything the import failed to copy would
 * be erased from Google then — so the planner rescues what has nowhere to sit, and this
 * action maps those rescues back to Google custom fields so they survive the round trip.
 */

export interface GoogleImportState extends ActionState {
  plan?: GoogleImportPlan;
  /** Google's own labels, for narrowing what to bring in. */
  groups?: { resourceName: string; name: string; count: number }[];
  /**
   * The filter this plan was built with, echoed back.
   *
   * The confirm step re-reads from Google rather than trusting a plan posted from the
   * browser, so it has to be told which selection to re-read — and it must be the one
   * that was reviewed, not whatever the picker says by then.
   */
  groupFilter?: string;
  imported?: number;
}

async function loadPlan(userId: string, groupFilter: string | null) {
  const auth = await getGoogleClient(userId);
  const people = createPeopleClient(auth);

  const [connections, groups] = await Promise.all([
    people.listConnections([...GOOGLE_IMPORT_FIELDS]),
    people.listContactGroups(),
  ]);

  // Already-linked contacts are reported rather than hidden, so a second import of the
  // same label says "already here" instead of quietly doing nothing.
  const linked = await prisma.personSync.findMany({
    where: { userId, googleResourceName: { not: null } },
    select: { googleResourceName: true },
  });
  const linkedResourceNames = new Set(
    linked
      .map((l) => l.googleResourceName)
      .filter((n): n is string => Boolean(n)),
  );

  const wanted = groupFilter
    ? connections.filter((p) =>
        (p.memberships ?? []).some(
          (m) => m.contactGroupMembership?.contactGroupResourceName === groupFilter,
        ),
      )
    : connections;

  const plan = planGoogleImport(wanted, { linkedResourceNames });

  const groupCounts = groups.map((g) => ({
    resourceName: g.resourceName,
    name: g.name,
    count: connections.filter((p) =>
      (p.memberships ?? []).some(
        (m) => m.contactGroupMembership?.contactGroupResourceName === g.resourceName,
      ),
    ).length,
  }));

  return { plan, groups: groupCounts };
}

export async function previewGoogleImport(
  _prev: GoogleImportState,
  form: FormData,
): Promise<GoogleImportState> {
  try {
    const user = await requireUserForAction();
    const groupFilter = readString(form, "groupFilter") || null;
    const { plan, groups } = await loadPlan(user.id, groupFilter);

    if (plan.contacts.length === 0) {
      return {
        ...actionError("No contacts found in that selection."),
        groups,
        groupFilter: groupFilter ?? "",
      };
    }

    return { ...actionOk(), plan, groups, groupFilter: groupFilter ?? "" };
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}

export async function applyGoogleImport(
  _prev: GoogleImportState,
  form: FormData,
): Promise<GoogleImportState> {
  try {
    const user = await requireUserForAction();
    const groupFilter = readString(form, "groupFilter") || null;
    const chosen = new Set(form.getAll("resourceName").map(String));
    if (chosen.size === 0) return actionError("Choose at least one contact.");

    // Re-planned rather than trusting what the browser sends back: the plan carries
    // every field of every contact, and a form is not a safe place to keep somebody's
    // address book. Only the choice of which contacts comes from the page.
    const { plan } = await loadPlan(user.id, groupFilter);

    // Google labels become Hearth labels, matched by name so a second import reuses
    // them rather than making "Family" twice.
    const groupNames = new Map<string, string>();
    const auth = await getGoogleClient(user.id);
    for (const group of await createPeopleClient(auth).listContactGroups()) {
      groupNames.set(group.resourceName, group.name);
    }

    const labelIdsByGroup = new Map<string, string>();
    for (const [resourceName, name] of groupNames) {
      const label = await prisma.label.upsert({
        where: { ownerId_name: { ownerId: user.id, name } },
        create: { ownerId: user.id, name },
        update: {},
        select: { id: true },
      });
      labelIdsByGroup.set(resourceName, label.id);
    }

    let imported = 0;
    for (const contact of plan.contacts) {
      if (contact.action !== "import") continue;
      if (!chosen.has(contact.resourceName)) continue;
      await importOne(user.id, contact, labelIdsByGroup);
      imported += 1;
    }

    revalidatePath("/people");
    return {
      ...actionOk(
        imported === 1
          ? "1 contact imported. The next sync will add its Hearth id in Google."
          : `${imported} contacts imported. The next sync will add their Hearth ids in Google.`,
      ),
      imported,
    };
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }
}
