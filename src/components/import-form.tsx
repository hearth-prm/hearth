"use client";

import { useActionState } from "react";
import type { ImportState } from "@/lib/actions/import";
import type { PlannedRow } from "@/lib/contacts-import";
import { SubmitButton } from "@/components/submit-button";
import {
  Badge,
  btnPrimary,
  btnSecondary,
  Card,
  CardHeader,
  FormMessage,
  helpClass,
  labelClass,
} from "@/components/ui";

const EMPTY: ImportState = { ok: false };

/**
 * Two-step import: preview, then confirm.
 *
 * The file is read once and carried through in a hidden field, so confirming applies
 * the file that was reviewed. Asking for the file again after the preview is the
 * fastest way to have someone apply a different one than they read.
 */
export function ImportForm({
  preview,
  apply,
}: {
  preview: (state: ImportState, form: FormData) => Promise<ImportState>;
  apply: (state: ImportState, form: FormData) => Promise<ImportState>;
}) {
  const [previewState, previewAction] = useActionState(preview, EMPTY);
  const [applyState, applyAction] = useActionState(apply, EMPTY);

  // Once an import has been applied, the old preview describes work already done.
  const done = Boolean(applyState.applied);
  const plan = done ? undefined : previewState.plan;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Choose a file"
          description="A CSV in the same shape Hearth exports. Nothing is written until you confirm."
        />
        <form action={previewAction} className="space-y-3 px-5 py-5">
          <FormMessage ok={previewState.ok} message={previewState.message} />
          <div>
            <label htmlFor="file" className={labelClass}>
              CSV file
            </label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-neutral-200 dark:file:bg-neutral-800 dark:hover:file:bg-neutral-700"
            />
            <p className={helpClass}>
              Export your contacts first to get a template with the right columns —
              including your own custom fields.
            </p>
          </div>
          <SubmitButton className={btnSecondary} pendingLabel="Reading…">
            Preview import
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
              description={`${plan.rows.length} row${plan.rows.length === 1 ? "" : "s"} read from the file.`}
            />
            <div className="flex flex-wrap gap-4 px-5 py-4 text-sm">
              <Stat label="New contacts" value={plan.counts.create} tone="accent" />
              <Stat label="Updated" value={plan.counts.update} tone="slate" />
              <Stat label="Skipped" value={plan.counts.skip} tone="neutral" />
              <Stat label="With warnings" value={plan.counts.warnings} tone="amber" />
            </div>

            {plan.newLabels.length > 0 ? (
              <p className="border-t border-neutral-100 px-5 py-3 text-sm dark:border-neutral-800/60">
                <strong className="font-medium">New labels: </strong>
                {plan.newLabels.join(", ")}
              </p>
            ) : null}

            {plan.unknownHeaders.length > 0 ? (
              <p className="border-t border-neutral-100 px-5 py-3 text-sm text-amber-700 dark:border-neutral-800/60 dark:text-amber-400">
                <strong className="font-medium">Columns Hearth does not recognise, and will ignore: </strong>
                {plan.unknownHeaders.join(", ")}
              </p>
            ) : null}

            {plan.unknownShareEmails.length > 0 ? (
              <p className="border-t border-neutral-100 px-5 py-3 text-sm text-amber-700 dark:border-neutral-800/60 dark:text-amber-400">
                <strong className="font-medium">Not users of this Hearth, so cannot be shared with: </strong>
                {plan.unknownShareEmails.join(", ")}
              </p>
            ) : null}

            <form action={applyAction} className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
              <input type="hidden" name="csv" value={previewState.csv ?? ""} />
              <p className={`${helpClass} mb-3`}>
                Importing never removes a share or deletes a contact. Labels listed in
                the file replace the ones on each contact it names.
              </p>
              <SubmitButton className={btnPrimary} pendingLabel="Importing…">
                Import {plan.counts.create + plan.counts.update} row
                {plan.counts.create + plan.counts.update === 1 ? "" : "s"}
              </SubmitButton>
            </form>
          </Card>

          <Card>
            <CardHeader title="Row by row" />
            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-neutral-900">
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                    <th scope="col" className="px-5 py-2 font-medium">Row</th>
                    <th scope="col" className="px-5 py-2 font-medium">Action</th>
                    <th scope="col" className="px-5 py-2 font-medium">Contact</th>
                    <th scope="col" className="px-5 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <RowLine key={row.line} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "slate" | "amber" | "neutral";
}) {
  const tones = {
    accent: "text-accent-700 dark:text-accent-400",
    slate: "text-slate-700 dark:text-slate-300",
    amber: "text-amber-700 dark:text-amber-400",
    neutral: "text-neutral-500 dark:text-neutral-400",
  };
  return (
    <div>
      <p className={`text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}

function RowLine({ row }: { row: PlannedRow }) {
  return (
    <tr className="border-b border-neutral-100 align-top last:border-0 dark:border-neutral-800/60">
      <td className="px-5 py-2 text-xs text-neutral-400">{row.line}</td>
      <td className="px-5 py-2">
        {row.action === "create" ? (
          <Badge tone="accent">new</Badge>
        ) : row.action === "update" ? (
          <Badge tone="slate">update</Badge>
        ) : (
          <Badge tone="neutral">skip</Badge>
        )}
      </td>
      <td className="px-5 py-2">{row.displayName || <span className="text-neutral-400">—</span>}</td>
      <td className="px-5 py-2 text-xs">
        {row.changes.length > 0 ? (
          <p className="text-neutral-600 dark:text-neutral-400">{row.changes.join(" · ")}</p>
        ) : null}
        {row.warnings.map((w, i) => (
          <p key={i} className="text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
      </td>
    </tr>
  );
}
