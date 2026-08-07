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
  btnDanger,
  btnSecondary,
  Card,
  CardHeader,
  DetailRow,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { DeleteForm } from "@/components/delete-form";
import { RelationshipForm } from "@/components/relationship-form";

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
      contactPoints: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      eventAttendances: {
        include: { event: true },
        orderBy: { event: { startAt: "desc" } },
        take: 25,
      },
    },
  });
  if (!person) notFound();

  const [defs, relationships, types, settings, others] = await Promise.all([
    loadRegistry(user.id, "PERSON"),
    loadRelationshipsFor(user.id, person.id),
    loadRelationshipTypes(user.id),
    getUserSettings(user.id),
    prisma.person.findMany({
      where: { AND: [readablePeopleWhere(user.id), { id: { not: person.id } }] },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
      take: 1000,
    }),
  ]);

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
            <Link href={`/people/${person.id}/edit`} className={btnSecondary}>
              Edit
            </Link>
            <DeleteForm
              action={deletePerson}
              id={person.id}
              label="Delete"
              className={btnDanger}
              confirmMessage={`Delete ${person.displayName}? ${
                person.googleResourceName
                  ? "Their Google contact will be removed on the next sync."
                  : ""
              }`}
            />
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
                  status={person.googleSyncStatus}
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

          <Card>
            <CardHeader title="Record" />
            <dl className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
              <DetailRow label="Added">
                {formatInstant(person.createdAt, settings.timeZone)}
              </DetailRow>
              <DetailRow label="Updated">
                {formatInstant(person.updatedAt, settings.timeZone)}
              </DetailRow>
              {person.googleSyncedAt ? (
                <DetailRow label="Last synced">
                  {formatInstant(person.googleSyncedAt, settings.timeZone)}
                </DetailRow>
              ) : null}
              {person.googleSyncError ? (
                <DetailRow label="Sync error">
                  <span className="text-rose-600 dark:text-rose-400">
                    {person.googleSyncError}
                  </span>
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
