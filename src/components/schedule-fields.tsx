"use client";

import { useState } from "react";
import { fieldInputName } from "@/lib/fields/types";
import { errorClass, inputClass, labelClass } from "@/components/ui";

const DEFAULT_LENGTH_MS = 60 * 60 * 1000;

/**
 * Read and write the naive "YYYY-MM-DDTHH:mm" the inputs use.
 *
 * Arithmetic is done in UTC deliberately. These strings are wall-clock times in the
 * event's own zone, not the browser's, so letting the local Date constructor interpret
 * them would apply the reader's DST rules to somebody else's timezone and shift an
 * event by an hour twice a year.
 */
function parseNaive(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
}

function formatNaive(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16);
}

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

  /**
   * Moving the start carries the end along with it.
   *
   * The length of the event is preserved rather than reset, which is what Google
   * Calendar does: a fresh event has no length yet, so it gets an hour — the case
   * this was asked for — while an event somebody has already made three hours long
   * stays three hours long when its day changes. Resetting to an hour every time
   * would quietly undo a deliberate choice.
   */
  function changeStart(raw: string) {
    const next = isAllDay && raw ? `${raw.slice(0, 10)}T00:00` : raw;
    const nextStart = parseNaive(next);
    setStart(next);
    if (nextStart === null) return;

    const previousStart = parseNaive(start);
    const previousEnd = parseNaive(end);
    const length =
      previousStart !== null && previousEnd !== null && previousEnd > previousStart
        ? previousEnd - previousStart
        : DEFAULT_LENGTH_MS;
    setEnd(formatNaive(nextStart + length));
  }

  return (
    <div className="space-y-5">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name={fieldInputName("allDay")}
          checked={isAllDay}
          onChange={(e) => setIsAllDay(e.target.checked)}
          className="size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 dark:border-neutral-600"
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
            onChange={(e) => changeStart(e.target.value)}
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
