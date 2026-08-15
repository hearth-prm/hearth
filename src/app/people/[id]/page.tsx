import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canWritePerson, readablePeopleWhere, requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { formatFieldValue } from "@/lib/fields/format";
import { readFieldValue } from "@/lib/fields/values";
import {
  loadRelationshipsFor,
  loadRelationshipTypes,
  relationshipPeriod,
} from "@/lib/relationships";
import { CONTACT_KIND_LABELS } from "@/lib/people";
import { getUserSettings } from "@/lib/settings";
import { dateOnlyToInput, formatDateOnly, formatInstant } from "@/lib/time";
import {
  addRelationship,
  removeRelationship,
  updateRelationship,
} from "@/lib/actions/relationships";
import { deletePerson } from "@/lib/actions/people";
import {
  Badge,
  btnDanger,
  btnSecondary,
  Card,
  CardHeader,
  DetailRow,
  Hint,
  PageHeader,
} from "@/components/ui";
import { SyncBadge } from "@/components/sync-badge";
import { GoogleContactLink } from "@/components/google-contact-link";
import { DeleteForm } from "@/components/delete-form";
import { RelationshipForm } from "@/components/relationship-form";
import { RelationshipEditForm } from "@/components/relationship-edit-form";
import { GiftForm, GiftEditForm } from "@/components/gift-forms";
import { listGiftsForPerson, giftDate } from "@/lib/gifts";
import { addGift, removeGift, updateGift } from "@/lib/actions/gifts";
import { ShareRecordForm } from "@/components/share-forms";
import { LabelChips } from "@/components/label-chip";
import { Avatar } from "@/components/avatar";
import { PhotoForm } from "@/components/photo-form";
import { effectivePhotoFor } from "@/lib/photos-db";
import { clearPersonPhoto, setPersonPhoto } from "@/lib/actions/photos";
import { PersonLabelsForm } from "@/components/label-forms";
import { setPersonLabels } from "@/lib/actions/labels";
import { revokeShare, shareRecord } from "@/lib/actions/shares";
import { TransferForm } from "@/components/transfer-form";
import { transferOwnership } from "@/lib/actions/transfer";
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
      labels: { include: { label: true }, orderBy: { label: { name: "asc" } } },
      eventAttendances: {
        include: { event: true },
        orderBy: { event: { startAt: "desc" } },
        take: 25,
      },
    },
  });
  if (!person) notFound();

  const isOwner = person.ownerId === user.id;
  // Owning is not the same question as being allowed to edit: a VIEW share grants
  // neither. Asked of the access layer rather than derived here, so this cannot
  // drift from what the actions will actually permit.
  const canEdit = isOwner || (await canWritePerson(user.id, person.id));
  // This account's copy, and every other account holding one.
  const mySync = person.googleSyncs.find((g) => g.userId === user.id);
  const otherSyncs = person.googleSyncs.filter(
    (g) => g.userId !== user.id && g.googleResourceName,
  );

  // Registry and relationships belong to the record's OWNER, not the viewer. A
  // shared contact's custom values are keyed by the owner's field definitions, so
  // reading them through the viewer's registry would render nothing — or, worse,
  // whatever happened to share a key name.
  const [defs, relationships, types, settings, others, myShares, ownerLabels, gifts] =
    await Promise.all([
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
      // The owner's labels, for the same reason as the registry: one shared contact
      // carries one set of labels, so an editing recipient picks from the owner's.
      prisma.label.findMany({
        where: { ownerId: person.ownerId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      }),
      // Gifts in both directions; the split into given and received happens below.
      listGiftsForPerson(user.id, person.id),
    ]);

  const shareableUsers = isOwner ? await listOtherUsers(user.id) : [];

  // Photos are the one field that is per viewer: the owner's is the default and reaches
  // everyone, but anyone who can see the contact may set their own instead.
  const [photo, photoRows] = await Promise.all([
    effectivePhotoFor(person.id, user.id, person.ownerId),
    prisma.personPhoto.findMany({
      where: { personId: person.id, userId: { in: [user.id, person.ownerId] } },
      select: { userId: true },
    }),
  ]);
  const hasOwnPhoto = photoRows.some((r) => r.userId === user.id);
  const ownerHasPhoto = photoRows.some((r) => r.userId === person.ownerId);

  // Only render fields that actually hold something — a detail page listing 20
  // empty rows is worse than one showing the six facts you recorded.
  // This contact plus everyone else in the same address book, so a gift can be
  // recorded in either direction from here.
  const giftPeople = [{ id: person.id, displayName: person.displayName }, ...others];

  const populated = defs
    .map((def) => ({ def, value: readFieldValue(person, def) }))
    .filter(({ def, value }) => formatFieldValue(def, value).length > 0 && def.key !== "notes");

  // Named in the transfer warning: only custom fields, and only ones with a value,
  // since those are what a new owner's registry may not be able to read.
  const populatedCustomNames = populated
    .filter(({ def }) => !def.core)
    .map(({ def }) => def.label);

  const notesDef = defs.find((d) => d.key === "notes");
  const notes = notesDef ? formatFieldValue(notesDef, person.notes) : "";

  return (
    <div>
      <PageHeader
        title={person.displayName}
        icon={
          <Avatar
            personId={person.id}
            name={person.displayName}
            photo={photo}
            size="md"
          />
        }
        description={
          [person.jobTitle, person.organization].filter(Boolean).join(" · ") ||
          undefined
        }
        action={
          <div className="flex items-center gap-2">
            {!isOwner ? (
              <Badge tone="amber">shared by {person.owner.email}</Badge>
            ) : null}
            {canEdit ? (
              <Link href={`/people/${person.id}/edit`} className={btnSecondary}>
                Edit
              </Link>
            ) : null}
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
                Nothing recorded yet.
                {canEdit ? (
                  <>
                    {" "}
                    <Link
                      href={`/people/${person.id}/edit`}
                      className="text-accent-700 hover:underline dark:text-accent-400"
                    >
                      Add some details
                    </Link>
                    .
                  </>
                ) : null}
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
              title={
                <span className="inline-flex items-center gap-1.5">
                  Relationships
                  <Hint label="How relationships work">
                    One row serves both people — it reads correctly from either side, so
                    adding “Parent of” here shows “Child of” on their page.
                  </Hint>
                </span>
              }
            />
            <div className="px-5 py-3">
              {relationships.length === 0 ? (
                <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
                  No relationships recorded.
                </p>
              ) : (
                <ul className="mb-3 divide-y divide-neutral-100 dark:divide-neutral-800/60">
                  {relationships.map((rel) => (
                    <li
                      key={rel.id}
                      className="flex flex-wrap items-start justify-between gap-2 py-1.5"
                    >
                      <span className="text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {rel.label}
                        </span>{" "}
                        <Link
                          href={`/people/${rel.other.id}`}
                          className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                        >
                          {rel.other.displayName}
                        </Link>
                        {rel.notes ? (
                          <span className="text-neutral-500 dark:text-neutral-400">
                            {" "}
                            — {rel.notes}
                          </span>
                        ) : null}
                        {(() => {
                          // An ended relationship reads "from X to Y" — which is how a
                          // former partner is expressed, rather than a separate type.
                          const period = relationshipPeriod(
                            rel.startedOn,
                            rel.endedOn,
                            formatDateOnly,
                          );
                          return period ? (
                            <span
                              className={`ml-2 text-xs ${
                                rel.endedOn
                                  ? "text-neutral-500 dark:text-neutral-400"
                                  : "text-neutral-400"
                              }`}
                            >
                              {period}
                            </span>
                          ) : null;
                        })()}
                      </span>
                      {canEdit ? (
                        <span className="flex shrink-0 items-center gap-3">
                          <RelationshipEditForm
                            action={updateRelationship}
                            relationshipId={rel.id}
                            subjectId={person.id}
                            subjectName={person.displayName}
                            otherName={rel.other.displayName}
                            types={types.map((t) => ({
                              id: t.id,
                              label: t.label,
                              inverseLabel: t.inverseLabel,
                              symmetric: t.symmetric,
                            }))}
                            current={{
                              typeId: rel.typeId,
                              outgoing: rel.outgoing,
                              startedOn: rel.startedOn ? dateOnlyToInput(rel.startedOn) : "",
                              endedOn: rel.endedOn ? dateOnlyToInput(rel.endedOn) : "",
                              notes: rel.notes ?? "",
                            }}
                          />
                          <DeleteForm
                            action={removeRelationship}
                            id={rel.id}
                            label="Remove"
                            pendingLabel="Removing…"
                            className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                            confirmMessage="Remove this relationship?"
                          />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {canEdit ? (
              <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800/60">
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
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Gifts"
              description="Both directions — what they gave, and what they were given."
            />
            {gifts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                Nothing recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {gifts.map((gift) => {
                  // One row read from either end: which of the two names to show is
                  // the only thing that differs, which is why there is no direction
                  // column to keep in step.
                  const theyGave = gift.giverId === person.id;
                  const other = theyGave ? gift.recipient : gift.giver;
                  const on = giftDate(gift);
                  return (
                    <li key={gift.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5">
                      <span className="min-w-0 text-sm">
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {theyGave ? "gave" : "received"}
                        </span>{" "}
                        {gift.description}{" "}
                        <span className="text-neutral-500 dark:text-neutral-400">
                          {theyGave ? "to" : "from"}
                        </span>{" "}
                        <Link
                          href={`/people/${other.id}`}
                          className="text-accent-700 hover:underline dark:text-accent-400"
                        >
                          {other.displayName}
                        </Link>
                        {gift.event ? (
                          <>
                            {" "}
                            <Link
                              href={`/events/${gift.event.id}`}
                              className="text-xs text-neutral-500 underline dark:text-neutral-400"
                            >
                              {gift.event.title}
                            </Link>
                          </>
                        ) : on ? (
                          <span className="ml-1 text-xs text-neutral-400">
                            {formatDateOnly(on)}
                          </span>
                        ) : null}
                        {gift.notes ? (
                          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                            {gift.notes}
                          </span>
                        ) : null}
                      </span>
                      {canEdit ? (
                        <span className="flex shrink-0 items-center gap-3">
                          <GiftEditForm
                            action={updateGift}
                            giftId={gift.id}
                            hasEvent={Boolean(gift.eventId)}
                            current={{
                              description: gift.description,
                              notes: gift.notes ?? "",
                              receivedOn: gift.receivedOn
                                ? dateOnlyToInput(gift.receivedOn)
                                : "",
                            }}
                          />
                          <DeleteForm
                            action={removeGift}
                            id={gift.id}
                            label="Remove"
                            pendingLabel="Removing…"
                            confirmMessage={`Remove "${gift.description}"?`}
                            className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                          />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
                <GiftForm
                  action={addGift}
                  givers={giftPeople}
                  recipients={giftPeople}
                  defaultGiverId={person.id}
                />
              </div>
            ) : null}
          </Card>

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
                      className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-400"
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
            <CardHeader title="Photo" />
            <div className="flex flex-wrap items-center gap-4 px-5 py-4">
              <Avatar
                personId={person.id}
                name={person.displayName}
                photo={photo}
                size="lg"
              />
              <div className="min-w-48 flex-1">
                <PhotoForm
                  action={setPersonPhoto}
                  clear={clearPersonPhoto}
                  personId={person.id}
                  hasOwn={hasOwnPhoto}
                  isOwner={isOwner}
                  ownerHasPhoto={ownerHasPhoto}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-1.5">
                  Labels
                  <Hint label="How labels work">
                    {isOwner
                      ? "Labels also appear as labels in Google Contacts, in your account and in the account of anyone you share this contact with."
                      : "These are the owner's labels. A shared contact carries one set, so it reads the same for everyone who can see it."}
                  </Hint>
                </span>
              }
            />
            <div className="space-y-3 px-5 py-4">
              {person.labels.length > 0 ? (
                <LabelChips labels={person.labels.map((pl) => pl.label)} linked />
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  No labels on this contact.
                </p>
              )}
              {canEdit ? (
              <PersonLabelsForm
                action={setPersonLabels}
                personId={person.id}
                labels={ownerLabels}
                selected={person.labels.map((pl) => pl.labelId)}
                ownerName={isOwner ? undefined : (person.owner.name ?? person.owner.email ?? "the owner")}
              />
              ) : null}
            </div>
          </Card>

          {isOwner ? (
            <Card>
              <CardHeader
                title="Sharing"
                description="Give someone else access to this contact."
              />
              <div className="space-y-3 px-5 py-3">
                {myShares.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
                    {myShares.map((sh) => (
                      <li
                        key={sh.id}
                        className="flex items-start justify-between gap-2 py-1.5"
                      >
                        <span className="min-w-0 break-words text-neutral-600 dark:text-neutral-400">
                          {sh.withUser.email}
                          <span className="text-neutral-400">
                            {" · "}
                            {sh.permission === "EDIT" ? "can edit" : "view only"}
                          </span>
                        </span>
                        {/* Revoking lives beside the person it affects. It used to be
                            only in Settings, which meant the page that told you who had
                            access was not the page where you could change it. */}
                        <DeleteForm
                          action={revokeShare}
                          id={sh.id}
                          label="Remove"
                          pendingLabel="Removing…"
                          className="shrink-0 text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                          confirmMessage={`Stop sharing ${person.displayName} with ${sh.withUser.email}? It will be removed from their Google Contacts on the next sync.`}
                        />
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
              <DetailRow compact label="Added">
                {formatInstant(person.createdAt, settings.timeZone)}
              </DetailRow>
              <DetailRow compact label="Updated">
                {formatInstant(person.updatedAt, settings.timeZone)}
              </DetailRow>
              <GoogleContactLink
                resourceName={mySync?.googleResourceName ?? null}
                addToGoogle={person.addToGoogle}
              />
              {mySync?.googleSyncedAt ? (
                <DetailRow compact label="Last synced">
                  {formatInstant(mySync.googleSyncedAt, settings.timeZone)}
                </DetailRow>
              ) : null}
              {mySync?.googleSyncError ? (
                <DetailRow compact label="Sync error">
                  <span className="text-rose-600 dark:text-rose-400">
                    {mySync.googleSyncError}
                  </span>
                </DetailRow>
              ) : null}
              {otherSyncs.length > 0 ? (
                <DetailRow compact label="Also in Google for">
                  {otherSyncs.map((g) => g.user.email).join(", ")}
                </DetailRow>
              ) : null}
              <DetailRow compact label="Owner">
                {isOwner ? "You" : (person.owner.name ?? person.owner.email)}
              </DetailRow>
            </dl>
            {isOwner ? (
              <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
                <TransferForm
                  action={transferOwnership}
                  personId={person.id}
                  personName={person.displayName}
                  users={shareableUsers}
                  labelCount={person.labels.length}
                  customFieldNames={populatedCustomNames}
                  sharedWithCount={myShares.length}
                />
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContactValue({ kind, value }: { kind: string; value: string }) {
  if (kind === "EMAIL") {
    return (
      <a href={`mailto:${value}`} className="text-accent-700 hover:underline dark:text-accent-400">
        {value}
      </a>
    );
  }
  if (kind === "PHONE") {
    return (
      <a href={`tel:${value}`} className="text-accent-700 hover:underline dark:text-accent-400">
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
        className="text-accent-700 hover:underline dark:text-accent-400"
      >
        {value}
      </a>
    );
  }
  return <>{value}</>;
}
