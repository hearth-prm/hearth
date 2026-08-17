"use client";

import { useActionState } from "react";
import type { GoogleImportState } from "@/lib/actions/google-import";
import type { PlannedContact } from "@/lib/google/import-plan";
import { SubmitButton } from "@/components/submit-button";
import {
  Badge,
  btnPrimary,
  btnSecondary,
  Card,
  CardHeader,
  FormMessage,
  helpClass,
  inputClass,
  labelClass,
} from "@/components/ui";

const EMPTY: GoogleImportState = { ok: false };

/**
 * Two steps: look, then confirm — the same shape as the CSV import.
 *
 * The preview is the point of the feature rather than a courtesy. Importing links Hearth
 * to contacts that already exist, and the first sync afterwards makes Hearth
 * authoritative for the field groups it manages — so this screen has to say, per contact,
 * what will be kept as a custom field and what will change shape. Finding that out
 * afterwards would mean finding it out from your real address book.
 */
export function GoogleImportForm({
  preview,
  apply,
}: {
  preview: (state: GoogleImportState, form: FormData) => Promise<GoogleImportState>;
  apply: (state: GoogleImportState, form: FormData) => Promise<GoogleImportState>;
}) {
  const [previewState, previewAction] = useActionState(preview, EMPTY);
  const [applyState, applyAction] = useActionState(apply, EMPTY);

  // Once contacts are in, the old preview describes work already done.
  const done = typeof applyState.imported === "number";
  const plan = done ? undefined : previewState.plan;
  const importable = plan?.contacts.filter((c) => c.action === "import") ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Choose what to look at"
          description="Nothing is written until you confirm. Your Google contacts are not changed by the import itself."
        />
        <form action={previewAction} className="space-y-3 px-5 py-5">
          <FormMessage ok={previewState.ok} message={previewState.message} />
          <div>
            <label htmlFor="groupFilter" className={labelClass}>
              Google label
            </label>
            <select
              id="groupFilter"
              name="groupFilter"
              className={`${inputClass} mt-1.5`}
              defaultValue=""
            >
              <option value="">Everyone in my Google Contacts</option>
              {(previewState.groups ?? []).map((g) => (
                <option key={g.resourceName} value={g.resourceName}>
                  {g.name} ({g.count})
                </option>
              ))}
            </select>
            <p className={helpClass}>
              The list of labels fills in after the first look, since it comes from
              Google along with the contacts.
            </p>
          </div>
          <SubmitButton className={btnSecondary} pendingLabel="Reading Google…">
            Look at my contacts
          </SubmitButton>
        </form>
      </Card>

      {applyState.message ? (
        <Card>
          <div className="px-5 py-5">
            <FormMessage ok={applyState.ok} message={applyState.message} />
          </div>
        </Card>
      ) : null}

      {plan ? (
        <>
          <Card>
            <CardHeader
              title="What will happen"
              description={`${plan.contacts.length} contact${plan.contacts.length === 1 ? "" : "s"} read from Google.`}
            />
            <div className="flex flex-wrap gap-4 px-5 py-4 text-sm">
              <Stat label="Can be imported" value={plan.counts.import} tone="accent" />
              <Stat label="Already linked" value={plan.counts.linked} tone="slate" />
              <Stat label="Kept as custom fields" value={plan.counts.rescued} tone="amber" />
            </div>

            {plan.newFieldKeys.length > 0 ? (
              <p className="border-t border-neutral-100 px-5 py-3 text-sm dark:border-neutral-800/60">
                <strong className="font-medium">Custom fields this will create: </strong>
                {plan.newFieldKeys.join(", ")}.{" "}
                <span className="text-neutral-500 dark:text-neutral-400">
                  Each is mapped straight back to a Google custom field, so the value
                  returns there on the next sync.
                </span>
              </p>
            ) : null}

            <p className="border-t border-neutral-100 px-5 py-3 text-sm text-amber-700 dark:border-neutral-800/60 dark:text-amber-400">
              <strong className="font-medium">After importing, Hearth becomes the
              source of truth</strong>{" "}
              for names, nicknames, organisations, birthdays, notes, emails, phones,
              addresses, urls and custom fields. Editing those in Google afterwards is
              undone by the next sync. Everything else on the contact — relations, custom
              dates, chat handles, and anything else Hearth does not manage — is never
              touched.
            </p>
          </Card>

          <form action={applyAction}>
            {/* Carried through so the confirm re-reads exactly the selection that was
                reviewed, rather than whatever the picker happens to say by then. */}
            <input
              type="hidden"
              name="groupFilter"
              value={previewState.groupFilter ?? ""}
            />
            <Card>
              <CardHeader
                title="Pick the contacts"
                description="Ticked contacts are imported. Ones already linked to Hearth cannot be ticked."
              />
              <div className="max-h-[36rem] divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800/60">
                {plan.contacts.map((contact) => (
                  <ContactRow key={contact.resourceName} contact={contact} />
                ))}
              </div>
              <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
                <SubmitButton className={btnPrimary} pendingLabel="Importing…">
                  Import ticked contacts
                </SubmitButton>
                <p className={`${helpClass} mt-2`}>
                  {importable.length} of {plan.contacts.length} can be imported.
                </p>
              </div>
            </Card>
          </form>
        </>
      ) : null}
    </div>
  );
}

function ContactRow({ contact }: { contact: PlannedContact }) {
  const linked = contact.action === "linked";

  return (
    <label className="flex cursor-pointer items-start gap-3 px-5 py-3">
      <input
        type="checkbox"
        name="resourceName"
        value={contact.resourceName}
        defaultChecked={!linked}
        disabled={linked}
        className="mt-0.5 size-4 shrink-0 rounded border-neutral-300 disabled:opacity-40 dark:border-neutral-600"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{contact.displayName}</span>
          {linked ? <Badge tone="slate">already in Hearth</Badge> : null}
          {contact.rescued.length > 0 ? (
            <Badge tone="amber">
              {contact.rescued.length} kept as custom field
              {contact.rescued.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </span>

        {contact.rescued.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {contact.rescued.map((r) => (
              <li key={r.key} className="text-xs text-neutral-600 dark:text-neutral-400">
                <strong className="font-medium">{r.label}:</strong> {r.value}{" "}
                <span className="text-neutral-500 dark:text-neutral-500">— {r.reason}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {contact.reasons
          .filter((reason) => !reason.includes("kept as custom fields"))
          .map((reason, i) => (
            <p key={i} className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {reason}
            </p>
          ))}
      </span>
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "slate" | "amber";
}) {
  const tones = {
    accent: "text-accent-700 dark:text-accent-400",
    slate: "text-slate-700 dark:text-slate-300",
    amber: "text-amber-700 dark:text-amber-400",
  };
  return (
    <div>
      <p className={`text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}
