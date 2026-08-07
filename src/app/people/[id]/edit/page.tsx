import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import { readFieldValue } from "@/lib/fields/values";
import { updatePerson } from "@/lib/actions/people";
import { PageHeader } from "@/components/ui";
import { PersonForm } from "@/components/person-form";

export default async function EditPersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const person = await prisma.person.findFirst({
    where: { id, ...readablePeopleWhere(user.id) },
    include: { contactPoints: { orderBy: [{ kind: "asc" }, { order: "asc" }] } },
  });
  if (!person) notFound();

  const defs = await loadRegistry(user.id, "PERSON");
  const values = Object.fromEntries(
    defs.map((def) => [def.key, readFieldValue(person, def)]),
  );

  return (
    <div>
      <PageHeader title={`Edit ${person.displayName}`} />
      <PersonForm
        action={updatePerson}
        defs={defs}
        values={values}
        personId={person.id}
        contactPoints={person.contactPoints.map((c) => ({
          kind: c.kind,
          label: c.label ?? "",
          value: c.value,
        }))}
        addToGoogle={person.addToGoogle}
        synced={Boolean(person.googleResourceName)}
        cancelHref={`/people/${person.id}`}
      />
    </div>
  );
}
