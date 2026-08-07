"use client";

import { useState } from "react";
import { fieldInputName } from "@/lib/fields/types";
import { errorClass, inputClass, labelClass } from "@/components/ui";

/**
 * The event "when" block: start, end, all-day and timezone together.
 *
 * These four are interdependent, which is why they are excluded from the
 * generic field loop (FieldDef.generic === false). Toggling all-day swaps the
 * control between <input type="date"> and <input type="datetime-local">, so the
 * value is held in state as a full "YYYY-MM-DDTHH:mm" string and sliced for
 * display — otherwise switching modes would feed a date-only value to a
 * datetime input and the browser would silently discard it.
 */
export function ScheduleFields({
  startAt,
  endAt,
  allDay,
  timeZone,
  timeZones,
  errors,
}: {
  startAt: string;
  endAt: string;
  allDay: boolean;
  timeZone: string;
  timeZones: string[];
  errors?: Record<string, string>;
}) {
  const [isAllDay, setIsAllDay] = useState(allDay);
  const [start, setStart] = useState(startAt);
  const [end, setEnd] = useState(endAt);

  const startDisplay = isAllDay ? start.slice(0, 10) : start.slice(0, 16);
  const endDisplay = isAllDay ? end.slice(0, 10) : end.slice(0, 16);

  function handleChange(setter: (v: string) => void) {
    return (raw: string) => {
      // Re-pad a date-only value so the full instant survives a mode switch.
      setter(isAllDay && raw ? `${raw.slice(0, 10)}T00:00` : raw);
    };
  }

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name={fieldInputName("allDay")}
          checked={isAllDay}
          onChange={(e) => setIsAllDay(e.target.checked)}
          className="size-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
        />
        <span className={labelClass}>All day</span>
      </label>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="field-startAt" className={labelClass}>
            Starts
            <span aria-hidden className="ml-0.5 text-rose-500">
              *
            </span>
          </label>
          <input
            id="field-startAt"
            name={fieldInputName("startAt")}
            type={isAllDay ? "date" : "datetime-local"}
            required
            value={startDisplay}
            onChange={(e) => handleChange(setStart)(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          {errors?.startAt ? <p className={errorClass}>{errors.startAt}</p> : null}
        </div>

        <div>
          <label htmlFor="field-endAt" className={labelClass}>
            Ends
          </label>
          <input
            id="field-endAt"
            name={fieldInputName("endAt")}
            type={isAllDay ? "date" : "datetime-local"}
            value={endDisplay}
            onChange={(e) => handleChange(setEnd)(e.target.value)}
            className={`${inputClass} mt-1.5`}
          />
          {errors?.endAt ? <p className={errorClass}>{errors.endAt}</p> : null}
        </div>
      </div>

      <div>
        <label htmlFor="field-timeZone" className={labelClass}>
          Time zone
        </label>
        <select
          id="field-timeZone"
          name={fieldInputName("timeZone")}
          defaultValue={timeZone}
          className={`${inputClass} mt-1.5`}
        >
          {timeZones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Times above are wall-clock times in this zone. Hearth stores the
          absolute instant, so the event stays correct across DST.
        </p>
        {errors?.timeZone ? <p className={errorClass}>{errors.timeZone}</p> : null}
      </div>
    </div>
  );
}
