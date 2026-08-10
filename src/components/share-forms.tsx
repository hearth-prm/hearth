"use client";

import { useActionState } from "react";
import type { ShareableUser } from "@/lib/users";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { btnSecondary, FormMessage, helpClass, inputClass, labelClass } from "@/components/ui";

/**
 * Who to share with: a picker over the install's users, not a typed address.
 *
 * Sharing can only ever target someone who has already signed in, so asking for an
 * email address invited typos and non-existent recipients to describe a set that was
 * always enumerable. Multi-select because granting the same thing to two people is
 * one intention, not two visits to the form.
 *
 * Ticking grants or updates access; unticking does NOT revoke. Revocation is an
 * explicit control elsewhere, and a form that silently withdrew access for anyone
 * left unchecked would make an easy mistake destructive.
 */
function UserPicker({
  users,
  alreadyShared,
  idPrefix,
}: {
  users: readonly ShareableUser[];
  /** User ids that already have access, so the list can say so. */
  alreadyShared: ReadonlySet<string>;
  idPrefix: string;
}) {
  if (users.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Nobody else has signed in to this Hearth yet. Once they do, they will appear
        here.
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label="People to share with"
      className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700"
    >
      {users.map((u) => (
        <label
          key={u.id}
          htmlFor={`${idPrefix}-${u.id}`}
          className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <input
            id={`${idPrefix}-${u.id}`}
            type="checkbox"
            name="userId"
            value={u.id}
            className="size-4 rounded border-neutral-300 text-teal-600 focus:ring-teal-500 dark:border-neutral-600"
          />
          <span>
            {u.name ? `${u.name} · ` : ""}
            {u.email}
          </span>
          {alreadyShared.has(u.id) ? (
            <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-400">
              already has access
            </span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

/** Share every contact, or every event, with one or more people. */
export function ShareEverythingForm({
  action,
  users,
  alreadySharedPeople,
  alreadySharedEvents,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  users: readonly ShareableUser[];
  alreadySharedPeople: readonly string[];
  alreadySharedEvents: readonly string[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  // Both blanket scopes are on one form, so the hint covers whichever is selected.
  const already = new Set([...alreadySharedPeople, ...alreadySharedEvents]);

  return (
    <form action={formAction} className="space-y-4 px-5 py-5">
      <FormMessage ok={state.ok} message={state.message} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="share-scope" className={labelClass}>
            Share
          </label>
          <select id="share-scope" name="scope" className={`${inputClass} mt-1.5`}>
            <option value="ALL_PEOPLE">All my contacts</option>
            <option value="ALL_EVENTS">All my events</option>
          </select>
        </div>
        <div>
          <label htmlFor="share-permission" className={labelClass}>
            They can
          </label>
          <select
            id="share-permission"
            name="permission"
            className={`${inputClass} mt-1.5`}
          >
            <option value="VIEW">View only</option>
            <option value="EDIT">View and edit</option>
          </select>
        </div>
      </div>

      <div>
        <span className={labelClass}>With</span>
        <div className="mt-1.5">
          <UserPicker users={users} alreadyShared={already} idPrefix="share-all" />
        </div>
      </div>

      <p className={helpClass}>
        Covers records you add later, too. Contacts land in their Google Contacts as
        well as yours, and an edit by any of you updates every copy. Deleting always
        stays with you. Unticking someone here does not revoke access — use Revoke
        below.
      </p>

      <SubmitButton>Share</SubmitButton>
    </form>
  );
}

/** Share a single contact or event from its own page. */
export function ShareRecordForm({
  action,
  users,
  alreadyShared,
  personId,
  eventId,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  users: readonly ShareableUser[];
  alreadyShared: readonly string[];
  personId?: string;
  eventId?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-3">
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <FormMessage ok={state.ok} message={state.message} />

      <div>
        <span className={labelClass}>Share with</span>
        <div className="mt-1.5">
          <UserPicker
            users={users}
            alreadyShared={new Set(alreadyShared)}
            idPrefix={`share-${personId ?? eventId ?? "record"}`}
          />
        </div>
      </div>

      {users.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
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
      ) : null}
    </form>
  );
}
