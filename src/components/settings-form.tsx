"use client";

import { useActionState, useEffect, useState } from "react";
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

export interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
}

export interface SettingsValues {
  syncContactsEnabled: boolean;
  syncSharedContacts: boolean;
  allowManagerThankYous: boolean;
  sendInvites: boolean;
  syncCalendarEnabled: boolean;
  defaultAddToGoogle: boolean;
  inviteAttendees: boolean;
  importRsvps: boolean;
  googleCalendarId: string;
  placesProvider: string;
  timeZone: string;
}

export function SettingsForm({
  action,
  values,
  timeZones,
  calendars,
  activePlacesProvider,
  googlePlacesConfigured,
  canSyncContacts,
  canSyncCalendar,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  values: SettingsValues;
  timeZones: string[];
  /** Null when Google could not be asked; the field falls back to free text. */
  calendars: CalendarOption[] | null;
  activePlacesProvider: string;
  googlePlacesConfigured: boolean;
  canSyncContacts: boolean;
  canSyncCalendar: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  // Controlled, so the "use what the browser reports" button can set it — and because React 19
  // resets a form after its action settles, which on an uncontrolled select would snap the
  // choice back to the old value after a save that worked. The mappings page paid for that
  // lesson once already.
  const [timeZone, setTimeZone] = useState(values.timeZone);

  // Re-mount the selection after the action settles.
  //
  // React 19 resets a form once its action returns, and for a CONTROLLED select that reset
  // lands on the DOM with no re-render to correct it — so a saved zone showed the first option
  // in the list while both the state and the database said otherwise.
  //
  // An effect calling setTimeZone(values.timeZone) is NOT enough, which is the sharp edge
  // worth writing down: the saved value normally equals what the state already holds, React
  // bails out of a state set with an equal value, no render happens, and the DOM keeps the
  // reset. A counter changes every time by construction, and using it as the select's key
  // forces a remount, which re-applies `value` whatever it is.
  //
  // Third time this trap has been paid for here — see the mappings select and the thank-you
  // textarea. Each one needed a different fix, and this is why.
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    setGeneration((n) => n + 1);
    setTimeZone(values.timeZone);
  }, [state, values.timeZone]);

  // Read in an effect rather than during render: the server has no browser to ask, so
  // rendering it directly would produce different markup on the two sides and React would
  // discard the client's. Empty until hydration, which is exactly when the button appears.
  const [browserZone, setBrowserZone] = useState("");
  useEffect(() => {
    try {
      setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    } catch {
      // A browser that will not say is no reason to break the page.
      setBrowserZone("");
    }
  }, []);

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
            name="syncSharedContacts"
            label="Also push contacts shared with me"
            help={
              canSyncContacts
                ? "Contacts other people share with you land in your Google Contacts too, so one Hearth record means one entry in every address book. Turning this off removes the ones already there — you keep them in Hearth, they just stop being copied to Google."
                : "Reconnect your Google account to grant contacts permission first."
            }
            defaultChecked={values.syncSharedContacts}
            disabled={!canSyncContacts}
          />
          <Toggle
            name="defaultAddToGoogle"
            label="Tick “Add to Google” by default on new contacts"
            help="Events are never ticked by default — sending one to your calendar is always a deliberate choice."
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

          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 dark:border-amber-900 dark:bg-amber-950/30">
            <Toggle
              name="sendInvites"
              label="Let Google email the guests"
              help="Needed for guests to be able to RSVP at all — a guest who is never emailed can never reply. Safe to leave on, because an event only reaches Google when you tick “Send to Google Calendar” on it, and notifications stay suppressed for events that have already finished."
              defaultChecked={values.sendInvites}
            />
          </div>

          <div>
            <label htmlFor="googleCalendarId" className={labelClass}>
              Target calendar
            </label>
            {calendars && calendars.length > 0 ? (
              <>
                <select
                  id="googleCalendarId"
                  name="googleCalendarId"
                  defaultValue={values.googleCalendarId}
                  className={`${inputClass} mt-1.5`}
                >
                  {/* Keep whatever is configured selectable even if it is not in
                      the list, so saving cannot silently move every event. */}
                  {calendars.some(
                    (c) => c.id === values.googleCalendarId,
                  ) ? null : (
                    <option value={values.googleCalendarId}>
                      {values.googleCalendarId} (current)
                    </option>
                  )}
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.summary}
                      {c.primary ? " (primary)" : ""}
                    </option>
                  ))}
                </select>
                <p className={helpClass}>
                  Only calendars you can write to are listed. Changing this
                  moves existing events: the old copy is deleted and recreated.
                </p>
              </>
            ) : (
              <>
                <input
                  id="googleCalendarId"
                  name="googleCalendarId"
                  defaultValue={values.googleCalendarId}
                  className={`${inputClass} mt-1.5`}
                />
                <p className={helpClass}>
                  Calendar id, or <code>primary</code> for your default
                  calendar. Connect Google with calendar permission to pick from
                  a list.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Place search"
          description="Backs the location field when creating or editing an event."
        />
        <div className="space-y-4 px-5 py-5">
          <div>
            <label htmlFor="placesProvider" className={labelClass}>
              Provider
            </label>
            <select
              id="placesProvider"
              name="placesProvider"
              defaultValue={values.placesProvider}
              className={`${inputClass} mt-1.5`}
            >
              <option value="auto">Automatic</option>
              <option value="osm">OpenStreetMap</option>
              <option value="google" disabled={!googlePlacesConfigured}>
                Google Places{googlePlacesConfigured ? "" : " (no API key set)"}
              </option>
              <option value="off">Off — plain text only</option>
            </select>
            <p className={helpClass}>
              Currently using: <strong>{activePlacesProvider}</strong>.
              OpenStreetMap needs nothing at all. Google Places gives better
              suggestions for small venues but needs{" "}
              <code>GOOGLE_PLACES_API_KEY</code> in your <code>.env</code> and
              billing enabled on the Google Cloud project — the key stays
              server-side and is never sent to the browser.
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
            key={generation}
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className={`${inputClass} mt-1.5`}
          >
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
          <p className={helpClass}>
            Every new event starts in this zone, and each one can still be
            changed as you create it.
          </p>
          {/*
            Offered rather than imposed, and only when it would change something.

            The stored default is UTC, because a server has no business guessing — but the
            person reading this page is in a browser that knows the answer, and expecting them
            to recognise their own IANA name is how a setting goes unset for months and every
            event gets its zone corrected by hand instead.
          */}
          {browserZone && browserZone !== timeZone ? (
            <button
              type="button"
              onClick={() => setTimeZone(browserZone)}
              className="mt-1.5 text-xs text-accent-700 underline hover:text-accent-800 dark:text-accent-400"
            >
              Use {browserZone}, which is what this browser reports
            </button>
          ) : null}
          {state.errors?.timeZone ? (
            <p className={errorClass}>{state.errors.timeZone}</p>
          ) : null}
        </div>
        <div className="border-t border-neutral-100 px-5 py-5 dark:border-neutral-800/60">
          <Toggle
            name="allowManagerThankYous"
            label="Let a thank-you manager write my thank-yous"
            help="A thank-you is signed by whoever sends it, so nobody can take this on your behalf — it is yours to give. Useful for a child whose notes a parent writes. Who the managers are is set by whoever runs this Hearth, in HEARTH_THANK_YOU_MANAGERS."
            defaultChecked={values.allowManagerThankYous}
          />
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
          className="mt-0.5 size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 disabled:opacity-50 dark:border-neutral-600"
        />
        <span>
          <span className={labelClass}>{label}</span>
          {help ? <span className={`${helpClass} block`}>{help}</span> : null}
        </span>
      </label>
    </div>
  );
}
