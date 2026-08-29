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
import { GiftsCard } from "@/components/gifts-card";
import { Disclosure } from "@/components/disclosure";
import { listGiftsForPerson } from "@/lib/gifts";
import { loadPersonVersions } from "@/lib/person-versions";
import { PersonHistoryCard } from "@/components/person-history-card";
import {
  addGift,
  removeGift,
  sendThankYouNote,
  updateGift,
} from "@/lib/actions/gifts";
import { canSendMail } from "@/lib/google/mail";
import { ShareRecordForm } from "@/components/share-forms";
import { LabelChips } from "@/components/label-chip";
import { Avatar } from "@/components/avatar";
import { PhotoForm } from "@/components/photo-form";
import { effectivePhotoFor } from "@/lib/photos-db";
import { clearPersonPhoto, setPersonPhoto } from "@/lib/actions/photos";
import { PersonLabelsForm } from "@/components/label-forms";
import { setPersonLabels } from "@/lib/actions/labels";
import { applicableLabelsWhere } from "@/lib/shares/sticky";
import { revokeShare, shareRecord } from "@/lib/actions/shares";
import { TransferForm } from "@/components/transfer-form";
import { transferOwnership } from "@/lib/actions/transfer";
import { listOtherUsers } from "@/lib/users";

/**
 * The structured detail on a contact point, as one readable line.
 *
 * Address parts are named rather than run together, because "Leeds · LS1 4AB" reads as a
 * place while "Leeds LS1 4AB" reads as a typo. Anything absent is simply absent.
 */
function contactDetail(cp: {
  kind: string;
  poBox: string | null;
  streetAddress: string | null;
  extendedAddress: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string | null;
  protocol: string | null;
  buildingId: string | null;
  floor: string | null;
  floorSection: string | null;
  deskCode: string | null;
  current: boolean | null;
  displayName: string | null;
}): string[] {
  if (cp.kind === "ADDRESS") {
    // The one-line value is already shown above, so this is only what it does not say.
    return [
      cp.streetAddress,
      cp.extendedAddress,
      cp.city,
      cp.region,
      cp.postalCode,
      cp.country ?? cp.countryCode,
      cp.poBox ? `PO box ${cp.poBox}` : null,
    ].filter((v): v is string => Boolean(v));
  }
  if (cp.kind === "IM") {
    return [cp.protocol].filter((v): v is string => Boolean(v));
  }
  if (cp.kind === "LOCATION") {
    return [
      cp.buildingId,
      cp.floor ? `floor ${cp.floor}` : null,
      cp.floorSection,
      cp.deskCode ? `desk ${cp.deskCode}` : null,
      cp.current ? "current" : null,
    ].filter((v): v is string => Boolean(v));
  }
  if (cp.kind === "EMAIL") {
    return [cp.displayName].filter((v): v is string => Boolean(v));
  }
  return [];
}

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
      googleEvents: { orderBy: { order: "asc" } },
      googleRelations: { orderBy: { order: "asc" } },
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
  const [
    defs,
    relationships,
    types,
    settings,
    others,
    myShares,
    ownerLabels,
    gifts,
    versions,
    mailAllowed,
  ] = await Promise.all([
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
            include: {
              withUser: { select: { email: true } },
              viaLabel: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      // The labels the OWNER may use, for the same reason as the registry: one shared contact
      // carries one set of labels, so an editing recipient picks from the owner's. With sticky
      // shares that means the owner's own labels plus any sticky label the owner participates
      // in — and keying it on the owner rather than the viewer is also what stops a recipient
      // filing somebody else's contact into a sharing circle of their own.
      prisma.label.findMany({
        where: applicableLabelsWhere(person.ownerId),
        orderBy: { name: "asc" },
        select: { id: true, name: true, color: true },
      }),
      // Gifts in both directions; the split into given and received happens below.
      listGiftsForPerson(user.id, person.id),
      // No access check of its own: a version says nothing the contact does not, and
      // this page has already established that the contact is readable.
      loadPersonVersions(person.id),
      canSendMail(user.id),
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

  /**
   * The sharing list, one row per person rather than one per Share row.
   *
   * Two rows for one recipient is the normal case now: a hand-made share and a rule-made one
   * coexist, because reconciliation never touches what a person granted. The access clauses
   * test shares with `some`, so the effective permission is simply the higher of the two and
   * there is no merge logic anywhere — but the UI has to do the grouping, or Karen appears
   * twice and only one of the two × buttons does what it looks like it does.
   */
  const sharesByPerson = [
    ...myShares
      .reduce((acc, sh) => {
        const row = acc.get(sh.withUserId) ?? {
          withUserId: sh.withUserId,
          email: sh.withUser.email ?? "somebody",
          permission: "VIEW" as "VIEW" | "EDIT",
          /** The hand-made row, if there is one. Only that one is removable. */
          manualId: null as string | null,
          viaLabels: [] as string[],
        };
        if (sh.permission === "EDIT") row.permission = "EDIT";
        if (sh.viaLabel) row.viaLabels.push(sh.viaLabel.name);
        else row.manualId = sh.id;
        acc.set(sh.withUserId, row);
        return acc;
      }, new Map<string, { withUserId: string; email: string; permission: "VIEW" | "EDIT"; manualId: string | null; viaLabels: string[] }>())
      .values(),
  ].sort((a, b) => a.email.localeCompare(b.email));
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
            {/* Deleting stays with the owner even under an EDIT share. It says "move to
                trash" because that is what it does — the record waits there until somebody
                empties it by hand, and naming it Delete would undersell how recoverable
                this is while overselling how final it is. */}
            {isOwner ? (
              <DeleteForm
                action={deletePerson}
                id={person.id}
                label="Move to trash"
                pendingLabel="Moving…"
                className={btnDanger}
                confirmMessage={`Move ${person.displayName} to the trash? You can restore it later. ${
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
                    {/* The detail beside a value: the parts of an address, the network a
                        chat handle is on, where a location is. Shown only when there is
                        something to show, so an ordinary email gains no clutter. */}
                    {contactDetail(cp).length > 0 ? (
                      <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                        {contactDetail(cp).join(" · ")}
                      </span>
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
              <div className="border-t border-neutral-100 pt-2 dark:border-neutral-800/60">
                <Disclosure title="Add relationship">
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
                </Disclosure>
              </div>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <GiftsCard
            gifts={gifts}
            personId={person.id}
            people={giftPeople}
            canEdit={canEdit}
            addAction={addGift}
            updateAction={updateGift}
            removeAction={removeGift}
            sendAction={sendThankYouNote}
            canSend={mailAllowed}
          />

          {person.googleEvents.length > 0 ? (
            <Card>
              <CardHeader
                title="Dates"
                description="Anniversaries and other dates Google keeps."
              />
              <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {person.googleEvents.map((e) => (
                  <DetailRow key={e.id} label={e.label ?? "Date"}>
                    {/* A missing year is shown as missing rather than filled in with
                        this one, which would invent a fact. */}
                    {e.year
                      ? formatDateOnly(new Date(Date.UTC(e.year, e.month - 1, e.day)))
                      : `${e.day}/${e.month}`}
                  </DetailRow>
                ))}
              </dl>
            </Card>
          ) : null}

          {person.googleRelations.length > 0 ? (
            <Card>
              <CardHeader
                title="Named in Google"
                description="People named on this contact in Google, as text rather than as links."
              />
              <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {person.googleRelations.map((r) => (
                  <DetailRow key={r.id} label={r.label ?? "Relation"}>
                    {r.name}
                  </DetailRow>
                ))}
              </dl>
              <p className="border-t border-neutral-100 px-5 py-3 text-xs text-neutral-500 dark:border-neutral-800/60 dark:text-neutral-400">
                Separate from the relationships above, which link two contacts that both
                exist here. These are names Google holds as text — the person may not be
                in your address book at all.
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Events" description="Where they showed up." />
            {person.eventAttendances.length === 0 ? (
              <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                Not linked to any events yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {person.eventAttendances.map((a) => (
                  <li key={a.id} className="px-5 py-2 text-sm">
                    <Link
                      href={`/events/${a.event.id}`}
                      className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                    >
                      {a.event.title}
                    </Link>{" "}
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatInstant(a.event.startAt, a.event.timeZone, {
                        withTime: !a.event.allDay,
                      })}
                    </span>
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
                {sharesByPerson.length > 0 ? (
                  <ul className="divide-y divide-neutral-100 text-xs dark:divide-neutral-800/60">
                    {sharesByPerson.map((group) => (
                      <li
                        key={group.withUserId}
                        className="flex items-start justify-between gap-2 py-1.5"
                      >
                        <span className="min-w-0 break-words text-neutral-600 dark:text-neutral-400">
                          {group.email}
                          <span className="text-neutral-400">
                            {" · "}
                            {group.permission === "EDIT" ? "can edit" : "view only"}
                            {/* Where it came from. Otherwise the first thing anyone does with
                                a share they did not grant is revoke it and watch it come back
                                on the next label change. */}
                            {group.viaLabels.length > 0
                              ? ` · via ${group.viaLabels.join(", ")}`
                              : null}
                          </span>
                        </span>
                        {/* Revoking lives beside the person it affects. It used to be
                            only in Settings, which meant the page that told you who had
                            access was not the page where you could change it.
                            Only the hand-made row is removable: a rule-made one comes
                            straight back, so offering to remove it would be a lie. */}
                        {group.manualId ? (
                          <DeleteForm
                            action={revokeShare}
                            id={group.manualId}
                            label="Remove"
                            pendingLabel="Removing…"
                            className="shrink-0 text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                            confirmMessage={
                              group.viaLabels.length > 0
                                ? `Remove the direct share of ${person.displayName} with ${group.email}? They keep access through ${group.viaLabels.join(", ")}.`
                                : `Stop sharing ${person.displayName} with ${group.email}? It will be removed from their Google Contacts on the next sync.`
                            }
                          />
                        ) : (
                          <span
                            className="shrink-0 text-xs text-neutral-400"
                            title="Withdraw it by taking the contact out of the label, or by changing who the label shares with."
                          >
                            from a label
                          </span>
                        )}
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

          <PersonHistoryCard versions={versions} timeZone={settings.timeZone} />

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
                compact
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
