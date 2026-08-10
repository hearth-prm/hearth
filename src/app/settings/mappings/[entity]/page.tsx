import { notFound } from "next/navigation";
import type { FieldEntity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { loadRegistry } from "@/lib/fields/registry";
import {
  CORE_DESTINATIONS,
  coreFieldCanBeDisabled,
  NO_TARGET,
  targetsForType,
} from "@/lib/google/mapping-targets";
import { updateMappings } from "@/lib/actions/mappings";
import { MappingForm, type MappingRow } from "@/components/mapping-form";

const SLUGS: Record<string, FieldEntity> = { people: "PERSON", events: "EVENT" };

export default async function MappingsPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = SLUGS[slug];
  if (!entity) notFound();

  const user = await requireUser();
  const [registry, mappings] = await Promise.all([
    loadRegistry(user.id, entity, { includeArchived: true }),
    prisma.fieldMapping.findMany({ where: { ownerId: user.id, entity } }),
  ]);

  const byKey = new Map(mappings.map((m) => [m.fieldKey, m]));

  const rows: MappingRow[] = registry.map((def) => {
    const existing = byKey.get(def.key);
    return {
      fieldKey: def.key,
      label: def.label,
      type: def.type,
      core: def.core,
      archived: def.archived ?? false,
      coreDestination: CORE_DESTINATIONS[def.key] ?? def.label,
      choosable: def.core ? coreFieldCanBeDisabled(entity, def.key) : true,
      // A core field defaults to on; a custom field defaults to not synced.
      target: existing?.target ?? (def.core ? "core" : NO_TARGET),
      targetKey: existing?.targetKey ?? "",
      targets: def.core ? [] : targetsForType(entity, def.type),
    };
  });

  const noun = entity === "PERSON" ? "contact" : "event";

  return (
    <div className="space-y-6">
      <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
        What Hearth writes into Google for each {noun} field. Saving queues every
        {noun === "contact" ? " contact" : " event"} for a fresh push, because
        changing a destination changes what the Google copy should look like without
        touching any record.
      </p>
      <MappingForm
        action={updateMappings}
        entitySlug={slug}
        noun={noun}
        rows={rows}
      />
    </div>
  );
}
