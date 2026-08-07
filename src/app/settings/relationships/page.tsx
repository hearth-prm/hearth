import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { loadRelationshipTypes } from "@/lib/relationships";
import {
  createRelationshipType,
  deleteRelationshipType,
} from "@/lib/actions/relationships";
import { Badge, Card, CardHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { RelationshipTypeForm } from "@/components/relationship-type-form";

export default async function RelationshipTypesPage() {
  const user = await requireUser();
  const types = await loadRelationshipTypes(user.id);

  // Count usage so the UI can explain why a type is not deletable, rather than
  // letting the Restrict foreign key surface as an error.
  const counts = await prisma.relationship.groupBy({
    by: ["typeId"],
    where: { ownerId: user.id },
    _count: { _all: true },
  });
  const usage = new Map(counts.map((c) => [c.typeId, c._count._all]));

  const system = types.filter((t) => t.ownerId === null);
  const mine = types.filter((t) => t.ownerId !== null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Your relationship types"
          description={mine.length === 0 ? "None yet." : undefined}
        />
        {mine.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            The built-in types below cover most cases. Add your own if you need
            something more specific.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {mine.map((t) => {
              const used = usage.get(t.id) ?? 0;
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {t.symmetric
                        ? "Reads the same both ways"
                        : `Reverse: ${t.inverseLabel}`}
                      {used > 0 ? ` · used ${used} time${used === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  {used > 0 ? (
                    <span className="text-xs text-neutral-400">
                      In use — remove those links first
                    </span>
                  ) : (
                    <DeleteForm
                      action={deleteRelationshipType}
                      id={t.id}
                      label="Delete"
                      className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                      confirmMessage={`Delete the "${t.label}" relationship type?`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-neutral-100 dark:border-neutral-800/60">
          <RelationshipTypeForm action={createRelationshipType} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Built-in types"
          description="Available to everyone on this install."
        />
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {system.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
            >
              <div>
                <p className="text-sm font-medium">{t.label}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t.symmetric ? "Reads the same both ways" : `Reverse: ${t.inverseLabel}`}
                </p>
              </div>
              {t.symmetric ? (
                <Badge tone="slate">symmetric</Badge>
              ) : (
                <Badge tone="neutral">directional</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
