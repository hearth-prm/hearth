"use client";

import { useActionState, useState } from "react";
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
            defaultValue={defaultRecipientId ?? ""}
            required
          >
            <option value="">Who received it…</option>
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
 * Email one person their list.
 *
 * Disabled with a reason rather than hidden when it cannot work. A button that vanishes
 * when a permission is missing leaves nothing to explain why, and "nothing happened" is
 * the least useful failure a feature can have.
 */
export function ThankYouButton({
  action,
  recipientId,
  recipientName,
  eventId,
  canSend,
  hasEmail,
  giftCount,
}: {
  action: Action;
  recipientId: string;
  recipientName: string;
  eventId?: string;
  canSend: boolean;
  hasEmail: boolean;
  giftCount: number;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);

  // Ordered most specific first. A reason that is about THIS recipient is the one they
  // can act on from here; "reconnect Google" is true of every row at once and is
  // already stated in Settings, which is where it gets fixed.
  const blocked = !hasEmail
    ? `${recipientName} has no email address.`
    : giftCount === 0
      ? "Nothing recorded for them yet."
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
        Email {recipientName} their list
      </SubmitButton>
      {blocked ? <p className={helpClass}>{blocked}</p> : null}
    </form>
  );
}
