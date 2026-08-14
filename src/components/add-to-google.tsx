import { labelClass } from "@/components/ui";

/**
 * The Google opt-in.
 *
 * Contacts default to ticked: a PRM contact is a person you want in your address
 * book. Events default to unticked, because most of what Hearth records is history
 * — who was at a gathering — and history does not belong on a calendar. Sending an
 * event to Google is therefore a deliberate per-event decision, which is also what
 * makes it safe for guest notifications to default on.
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
          className="mt-0.5 size-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-500 dark:border-neutral-600"
        />
        <span>
          <span className={labelClass}>
            {kind === "contact"
              ? "Add to Google Contacts"
              : "Send to Google Calendar"}
          </span>
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
            {synced
              ? `Unchecking this will remove the ${kind} from Google on the next sync.`
              : kind === "event"
                ? "Leave this off for gatherings you are recording after the fact — they stay in Hearth only, and nobody is emailed. Tick it for something you actually want on your calendar, and guests with an email address will be invited."
                : "Hearth stays the source of truth — it pushes this contact to Google and never reads changes back."}
          </span>
        </span>
      </label>
    </div>
  );
}
