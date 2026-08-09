"use client";

import { useActionState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import {
  Card,
  CardHeader,
  errorClass,
  FormMessage,
  helpClass,
  inputClass,
  labelClass,
} from "@/components/ui";

export interface SettingsValues {
  syncContactsEnabled: boolean;
  syncCustomFields: boolean;
  syncCalendarEnabled: boolean;
  defaultAddToGoogle: boolean;
  inviteAttendees: boolean;
  importRsvps: boolean;
  googleCalendarId: string;
  timeZone: string;
}

export function SettingsForm({
  action,
  values,
  timeZones,
  canSyncContacts,
  canSyncCalendar,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  values: SettingsValues;
  timeZones: string[];
  canSyncContacts: boolean;
  canSyncCalendar: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-6">
      <FormMessage ok={state.ok} message={state.message} />

      <Card>
        <CardHeader
          title="Contact sync"
          description="One way only: Hearth writes to Google Contacts and never reads changes back."
        />
        <div className="space-y-4 px-5 py-5">
          <Toggle
            name="syncContactsEnabled"
            label="Push contacts to Google"
            help={
              canSyncContacts
                ? "Contacts with “Add to Google” ticked are created and kept up to date in your Google Contacts."
                : "Reconnect your Google account to grant contacts permission first."
            }
            defaultChecked={values.syncContactsEnabled}
            disabled={!canSyncContacts}
          />
          <Toggle
            name="syncCustomFields"
            label="Also push your custom fields"
            help="Sent as Google's own custom fields, labelled as you named them. Off by default, because exporting everything you record should be deliberate."
            defaultChecked={values.syncCustomFields}
            disabled={!canSyncContacts}
          />
          <Toggle
            name="defaultAddToGoogle"
            label="Tick “Add to Google” by default on new records"
            defaultChecked={values.defaultAddToGoogle}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Calendar sync"
          description="Events you create in Hearth can appear on your Google Calendar."
        />
        <div className="space-y-4 px-5 py-5">
          <Toggle
            name="syncCalendarEnabled"
            label="Push events to Google Calendar"
            help={
              canSyncCalendar
                ? undefined
                : "Reconnect your Google account to grant calendar permission first."
            }
            defaultChecked={values.syncCalendarEnabled}
            disabled={!canSyncCalendar}
          />
          <Toggle
            name="inviteAttendees"
            label="Invite Hearth attendees as Google Calendar guests"
            help="Uses each person's primary email. People without an email are skipped."
            defaultChecked={values.inviteAttendees}
          />
          <Toggle
            name="importRsvps"
            label="Update Hearth RSVPs from Google replies"
            help="The one place Google writes back into Hearth: guest responses update the attendee's RSVP."
            defaultChecked={values.importRsvps}
          />

          <div>
            <label htmlFor="googleCalendarId" className={labelClass}>
              Target calendar
            </label>
            <input
              id="googleCalendarId"
              name="googleCalendarId"
              defaultValue={values.googleCalendarId}
              className={`${inputClass} mt-1.5`}
            />
            <p className={helpClass}>
              Calendar id, or <code>primary</code> for your default calendar.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Preferences" />
        <div className="px-5 py-5">
          <label htmlFor="timeZone" className={labelClass}>
            Default time zone for new events
          </label>
          <select
            id="timeZone"
            name="timeZone"
            defaultValue={values.timeZone}
            className={`${inputClass} mt-1.5`}
          >
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          {state.errors?.timeZone ? (
            <p className={errorClass}>{state.errors.timeZone}</p>
          ) : null}
        </div>
      </Card>

      <SubmitButton>Save settings</SubmitButton>
    </form>
  );
}

function Toggle({
  name,
  label,
  help,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  help?: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name={name}
          defaultChecked={defaultChecked}
          disabled={disabled}
          className="mt-0.5 size-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 disabled:opacity-50 dark:border-neutral-600"
        />
        <span>
          <span className={labelClass}>{label}</span>
          {help ? <span className={`${helpClass} block`}>{help}</span> : null}
        </span>
      </label>
    </div>
  );
}
