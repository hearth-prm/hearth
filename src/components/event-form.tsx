"use client";

import Link from "next/link";
import { useActionState } from "react";
import { fieldInputName, type FieldDef } from "@/lib/fields/types";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import type { PlaceSearchResult } from "@/lib/actions/places";
import { FieldInput } from "@/components/field-input";
import { LocationSearch } from "@/components/location-search";
import { ScheduleFields } from "@/components/schedule-fields";
import { AttendeePicker, type PickablePerson } from "@/components/attendee-picker";
import { SubmitButton } from "@/components/submit-button";
import { AddToGoogleToggle } from "@/components/add-to-google";
import { btnSecondary, Card, CardHeader, FormMessage } from "@/components/ui";

export function EventForm({
  action,
  defs,
  values,
  eventId,
  schedule,
  timeZones,
  people,
  selectedAttendeeIds,
  peopleTruncated,
  addToGoogle,
  synced,
  cancelHref,
  searchPlaces,
  submitLabel = "Save event",
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** Generic fields only — scheduling is rendered by ScheduleFields. */
  defs: FieldDef[];
  values: Record<string, unknown>;
  eventId?: string;
  schedule: {
    startAt: string;
    endAt: string;
    allDay: boolean;
    timeZone: string;
  };
  timeZones: string[];
  people: readonly PickablePerson[];
  selectedAttendeeIds: readonly string[];
  peopleTruncated?: boolean;
  addToGoogle: boolean;
  synced?: boolean;
  cancelHref: string;
  /** Place lookup for the location field; it stays a plain text box regardless. */
  searchPlaces: (query: string) => Promise<PlaceSearchResult>;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  const coreDefs = defs.filter((d) => d.core);
  const customDefs = defs.filter((d) => !d.core);

  return (
    <form action={formAction} className="space-y-6">
      {eventId ? <input type="hidden" name="id" value={eventId} /> : null}

      <FormMessage ok={state.ok} message={state.message} />

      <Card>
        <CardHeader title="Details" />
        <div className="space-y-5 px-5 py-5">
          {coreDefs.map((def) =>
            // Location gets a bespoke input so it can offer place suggestions. The
            // field name and validation are unchanged, so the registry still owns
            // parsing it — only the control differs.
            def.key === "location" ? (
              <LocationSearch
                key={def.key}
                name={fieldInputName(def.key)}
                defaultValue={String(values[def.key] ?? "")}
                search={searchPlaces}
                error={state.errors?.[def.key]}
              />
            ) : (
              <FieldInput
                key={def.key}
                def={def}
                value={values[def.key]}
                error={state.errors?.[def.key]}
                timeZone={schedule.timeZone}
              />
            ),
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="When" />
        <div className="px-5 py-5">
          <ScheduleFields
            startAt={schedule.startAt}
            endAt={schedule.endAt}
            allDay={schedule.allDay}
            timeZone={schedule.timeZone}
            timeZones={timeZones}
            errors={state.errors}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Who was there"
          description="Tick everyone who attended or is invited."
        />
        <div className="px-5 py-5">
          <AttendeePicker
            people={people}
            selectedIds={selectedAttendeeIds}
            truncated={peopleTruncated}
          />
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
                  timeZone={schedule.timeZone}
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
            kind="event"
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
