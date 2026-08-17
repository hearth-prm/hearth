"use client";

import { useActionState, useState, useTransition } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import {
  btnPrimary,
  btnSecondary,
  FormMessage,
  helpClass,
  inputClass,
  labelClass,
} from "@/components/ui";

export interface PickablePerson {
  id: string;
  displayName: string;
}

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Whether the thank-you has been written, and whether we nagged about it.
 *
 * Two separate facts shown side by side: Hearth knows it sent a reminder, and only the
 * person can say whether they actually wrote the note. The checkbox is the only way the
 * second one can ever become true.
 */
export function GiftStatus({
  giftId,
  reminderSent,
  thanked,
  onToggle,
  canEdit,
}: {
  giftId: string;
  reminderSent: boolean;
  thanked: boolean;
  onToggle: (giftId: string, thanked: boolean) => Promise<void>;
  canEdit: boolean;
}) {
  const [checked, setChecked] = useState(thanked);
  const [saving, startSaving] = useTransition();

  return (
    <span className="ml-1 inline-flex items-center gap-2 align-middle">
      {reminderSent ? (
        <span className="text-xs text-amber-700 dark:text-amber-400">reminder sent</span>
      ) : null}
      {checked ? (
        <span className="text-xs text-emerald-700 dark:text-emerald-400">thanked</span>
      ) : null}
      {canEdit ? (
        <label
          className="inline-flex items-center gap-1 text-xs text-neutral-400"
          title="Tick once the thank-you has been written. Reminders skip these."
        >
          <input
            type="checkbox"
            aria-label="Thanked"
            checked={checked}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.checked;
              // Optimistic: the tick is the feedback, and waiting for a round trip to
              // move a checkbox reads as the click not having registered.
              setChecked(next);
              startSaving(async () => {
                await onToggle(giftId, next).catch(() => setChecked(!next));
              });
            }}
            className="size-3.5 rounded border-neutral-300 dark:border-neutral-600"
          />
          thanked
        </label>
      ) : null}
    </span>
  );
}

/**
 * Record a gift.
 *
 * Giver and recipient are both plain selects, matching how a relationship picks its
 * other end. The recipient list is narrower than the giver list on an event page —
 * you can only record a gift for someone you may edit — so the two are passed
 * separately rather than filtered here from one.
 */
export function GiftForm({
  action,
  eventId,
  givers,
  recipients,
  defaultGiverId,
  defaultRecipientId,
}: {
  action: Action;
  /** Set on an event page; a one-off gift has none and gets a date field instead. */
  eventId?: string;
  givers: readonly PickablePerson[];
  recipients: readonly PickablePerson[];
  /**
   * Prefilled sides, not fixed ones.
   *
   * On a contact page the giver defaults to whoever's page it is, because the reason
   * to record a gift there is usually that they gave you something. Both selects stay
   * editable, though: an earlier version pinned the recipient to the page's contact,
   * which made the one case the feature exists for — a present to say thank you FOR —
   * the one case it could not record.
   */
  defaultGiverId?: string;
  defaultRecipientId?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);

  // With one candidate there is no choice to make, so do not ask for one. At an event
  // with a single gift recipient this is the difference between two clicks per present
  // and one, and the answer would have been the same every time.
  const soleRecipient = recipients.length === 1 ? recipients[0]!.id : undefined;
  const recipientValue = defaultRecipientId ?? soleRecipient ?? "";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        Record a gift
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage ok={state.ok} message={state.message} />
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="gift-giver" className={labelClass}>
            From
          </label>
          <select
            id="gift-giver"
            name="giverId"
            className={`${inputClass} mt-1.5`}
            defaultValue={defaultGiverId ?? ""}
            required
          >
            <option value="">Who gave it…</option>
            {givers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gift-recipient" className={labelClass}>
            To
          </label>
          <select
            id="gift-recipient"
            name="recipientId"
            className={`${inputClass} mt-1.5`}
            defaultValue={recipientValue}
            required
          >
            {/* Only offered when there is in fact something to choose between. */}
            {soleRecipient ? null : <option value="">Who received it…</option>}
            {recipients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="gift-description" className={labelClass}>
          Gift
        </label>
        <input
          id="gift-description"
          name="description"
          className={`${inputClass} mt-1.5`}
          placeholder="A blue scarf"
          required
        />
      </div>

      <div>
        <label htmlFor="gift-notes" className={labelClass}>
          Note
        </label>
        <textarea
          id="gift-notes"
          name="notes"
          rows={2}
          className={`${inputClass} mt-1.5`}
          placeholder="Hand-knitted — mention the colour"
        />
        <p className={helpClass}>
          Anything worth saying in the thank-you. It travels with the gift into the
          emailed list.
        </p>
      </div>

      {eventId ? null : (
        <div>
          <label htmlFor="gift-date" className={labelClass}>
            When
          </label>
          <input
            id="gift-date"
            name="receivedOn"
            type="date"
            className={`${inputClass} mt-1.5`}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton className={btnPrimary} pendingLabel="Saving…">
          Save gift
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Change what a gift was, its note, or when it arrived. */
export function GiftEditForm({
  action,
  giftId,
  current,
  hasEvent,
}: {
  action: Action;
  giftId: string;
  current: { description: string; notes: string; receivedOn: string };
  /** An event gift takes its date from the event, so it offers no date field. */
  hasEvent: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
      >
        Edit
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 w-full space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      <input type="hidden" name="giftId" value={giftId} />
      <input
        name="description"
        defaultValue={current.description}
        aria-label="Gift"
        className={inputClass}
        required
      />
      <textarea
        name="notes"
        rows={2}
        defaultValue={current.notes}
        aria-label="Note"
        placeholder="Note"
        className={inputClass}
      />
      {hasEvent ? null : (
        <input
          name="receivedOn"
          type="date"
          defaultValue={current.receivedOn}
          aria-label="When"
          className={inputClass}
        />
      )}
      <div className="flex items-center gap-2">
        <SubmitButton className={btnSecondary} pendingLabel="Saving…">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline dark:text-neutral-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Name somebody the gifts at this event are for. */
export function GiftRecipientForm({
  action,
  eventId,
  people,
}: {
  action: Action;
  eventId: string;
  people: readonly PickablePerson[];
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="space-y-2">
      <FormMessage ok={state.ok} message={state.message} />
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label htmlFor="gift-for" className={labelClass}>
            Gifts are for
          </label>
          <select id="gift-for" name="personId" className={`${inputClass} mt-1.5`} required>
            <option value="">Choose someone…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className={btnSecondary} pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Remind one person what they still owe thanks for.
 *
 * Disabled with a reason rather than hidden when it cannot work: a button that vanishes
 * when a permission is missing leaves nothing to explain why, and "nothing happened" is
 * the least useful failure a feature can have.
 *
 * The exception is having nothing outstanding, which is not a failure at all. The caller
 * omits the button entirely then, since there is nothing to fix and nothing to say.
 */
export function ThankYouButton({
  action,
  recipientId,
  recipientName,
  eventId,
  canSend,
  hasEmail,
}: {
  action: Action;
  recipientId: string;
  recipientName: string;
  eventId?: string;
  canSend: boolean;
  hasEmail: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  // Ordered most specific first. A reason that is about THIS recipient is the one they
  // can act on from here; "reconnect Google" is true of every row at once and is
  // already stated in Settings, which is where it gets fixed.
  //
  // "Nothing outstanding" is not among them: that is not a failure to explain but a
  // reason for the button not to exist, so the caller leaves it out entirely.
  const blocked = !hasEmail
    ? `${recipientName} has no email address.`
    : !canSend
      ? "Reconnect Google in Settings to allow Hearth to send mail."
      : null;

  return (
    <form action={formAction} className="space-y-1.5">
      <FormMessage ok={state.ok} message={state.message} />
      <input type="hidden" name="recipientId" value={recipientId} />
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <SubmitButton
        className={btnSecondary}
        pendingLabel="Sending…"
        disabled={Boolean(blocked)}
      >
        Send thank you reminders
      </SubmitButton>
      {blocked ? <p className={helpClass}>{blocked}</p> : null}
    </form>
  );
}
