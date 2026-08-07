import { notFound } from "next/navigation";
import type { FieldEntity } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { coreFields } from "@/lib/fields/core";
import { FIELD_TYPE_LABELS } from "@/lib/fields/types";
import {
  createFieldDefinition,
  deleteFieldDefinition,
  setFieldArchived,
  updateFieldDefinition,
} from "@/lib/actions/fields";
import { Badge, Card, CardHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary } from "@/components/ui";
import { FieldCreateForm, FieldEditForm } from "@/components/field-admin";

const SLUGS: Record<string, FieldEntity> = {
  people: "PERSON",
  events: "EVENT",
};

export default async function FieldSettingsPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity: slug } = await params;
  const entity = SLUGS[slug];
  if (!entity) notFound();

  const user = await requireUser();
  const custom = await prisma.fieldDefinition.findMany({
    where: { ownerId: user.id, entity },
    orderBy: [{ archived: "asc" }, { order: "asc" }, { label: "asc" }],
  });

  const noun = entity === "PERSON" ? "contact" : "event";
  const active = custom.filter((f) => !f.archived);
  const archived = custom.filter((f) => f.archived);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={`Built-in ${noun} fields`}
          description="Real database columns. They can be reordered in code but not deleted here."
        />
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {coreFields(entity).map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div>
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  <code>{f.key}</code>
                  {f.required ? " · required" : ""}
                  {f.generic ? "" : " · custom editor"}
                </p>
              </div>
              <Badge tone="slate">{FIELD_TYPE_LABELS[f.type]}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title={`Your ${noun} fields`}
          description={
            active.length === 0
              ? "None yet."
              : `${active.length} field${active.length === 1 ? "" : "s"}, stored as JSON alongside each ${noun}.`
          }
        />
        {active.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            Add a field below and it will appear on every {noun} form
            immediately.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {active.map((field) => (
              <li key={field.id} className="px-5 py-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{field.label}</p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      <code>{field.key}</code> · {FIELD_TYPE_LABELS[field.type]}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <form action={setFieldArchived}>
                      <input type="hidden" name="id" value={field.id} />
                      <input type="hidden" name="archived" value="on" />
                      <SubmitButton
                        className={`${btnSecondary} py-1.5 text-xs`}
                        pendingLabel="Archiving…"
                      >
                        Archive
                      </SubmitButton>
                    </form>
                    <DeleteForm
                      action={deleteFieldDefinition}
                      id={field.id}
                      label="Delete"
                      className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                      confirmMessage={`Delete "${field.label}" and erase its value from every ${noun}? Archive it instead if you might want the data back.`}
                    />
                  </div>
                </div>
                <FieldEditForm
                  action={updateFieldDefinition}
                  field={{
                    id: field.id,
                    key: field.key,
                    label: field.label,
                    type: field.type,
                    options: field.options,
                    helpText: field.helpText,
                    required: field.required,
                    showInList: field.showInList,
                    order: field.order,
                    archived: field.archived,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {archived.length > 0 ? (
        <Card>
          <CardHeader
            title="Archived fields"
            description="Hidden from forms, but their stored values are untouched and return if you restore them."
          />
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {archived.map((field) => (
              <li
                key={field.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              >
                <div>
                  <p className="text-sm font-medium">{field.label}</p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    <code>{field.key}</code> · {FIELD_TYPE_LABELS[field.type]}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <form action={setFieldArchived}>
                    <input type="hidden" name="id" value={field.id} />
                    <SubmitButton
                      className={`${btnSecondary} py-1.5 text-xs`}
                      pendingLabel="Restoring…"
                    >
                      Restore
                    </SubmitButton>
                  </form>
                  <DeleteForm
                    action={deleteFieldDefinition}
                    id={field.id}
                    label="Delete"
                    className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                    confirmMessage={`Permanently delete "${field.label}" and erase its value from every ${noun}?`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <FieldCreateForm action={createFieldDefinition} entity={entity} />

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Mapping these fields onto Google {entity === "PERSON" ? "Contacts" : "Calendar"}{" "}
        fields arrives with the sync milestone — every field listed on this page
        will be selectable there.
      </p>
    </div>
  );
}
