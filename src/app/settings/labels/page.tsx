import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import {
  createLabel,
  deleteLabel,
  setLabelParticipants,
  updateLabel,
} from "@/lib/actions/labels";
import { listOtherUsers } from "@/lib/users";
import { LabelSharingForm, type Participant } from "@/components/label-sharing-form";
import { Card, CardHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { LabelChip } from "@/components/label-chip";
import { CreateLabelForm, EditLabelForm } from "@/components/label-forms";

export default async function LabelsPage() {
  const user = await requireUser();

  const [labels, joined, others] = await Promise.all([
    prisma.label.findMany({
      where: { ownerId: user.id },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { people: true } },
        participants: { select: { withUserId: true, permission: true } },
      },
    }),
    // Sticky labels somebody else owns and has let this user in on. Read-only here: only the
    // owner changes who is in a label, or a participant could add somebody and expose the
    // owner's contacts to them.
    prisma.label.findMany({
      where: { participants: { some: { withUserId: user.id } } },
      orderBy: { name: "asc" },
      include: {
        owner: { select: { name: true, email: true } },
        participants: {
          select: { permission: true, withUser: { select: { name: true, email: true } } },
        },
      },
    }),
    listOtherUsers(user.id),
  ]);

  const nameFor = (u: { name: string | null; email: string | null }) => u.name || u.email || "somebody";

  /**
   * The rows the sharing editor shows: everybody else, plus you.
   *
   * You are on the list because a label you own shares BOTH ways — somebody else filing a
   * contact under it shares it with you, and that needs a permission of its own. Defaulted to
   * Edit on a label that shares nothing yet, since a shared filing cabinet whose owner cannot
   * edit what arrives is a strange thing to have built on purpose.
   */
  const participantRows = (label: (typeof labels)[number]): Participant[] => {
    const set = new Map(label.participants.map((p) => [p.withUserId, p.permission]));
    const rows: Participant[] = others.map((o) => ({
      userId: o.id,
      label: o.name || o.email,
      permission: set.get(o.id) ?? "NONE",
    }));
    rows.push({
      userId: user.id,
      label: `${user.name || user.email || "You"} (you)`,
      permission: set.get(user.id) ?? (label.participants.length === 0 ? "EDIT" : "NONE"),
    });
    return rows;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Your labels"
          description="Group contacts however you like — then filter by them, and see them as labels in Google Contacts."
        />

        {labels.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            No labels yet. Add one below, then apply it from any contact’s page.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {labels.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <LabelChip label={l} />
                  {l._count.people > 0 ? (
                    <Link
                      href={`/people?label=${encodeURIComponent(l.id)}`}
                      className="text-xs text-accent-700 hover:underline dark:text-accent-400"
                    >
                      {l._count.people} contact{l._count.people === 1 ? "" : "s"}
                    </Link>
                  ) : (
                    <span className="text-xs text-neutral-400">not used yet</span>
                  )}
                  {/* Derived from the rows rather than a flag on the label: a boolean saying
                      "sticky" with nobody in the set would be a state that does nothing, and
                      one saying "not sticky" with people in it would be a trap. */}
                  {l.participants.length > 0 ? (
                    <span className="rounded-full bg-accent-100 px-2 py-0.5 text-xs font-medium text-accent-800 dark:bg-accent-950 dark:text-accent-300">
                      shared with {l.participants.length}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
                  <EditLabelForm action={updateLabel} label={l} count={l._count.people} />
                  <DeleteForm
                    action={deleteLabel}
                    id={l.id}
                    label="Delete"
                    className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                    confirmMessage={
                      l._count.people > 0
                        ? `Delete the "${l.name}" label? It will be removed from ${l._count.people} contact${
                            l._count.people === 1 ? "" : "s"
                          }, and from their Google labels. The contacts themselves are kept.`
                        : `Delete the "${l.name}" label?`
                    }
                  />
                </div>

                <details className="w-full [&>summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer list-none text-xs text-accent-700 hover:underline dark:text-accent-400">
                    {l.participants.length > 0 ? "Sharing" : "Share this label"} ▾
                  </summary>
                  <div className="mt-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
                    <LabelSharingForm
                      labelId={l.id}
                      labelName={l.name}
                      contactCount={l._count.people}
                      participants={participantRows(l)}
                      action={setLabelParticipants}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-neutral-100 dark:border-neutral-800/60">
          <CreateLabelForm action={createLabel} />
        </div>
      </Card>

      {joined.length > 0 ? (
        <Card>
          <CardHeader
            title="Shared labels you are in"
            description="Somebody else owns these. File a contact of your own under one and it is shared with everyone in it — including the owner."
          />
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {joined.map((l) => (
              <li key={l.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <LabelChip label={l} />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {nameFor(l.owner)}’s label
                  </span>
                </div>
                {/* Who else is in it, because a participant is consenting to the whole set —
                    they can see it even though only the owner may change it. */}
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Shared with{" "}
                  {l.participants
                    .map((p) => `${nameFor(p.withUser)} (${p.permission.toLowerCase()})`)
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="How labels reach Google" />
        <div className="space-y-2 px-5 py-5 text-sm text-neutral-600 dark:text-neutral-400">
          <p>
            Each label becomes a label in Google Contacts, so the grouping you build
            here is the one you see on your phone.
          </p>
          <p>
            Google labels belong to an account rather than to a contact, so a label on
            a shared contact is created separately in each person’s Google — same
            name, different underlying group. Hearth only ever touches groups it
            created; labels you make by hand in Google are left alone.
          </p>
          <p>
            A contact shared with someone carries its <strong>owner’s</strong> labels, so it
            reads the same for everyone who can see it.
          </p>
          <p>
            A label you share is a shared filing cabinet: anyone in it can file their own
            contacts under it, and those contacts are shared with everyone else in it. Only
            the owner decides who is in a label.
          </p>
        </div>
      </Card>
    </div>
  );
}
