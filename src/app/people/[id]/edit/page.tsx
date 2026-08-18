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
    include: {
      contactPoints: { orderBy: [{ kind: "asc" }, { order: "asc" }] },
      googleSyncs: { where: { userId: user.id }, select: { googleResourceName: true } },
    },
  });
  if (!person) notFound();

  // The owner's registry: for a shared contact the custom values are keyed by their
  // field definitions, not the editor's.
  const defs = await loadRegistry(person.ownerId, "PERSON");
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
          // Carried into the form so a save puts them back. Without this an edit to
          // somebody's phone number would flatten their address on the next sync,
          // because the form is the whole of what gets written.
          detail: {
            poBox: c.poBox ?? "",
            streetAddress: c.streetAddress ?? "",
            extendedAddress: c.extendedAddress ?? "",
            city: c.city ?? "",
            region: c.region ?? "",
            postalCode: c.postalCode ?? "",
            country: c.country ?? "",
            countryCode: c.countryCode ?? "",
            displayName: c.displayName ?? "",
          },
        }))}
        addToGoogle={person.addToGoogle}
        synced={Boolean(person.googleSyncs[0]?.googleResourceName)}
        cancelHref={`/people/${person.id}`}
      />
    </div>
  );
}
