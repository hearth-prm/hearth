import { labelClass } from "@/components/ui";

/**
 * The "Add to Google" opt-in, checked by default.
 *
 * The hidden `addToGooglePresent` marker distinguishes "the user unchecked this"
 * from "the form never rendered the control" — an unchecked checkbox submits
 * nothing at all, so without the marker a create action could not tell whether
 * to fall back to the account default.
 */
export function AddToGoogleToggle({
  defaultChecked,
  kind,
  synced,
}: {
  defaultChecked: boolean;
  kind: "contact" | "event";
  /** True when a Google copy currently exists. */
  synced?: boolean;
}) {
  return (
    <div>
      <input type="hidden" name="addToGooglePresent" value="1" />
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="addToGoogle"
          defaultChecked={defaultChecked}
          className="mt-0.5 size-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
        />
        <span>
          <span className={labelClass}>
            Add to Google {kind === "contact" ? "Contacts" : "Calendar"}
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
            {synced
              ? `Unchecking this will remove the ${kind} from Google on the next sync.`
              : `Hearth stays the source of truth — it pushes this ${kind} to Google and never reads changes back.`}
          </span>
        </span>
      </label>
    </div>
  );
}
