import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import { loadRelationshipsFor, loadRelationshipTypes } from "@/lib/relationships";
import { CONTACT_KIND_LABELS } from "@/lib/people";
import { getUserSettings } from "@/lib/settings";
import { formatDateOnly, formatInstant } from "@/lib/time";
import { addRelationship, removeRelationship } from "@/lib/actions/relationships";
import { deletePerson } from "@/lib/actions/people";
import {
  Badge,
  btnDanger,
  btnSecondary,
  Card,
  CardHeader,
  DetailRow,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { GoogleContactLink } from "@/components/google-contact-link";
import { DeleteForm } from "@/components/delete-form";
import { RelationshipForm } from "@/components/relationship-form";
import { ShareRecordForm } from "@/components/share-forms";
import { shareRecord } from "@/lib/actions/shares";
import { listOtherUsers } from "@/lib/users";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const person = await prisma.person.findFirst({
    where: { id, ...readablePeopleWhere(user.id) },
    include: {
      owner: { select: { id: true, email: true, name: true } },
      googleSyncs: { include: { user: { select: { email: true } } } },
      contactPoints: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      eventAttendances: {
        include: { event: true },
        orderBy: { event: { startAt: "desc" } },
        take: 25,
      },
    },
  });
  if (!person) notFound();

  const isOwner = person.ownerId === user.id;
  // This account's copy, and every other account holding one.
  const mySync = person.googleSyncs.find((g) => g.userId === user.id);
  const otherSyncs = person.googleSyncs.filter(
    (g) => g.userId !== user.id && g.googleResourceName,
  );

  // Registry and relationships belong to the record's OWNER, not the viewer. A
  // shared contact's custom values are keyed by the owner's field definitions, so
  // reading them through the viewer's registry would render nothing — or, worse,
  // whatever happened to share a key name.
  const [defs, relationships, types, settings, others, myShares] = await Promise.all([
    loadRegistry(person.ownerId, "PERSON"),
    loadRelationshipsFor(person.ownerId, person.id),
    loadRelationshipTypes(person.ownerId),
    getUserSettings(user.id),
    prisma.person.findMany({
      where: { AND: [{ ownerId: person.ownerId }, { id: { not: person.id } }] },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 1000,
    }),
    isOwner
      ? prisma.share.findMany({
          where: { ownerId: user.id, scope: "PERSON", personId: person.id },
          include: { withUser: { select: { email: true } } },
        })
      : Promise.resolve([]),
  ]);

  const shareableUsers = isOwner ? await listOtherUsers(user.id) : [];

  // Only render fields that actually hold something — a detail page listing 20
  // empty rows is worse than one showing the six facts you recorded.
  const populated = defs
    .map((def) => ({ def, value: readFieldValue(person, def) }))
    .filter(({ def, value }) => formatFieldValue(def, value).length > 0 && def.key !== "notes");

  const notesDef = defs.find((d) => d.key === "notes");
  const notes = notesDef ? formatFieldValue(notesDef, person.notes) : "";

  return (
    <div>
      <PageHeader
        title={person.displayName}
        description={
          [person.jobTitle, person.organization].filter(Boolean).join(" · ") ||
          undefined
        }
        action={
          <div className="flex items-center gap-2">
            {!isOwner ? (
              <Badge tone="amber">shared by {person.owner.email}</Badge>
            ) : null}
            <Link href={`/people/${person.id}/edit`} className={btnSecondary}>
              Edit
            </Link>
            {/* Deleting stays with the owner even under an EDIT share. */}
            {isOwner ? (
              <DeleteForm
                action={deletePerson}
                id={person.id}
                label="Delete"
                className={btnDanger}
                confirmMessage={`Delete ${person.displayName}? ${
                  person.googleSyncs.some((g) => g.googleResourceName)
                    ? "The Google contact will be removed from every account it reached, on the next sync."
                    : ""
                }`}
              />
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Details"
              action={
                <SyncBadge
                  addToGoogle={person.addToGoogle}
                  status={mySync?.googleSyncStatus ?? "PENDING"}
                />
              }
            />
            {populated.length === 0 && person.contactPoints.length === 0 ? (
              <p className="px-5 py-6 text-sm text-neutral-500 dark:text-neutral-400">
                Nothing recorded yet.{" "}
                <Link
                  href={`/people/${person.id}/edit`}
                  className="text-teal-700 hover:underline dark:text-teal-400"
                >
                  Add some details
                </Link>
                .
              </p>
            ) : (
              <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {populated.map(({ def, value }) => (
                  <DetailRow key={def.key} label={def.label}>
                    {formatFieldValue(def, value)}
                  </DetailRow>
                ))}
                {person.contactPoints.map((cp) => (
                  <DetailRow
                    key={cp.id}
                    label={
                      cp.label
                        ? `${CONTACT_KIND_LABELS[cp.kind]} · ${cp.label}`
                        : CONTACT_KIND_LABELS[cp.kind]
                    }
                  >
                    <ContactValue kind={cp.kind} value={cp.value} />
                    {cp.isPrimary && (cp.kind === "EMAIL" || cp.kind === "PHONE") ? (
                      <span className="ml-2 text-xs text-neutral-400">primary</span>
                    ) : null}
                  </DetailRow>
                ))}
              </dl>
            )}
          </Card>

          {notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">
                {notes}
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Relationships"
              description="One row serves both people — it reads correctly from either side."
            />
            <div className="px-5 py-4">
              {relationships.length === 0 ? (
                <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
                  No relationships recorded.
                </p>
              ) : (
                <ul className="mb-6 divide-y divide-neutral-100 dark:divide-neutral-800/60">
                  {relationships.map((rel) => (
                    <li
                      key={rel.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                    >
                      <span className="text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {rel.label}
                        </span>{" "}
                        <Link
                          href={`/people/${rel.other.id}`}
                          className="font-medium text-teal-700 hover:underline dark:text-teal-400"
                        >
                          {rel.other.displayName}
                        </Link>
                        {rel.notes ? (
                          <span className="text-neutral-500 dark:text-neutral-400">
                            {" "}
                            — {rel.notes}
                          </span>
                        ) : null}
                        {rel.startedOn ? (
                          <span className="ml-2 text-xs text-neutral-400">
                            since {formatDateOnly(rel.startedOn)}
                          </span>
                        ) : null}
                      </span>
                      <DeleteForm
                        action={removeRelationship}
                        id={rel.id}
                        label="Remove"
                        pendingLabel="Removing…"
                        className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                        confirmMessage="Remove this relationship?"
                      />
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-neutral-100 pt-5 dark:border-neutral-800/60">
                <RelationshipForm
                  action={addRelationship}
                  personId={person.id}
                  personName={person.displayName}
                  types={types.map((t) => ({
                    id: t.id,
                    label: t.label,
                    inverseLabel: t.inverseLabel,
                    symmetric: t.symmetric,
                  }))}
                  people={others}
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Events" description="Where they showed up." />
            {person.eventAttendances.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                Not linked to any events yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {person.eventAttendances.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <Link
                      href={`/events/${a.event.id}`}
                      className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400"
                    >
                      {a.event.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      {formatInstant(a.event.startAt, a.event.timeZone, {
                        withTime: !a.event.allDay,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader
                title="Sharing"
                description="Give someone else access to this contact."
              />
              <div className="space-y-3 px-5 py-4">
                {myShares.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {myShares.map((sh) => (
                      <li key={sh.id} className="text-neutral-600 dark:text-neutral-400">
                        {sh.withUser.email} —{" "}
                        {sh.permission === "EDIT" ? "can edit" : "view only"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ShareRecordForm
                  action={shareRecord}
                  users={shareableUsers}
                  alreadyShared={myShares.map((sh) => sh.withUserId)}
                  personId={person.id}
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Record" />
            <dl className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
              <DetailRow label="Added">
                {formatInstant(person.createdAt, settings.timeZone)}
              </DetailRow>
              <DetailRow label="Updated">
                {formatInstant(person.updatedAt, settings.timeZone)}
              </DetailRow>
              <GoogleContactLink
                resourceName={mySync?.googleResourceName ?? null}
                addToGoogle={person.addToGoogle}
              />
              {mySync?.googleSyncedAt ? (
                <DetailRow label="Last synced">
                  {formatInstant(mySync.googleSyncedAt, settings.timeZone)}
                </DetailRow>
              ) : null}
              {mySync?.googleSyncError ? (
                <DetailRow label="Sync error">
                  <span className="text-rose-600 dark:text-rose-400">
                    {mySync.googleSyncError}
                  </span>
                </DetailRow>
              ) : null}
              {otherSyncs.length > 0 ? (
                <DetailRow label="Also in Google for">
                  {otherSyncs.map((g) => g.user.email).join(", ")}
                </DetailRow>
              ) : null}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContactValue({ kind, value }: { kind: string; value: string }) {
  if (kind === "EMAIL") {
    return (
      <a href={`mailto:${value}`} className="text-teal-700 hover:underline dark:text-teal-400">
        {value}
      </a>
    );
  }
  if (kind === "PHONE") {
    return (
      <a href={`tel:${value}`} className="text-teal-700 hover:underline dark:text-teal-400">
        {value}
      </a>
    );
  }
  if (kind === "URL") {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="text-teal-700 hover:underline dark:text-teal-400"
      >
        {value}
      </a>
    );
  }
  return <>{value}</>;
}
