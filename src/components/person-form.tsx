"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FieldDef } from "@/lib/fields/types";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { FieldInput } from "@/components/field-input";
import {
  ContactPointsEditor,
  type ContactPointRow,
} from "@/components/contact-points-editor";
import { SubmitButton } from "@/components/submit-button";
import { AddToGoogleToggle } from "@/components/add-to-google";
import { btnSecondary, Card, CardHeader, FormMessage } from "@/components/ui";

export function PersonForm({
  action,
  defs,
  values,
  contactPoints,
  personId,
  addToGoogle,
  synced,
  cancelHref,
  submitLabel = "Save contact",
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  defs: FieldDef[];
  values: Record<string, unknown>;
  contactPoints: ContactPointRow[];
  personId?: string;
  addToGoogle: boolean;
  synced?: boolean;
  cancelHref: string;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  const coreDefs = defs.filter((d) => d.core);
  const customDefs = defs.filter((d) => !d.core);

  return (
    <form action={formAction} className="space-y-6">
      {personId ? <input type="hidden" name="id" value={personId} /> : null}

      <FormMessage ok={state.ok} message={state.message} />

      <Card>
        <CardHeader title="Details" />
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
          {coreDefs.map((def) => (
            <div
              key={def.key}
              className={def.type === "LONGTEXT" ? "sm:col-span-2" : undefined}
            >
              <FieldInput
                def={def}
                value={values[def.key]}
                error={state.errors?.[def.key]}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Contact details"
          description="Emails, phone numbers, addresses and links."
        />
        <div className="px-5 py-5">
          <ContactPointsEditor initial={contactPoints} />
        </div>
      </Card>

      {customDefs.length > 0 ? (
        <Card>
          <CardHeader
            title="Your fields"
            description="Fields you added in Settings → Custom fields."
          />
          <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
            {customDefs.map((def) => (
              <div
                key={def.key}
                className={
                  def.type === "LONGTEXT" || def.type === "MULTISELECT"
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <FieldInput
                  def={def}
                  value={values[def.key]}
                  error={state.errors?.[def.key]}
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Google" />
        <div className="px-5 py-5">
          <AddToGoogleToggle
            defaultChecked={addToGoogle}
            kind="contact"
            synced={synced}
          />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className={btnSecondary}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
