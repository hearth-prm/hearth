"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import {
  btnDanger,
  btnSecondary,
  FormMessage,
  inputClass,
  labelClass,
} from "@/components/ui";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The bar that appears once something is ticked.
 *
 * It lives INSIDE the form that wraps the table, so every ticked checkbox is submitted with
 * whichever button is pressed and no selection has to be mirrored into React state. The only
 * thing this component tracks is how many boxes are ticked — for the count, and to know
 * whether to show itself at all — which it reads from the form rather than owning.
 *
 * That is why the count is derived from a `change` listener on the form instead of from
 * controlled checkboxes: controlling two hundred inputs to display one number would make
 * every tick a re-render of the whole table.
 */
export function PeopleBulkBar({
  labelNames,
  total,
  shown,
  filterFields,
  labelAction,
  googleAction,
  trashAction,
}: {
  /** The viewer's own label names, offered as the things to add or remove. */
  labelNames: readonly string[];
  /** How many contacts match the current filter, which may exceed what is listed. */
  total: number;
  shown: number;
  /** The current filter, as hidden f.* fields, so "all matching" can be resolved server-side. */
  filterFields: readonly { name: string; value: string }[];
  labelAction: Action;
  googleAction: Action;
  trashAction: Action;
}) {
  const [count, setCount] = useState(0);
  // Which button was pressed travels in a hidden input, not on the button: React drops a
  // submitter's name/value for a function action, and the "add" half of every pair here
  // silently became its "remove" fallback.
  const mode = useRef<HTMLInputElement>(null);
  const google = useRef<HTMLInputElement>(null);
  const [allMatching, setAllMatching] = useState(false);
  const [open, setOpen] = useState<"labels" | null>(null);

  const [labelState, runLabels] = useActionState(labelAction, { ok: false });
  const [googleState, runGoogle] = useActionState(googleAction, { ok: false });
  const [trashState, runTrash] = useActionState(trashAction, { ok: false });
  const state = labelState.message
    ? labelState
    : googleState.message
      ? googleState
      : trashState;

  // Counted from the DOM, and recounted on every change anywhere in the form — which
  // includes the header's select-all, so one listener covers both.
  useEffect(() => {
    const form = document.getElementById("people-bulk") as HTMLFormElement | null;
    if (!form) return;
    const recount = () => {
      setCount(form.querySelectorAll<HTMLInputElement>('input[name="personId"]:checked').length);
    };
    recount();
    form.addEventListener("change", recount);
    return () => form.removeEventListener("change", recount);
  }, []);

  // After an action, the page revalidates and the rows re-render — but the checkboxes are
  // uncontrolled, so React keeps whatever was ticked. Clearing them here means a second
  // press cannot silently act on contacts that are no longer there.
  useEffect(() => {
    if (!state.message) return;
    const form = document.getElementById("people-bulk") as HTMLFormElement | null;
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
      .forEach((box) => { box.checked = false; });
    setCount(0);
    setAllMatching(false);
  }, [state.message]);

  const acting = allMatching ? total : count;
  if (count === 0 && !state.message) return null;

  return (
    <div className="sticky bottom-0 z-20 mt-3 rounded-xl border border-accent-200 bg-accent-50/95 p-3 shadow-lg backdrop-blur dark:border-accent-900 dark:bg-accent-950/90">
      {state.message ? (
        <div className="mb-2">
          <FormMessage ok={state.ok} message={state.message} />
        </div>
      ) : null}

      {count > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium">
              {acting} selected
            </span>

            {/* Only offered when the list is truncated, because otherwise it says the same
                thing as the header checkbox and invites a second guess about which won. */}
            {total > shown ? (
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  name="scope"
                  value="filtered"
                  checked={allMatching}
                  onChange={(e) => setAllMatching(e.target.checked)}
                  className="size-3.5 rounded border-neutral-300 dark:border-neutral-600"
                />
                all {total.toLocaleString()} matching this filter, not just the {shown} listed
              </label>
            ) : null}

            <span className="flex-1" />

            <button
              type="button"
              onClick={() => setOpen(open === "labels" ? null : "labels")}
              className={btnSecondary}
            >
              Labels
            </button>
            <SubmitButton
              className={btnSecondary}
              pendingLabel="Saving…"
              formAction={runGoogle}
              beforeSubmit={() => { if (google.current) google.current.value = "on"; }}
            >
              Add to Google
            </SubmitButton>
            <SubmitButton
              className={btnSecondary}
              pendingLabel="Saving…"
              formAction={runGoogle}
              beforeSubmit={() => { if (google.current) google.current.value = "off"; }}
            >
              Remove from Google
            </SubmitButton>
            <SubmitButton
              className={btnDanger}
              pendingLabel="Moving…"
              formAction={runTrash}
              confirm={`Move ${acting} contact${acting === 1 ? "" : "s"} to the trash? You can restore them from there.`}
            >
              Move to trash
            </SubmitButton>
          </div>

          {open === "labels" ? (
            <div className="mt-3 border-t border-accent-200 pt-3 dark:border-accent-900">
              <span className={labelClass}>Labels to add or remove</span>
              <div className="mt-1 flex flex-wrap items-end gap-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {labelNames.map((name) => (
                    <label key={name} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        name="labelName"
                        value={name}
                        className="size-3.5 rounded border-neutral-300 dark:border-neutral-600"
                      />
                      {name}
                    </label>
                  ))}
                </div>
                <input
                  name="newLabel"
                  placeholder="or a new one"
                  className={`${inputClass} w-40`}
                />
                <SubmitButton
                  className={btnSecondary}
                  pendingLabel="Adding…"
                  formAction={runLabels}
                  beforeSubmit={() => { if (mode.current) mode.current.value = "add"; }}
                >
                  Add
                </SubmitButton>
                <SubmitButton
                  className={btnSecondary}
                  pendingLabel="Removing…"
                  formAction={runLabels}
                  beforeSubmit={() => { if (mode.current) mode.current.value = "remove"; }}
                >
                  Remove
                </SubmitButton>
              </div>
              {/* A label is a Google group, so this is not only a Hearth change. Said here
                  rather than left to be noticed on a phone. */}
              <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                Labels reach Google Contacts too, on the next sync.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      <input ref={mode} type="hidden" name="mode" defaultValue="add" />
      <input ref={google} type="hidden" name="addToGoogle" defaultValue="on" />

      {/* The filter travels with the request so "all matching" can be rebuilt server-side
          rather than trusted as a list of ids from the browser. */}
      {filterFields.map((f, i) => (
        <input key={`${f.name}-${i}`} type="hidden" name={`f.${f.name}`} value={f.value} />
      ))}
    </div>
  );
}
