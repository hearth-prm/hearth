"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, helpClass, inputClass, labelClass } from "@/components/ui";

/** Share every contact, or every event, with someone. */
export function ShareEverythingForm({
  action,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  return (
    <form action={formAction} className="space-y-4 px-5 py-5">
      <FormMessage ok={state.ok} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label htmlFor="share-scope" className={labelClass}>
            Share
          </label>
          <select id="share-scope" name="scope" className={`${inputClass} mt-1.5`}>
            <option value="ALL_PEOPLE">All my contacts</option>
            <option value="ALL_EVENTS">All my events</option>
          </select>
        </div>
        <div>
          <label htmlFor="share-email" className={labelClass}>
            With
          </label>
          <input
            id="share-email"
            name="email"
            type="email"
            required
            placeholder="them@example.com"
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <div>
          <label htmlFor="share-permission" className={labelClass}>
            They can
          </label>
          <select id="share-permission" name="permission" className={`${inputClass} mt-1.5`}>
            <option value="VIEW">View only</option>
            <option value="EDIT">View and edit</option>
          </select>
        </div>
      </div>
      <p className={helpClass}>
        Covers records you add later, too. Deleting always stays with you, whatever
        you grant. They must have signed in to Hearth at least once.
      </p>
      <SubmitButton>Share</SubmitButton>
    </form>
  );
}

/** Share a single contact or event from its own page. */
export function ShareRecordForm({
  action,
  personId,
  eventId,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  personId?: string;
  eventId?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  return (
    <form action={formAction} className="space-y-3">
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <FormMessage ok={state.ok} message={state.message} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className={labelClass}>Share with</label>
          <input
            name="email"
            type="email"
            required
            placeholder="them@example.com"
            className={`${inputClass} mt-1.5`}
          />
        </div>
        <div>
          <label className={labelClass}>They can</label>
          <select name="permission" className={`${inputClass} mt-1.5`}>
            <option value="VIEW">View</option>
            <option value="EDIT">View and edit</option>
          </select>
        </div>
        <SubmitButton className={btnSecondary} pendingLabel="Sharing…">
          Share
        </SubmitButton>
      </div>
    </form>
  );
}
