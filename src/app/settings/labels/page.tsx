import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { createLabel, deleteLabel, updateLabel } from "@/lib/actions/labels";
import { Card, CardHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { LabelChip } from "@/components/label-chip";
import { CreateLabelForm, EditLabelForm } from "@/components/label-forms";

export default async function LabelsPage() {
  const user = await requireUser();

  const labels = await prisma.label.findMany({
    where: { ownerId: user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { people: true } } },
  });

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
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-neutral-100 dark:border-neutral-800/60">
          <CreateLabelForm action={createLabel} />
        </div>
      </Card>

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
            A contact shared with someone carries <strong>your</strong> labels, so it
            reads the same for everyone who can see it.
          </p>
        </div>
      </Card>
    </div>
  );
}
