"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
 * Write a thank-you for one gift, and send it to whoever gave it.
 *
 * A native <dialog>, opened with showModal(): it traps focus, closes on Escape, and
 * renders above everything without a z-index argument — all of which a div pretending
 * to be a modal has to reimplement, usually incompletely.
 *
 * Once sent there is nothing left to do, so the control is replaced by a plain mark
 * rather than staying available. Hearth did the sending, so it knows this for certain,
 * which is why nothing here has to be ticked by hand.
 */
export function ThankYouControl({
  action,
  giftId,
  recipientId,
  giftDescription,
  giverName,
  giverEmail,
  thanked,
  thankYouNote,
  canSend,
  yours,
}: {
  action: Action;
  giftId: string;
  /** Whose thanks these are. A shared present earns one note per recipient. */
  recipientId: string;
  giftDescription: string;
  giverName: string;
  giverEmail: string | null;
  thanked: boolean;
  thankYouNote: string | null;
  canSend: boolean;
  /**
   * Whether this gift was given to the person reading.
   *
   * The note is sent from their address and signed by nobody else, so offering it on a
   * gift somebody else received would mean writing a stranger a thank-you as the wrong
   * person. Being able to edit a contact is not licence to speak as them.
   */
  yours: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const dialog = useRef<HTMLDialogElement>(null);
  // Controlled, and that is not a style choice: React resets an uncontrolled form once
  // its action settles, failure included — so a send Google refused would throw away
  // the note and leave an empty box. Holding the text here means a retry starts from
  // what was written rather than from nothing.
  const [message, setMessage] = useState("");

  // Close once the send has reported success. Watching state rather than the click
  // means the dialog stays open, with the message still in it, if the send failed.
  useEffect(() => {
    if (state.ok) {
      dialog.current?.close();
      setMessage("");
    }
  }, [state.ok]);

  if (thanked) {
    return (
      <span
        className="ml-1 text-xs text-emerald-700 dark:text-emerald-400"
        title={thankYouNote ?? undefined}
      >
        thanked
      </span>
    );
  }

  if (!yours) return null;

  const blocked = !giverEmail
    ? `${giverName} has no email address.`
    : !canSend
      ? "Reconnect Google in Settings to allow Hearth to send mail."
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        disabled={Boolean(blocked)}
        title={blocked ?? `Sends to ${giverEmail}, from your own address.`}
        className="ml-1 text-xs text-accent-700 underline hover:text-accent-800 disabled:no-underline disabled:opacity-50 dark:text-accent-400"
      >
        write thank you
      </button>

      <dialog
        ref={dialog}
        // Clicking the backdrop closes it. The dialog element reports those clicks as
        // landing on itself, since the backdrop is its pseudo-element rather than a
        // child, so the target check is what tells the two apart.
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="w-full max-w-lg rounded-xl border border-neutral-200 bg-white p-0 text-neutral-900 shadow-xl backdrop:bg-black/40 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <form action={formAction} className="space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Thank {giverName}</h2>
            <p className={helpClass}>
              For {giftDescription}. Sent from your own address to {giverEmail}.
            </p>
          </div>

          <FormMessage ok={state.ok} message={state.message} />
          <input type="hidden" name="giftId" value={giftId} />
          {/* Not "recipientId": the gift form's recipient checkboxes already own that
              name, and two different meanings behind one field name is a collision
              waiting for whoever writes the next selector. */}
          <input type="hidden" name="thankAs" value={recipientId} />

          <textarea
            name="message"
            rows={8}
            required
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Your thank-you"
            placeholder={`Dear ${giverName},\n\nThank you so much for the ${giftDescription}…`}
            className={inputClass}
          />
          {/* A placeholder, not a prefilled draft: whatever is in the box can be sent
              unread, and words Hearth put there are not the sender's. */}

          <div className="flex items-center gap-2">
            <SubmitButton className={btnPrimary} pendingLabel="Sending…">
              Send thank you
            </SubmitButton>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className={btnSecondary}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
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
  const checkedRecipients = new Set(
    defaultRecipientId
      ? [defaultRecipientId]
      : recipients.length === 1
        ? [recipients[0]!.id]
        : [],
  );

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
          <span className={labelClass}>To</span>
          {/* Checkboxes rather than a select, because a big present is often for several
              people at once — a holiday for the children is one gift and one thank-you,
              not one per child. */}
          <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
            {recipients.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300"
              >
                <input
                  type="checkbox"
                  name="recipientId"
                  value={p.id}
                  defaultChecked={checkedRecipients.has(p.id)}
                  className="size-4 rounded border-neutral-300 dark:border-neutral-600"
                />
                {p.displayName}
              </label>
            ))}
          </div>
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

