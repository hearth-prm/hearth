"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/actions/types";
import { SubmitButton } from "@/components/submit-button";
import { PersonPicker } from "@/components/person-picker";
import {
  btnPrimary,
  btnSecondary,
  FormMessage,
  helpClass,
  inputClass,
  labelClass,
} from "@/components/ui";
import type { MailBlock } from "@/lib/thank-you";
import {
  ADDRESSING_HELP,
  ADDRESSING_LABELS,
  ADDRESSING_MODES,
  type Addressing,
} from "@/lib/thank-you";
import { MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/attachments";

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
export interface ThankYouGiver {
  id: string;
  displayName: string;
  email: string | null;
  /** Whether a note has already reached this one from this recipient. */
  thanked: boolean;
}

export function ThankYouControl({
  action,
  giftId,
  recipientId,
  giftDescription,
  givers,
  mailBlock,
  yours,
  lastNote,
}: {
  action: Action;
  giftId: string;
  /** Whose thanks these are. A shared present earns one note per recipient. */
  recipientId: string;
  giftDescription: string;
  /**
   * Everyone who gave it, each with whether they have been thanked yet.
   *
   * A present from a couple is one present, and a note can go to all of them together or to
   * each of them separately — so this is a list, and the ones already thanked are offered
   * unticked rather than hidden. Thanking somebody twice is a thing a person may want to do.
   */
  givers: readonly ThankYouGiver[];
  mailBlock: MailBlock | null;
  /**
   * Whether this gift was given to the person reading.
   *
   * The note is sent from their address and signed by nobody else, so offering it on a
   * gift somebody else received would mean writing a stranger a thank-you as the wrong
   * person. Being able to edit a contact is not licence to speak as them.
   */
  yours: boolean;
  /** The most recent note sent for this gift by this recipient, for the hover text. */
  lastNote: string | null;
}) {
  const [state, formAction] = useActionState(action, EMPTY_ACTION_STATE);
  const dialog = useRef<HTMLDialogElement>(null);
  // Controlled, and that is not a style choice: React resets an uncontrolled form once
  // its action settles, failure included — so a send Google refused would throw away
  // the note and leave an empty box. Holding the text here means a retry starts from
  // what was written rather than from nothing.
  const [message, setMessage] = useState("");
  // Who to thank. Defaults to everyone not yet thanked, which is the common case — and to
  // everyone if they all have been, since the alternative is a dialog with nothing ticked.
  const outstanding = givers.filter((g) => !g.thanked && g.email);
  const [chosen, setChosen] = useState<string[]>(
    (outstanding.length > 0 ? outstanding : givers.filter((g) => g.email)).map(
      (g) => g.id,
    ),
  );
  const [addressing, setAddressing] = useState<Addressing>("together");

  useEffect(() => {
    if (state.ok) {
      dialog.current?.close();
      setMessage("");
    }
  }, [state.ok]);

  const reachable = givers.filter((g) => g.email);
  const owed = givers.filter((g) => !g.thanked);
  const allThanked = owed.length === 0;

  if (allThanked) {
    return (
      <span
        className="ml-1 text-xs text-emerald-700 dark:text-emerald-400"
        title={lastNote ?? undefined}
      >
        thanked
      </span>
    );
  }

  if (!yours) return null;

  // Why not, rather than whether. A disabled link whose only explanation is a `title` is
  // indistinguishable from a broken one, which is exactly how this was reported: "I click
  // it and nothing happens". The install-wide reasons arrive already worded, because three
  // different things make sending impossible and only one of them is about Google.
  const blocked: MailBlock | null =
    reachable.length === 0
      ? {
          short:
            givers.length === 1
              ? "no email on file"
              : "no email addresses on file",
          full: `${givers.map((g) => g.displayName).join(", ")} ${givers.length === 1 ? "has" : "have"} no email address, so there is nowhere to send a thank-you.`,
        }
      : mailBlock;

  const picked = givers.filter((g) => chosen.includes(g.id) && g.email);
  // The choice only exists when there is a choice to make: one giver has no addressing.
  const showAddressing = picked.length > 1;

  return (
    <>
      {blocked ? (
        // Not a dead button: a faded link that does nothing teaches people the app is
        // broken rather than that it is unconfigured.
        <span
          title={blocked.full}
          className="ml-1 cursor-help text-xs text-neutral-500 underline decoration-dotted dark:text-neutral-400"
        >
          {blocked.short}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          title={`Sends from your own address to ${reachable.map((g) => g.email).join(", ")}.`}
          className="ml-1 text-xs text-accent-700 underline hover:text-accent-800 dark:text-accent-400"
        >
          {owed.length < givers.length ? "thank the rest" : "write thank you"}
        </button>
      )}

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
        <form
          action={formAction}
          // Attachments mean the browser must send the form as multipart, or the files
          // arrive as filenames and nothing else.
          encType="multipart/form-data"
          className="space-y-3 p-5"
        >
          <div>
            <h2 className="text-sm font-semibold">
              Thank{" "}
              {picked.length === 1
                ? picked[0]!.displayName
                : `${picked.length} people`}
            </h2>
            {/* Naming the addresses, not just the people. With several givers it matters
                MORE than it did with one: "sent to Karen" does not tell you which of her
                three addresses, and a thank-you to the wrong one is a thank-you nobody
                receives. */}
            <p className={helpClass}>
              For {giftDescription}. Sent from your own address to{" "}
              {picked.length > 0
                ? picked.map((g) => g.email).join(", ")
                : "whoever you tick above"}
              .
            </p>
          </div>

          <FormMessage ok={state.ok} message={state.message} />
          <input type="hidden" name="giftId" value={giftId} />
          {/* Not "recipientId": the gift form's recipient checkboxes already own that
              name, and two different meanings behind one field name is a collision
              waiting for whoever writes the next selector. */}
          <input type="hidden" name="thankAs" value={recipientId} />

          {givers.length > 1 ? (
            <fieldset className="space-y-1">
              <legend className={labelClass}>Who to thank</legend>
              {givers.map((g) => (
                <label
                  key={g.id}
                  className="flex items-center gap-2 text-sm"
                  title={
                    g.email ?? "No email address, so this one cannot be sent"
                  }
                >
                  <input
                    type="checkbox"
                    // "thankGiverId", not "giverId". The gift form's own giver picker owns
                    // that name and is rendered on the same page, so a selector for one
                    // matched both — the collision the recipientId note above warned about,
                    // committed with the other field. It cost a debugging cycle to find.
                    name="thankGiverId"
                    value={g.id}
                    checked={chosen.includes(g.id)}
                    disabled={!g.email}
                    onChange={(e) =>
                      setChosen((prev) =>
                        e.target.checked
                          ? [...prev, g.id]
                          : prev.filter((id) => id !== g.id),
                      )
                    }
                    className="size-3.5 rounded border-neutral-300 text-accent-600 dark:border-neutral-600"
                  />
                  <span className={g.email ? "" : "text-neutral-400"}>
                    {g.displayName}
                  </span>
                  {g.thanked ? (
                    <span className="text-xs text-emerald-700 dark:text-emerald-400">
                      already thanked
                    </span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          ) : // One giver: still submitted, so the action never has to guess.
          picked[0] ? (
            <input type="hidden" name="thankGiverId" value={picked[0].id} />
          ) : null}

          {showAddressing ? (
            <label className="block">
              <span className={labelClass}>How to send it</span>
              <select
                name="addressing"
                value={addressing}
                onChange={(e) => setAddressing(e.target.value as Addressing)}
                // The explanation of the CHOSEN option, on the control itself, so it is one
                // hover away rather than three lines of prose nobody reads twice.
                title={ADDRESSING_HELP[addressing]}
                className={`${inputClass} mt-1`}
              >
                {ADDRESSING_MODES.map((mode) => (
                  <option key={mode} value={mode} title={ADDRESSING_HELP[mode]}>
                    {ADDRESSING_LABELS[mode]}
                  </option>
                ))}
              </select>
              <span className={helpClass}>{ADDRESSING_HELP[addressing]}</span>
            </label>
          ) : null}

          <textarea
            name="message"
            rows={8}
            required
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label="Your thank-you"
            placeholder={`Dear ${picked[0]?.displayName ?? "friend"},\n\nThank you so much for the ${giftDescription}…`}
            className={inputClass}
          />
          {/* A placeholder, not a prefilled draft: whatever is in the box can be sent
              unread, and words Hearth put there are not the sender's. */}

          <label className="block">
            <span className={labelClass}>Attachments</span>
            <input
              type="file"
              name="attachment"
              multiple
              className="mt-1 block w-full text-xs text-neutral-600 file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-xs dark:text-neutral-400 dark:file:bg-neutral-800"
            />
            <span className={helpClass}>
              Up to {MAX_FILES} files,{" "}
              {Math.round(MAX_TOTAL_BYTES / (1024 * 1024))}MB in total — a
              photograph of the present being used, usually. A group note
              carries one copy, however many people it goes to.
            </span>
          </label>

          <div className="flex items-center gap-2">
            <SubmitButton className={btnPrimary} pendingLabel="Sending…">
              {picked.length > 1 && addressing === "separate"
                ? `Send ${picked.length} notes`
                : "Send thank you"}
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
   * to record a gift there is usually that they gave you something. Both sides stay
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnSecondary}
      >
        Record a gift
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage ok={state.ok} message={state.message} />
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Typed filtering rather than two 500-row scroll boxes. Ticked people stay pinned
            above the matches: a checkbox filtered out of the DOM submits nothing, so hiding
            one would drop a giver from the gift with nothing on screen saying so. */}
        <PersonPicker
          name="giverId"
          label="From"
          people={givers}
          defaultSelected={defaultGiverId ? [defaultGiverId] : []}
          help="A present from a couple is one present — tick everybody who gave it."
        />

        <PersonPicker
          name="recipientId"
          label="To"
          people={recipients}
          defaultSelected={Array.from(checkedRecipients)}
          help="A holiday for the children is one gift and one thank-you, not one per child."
        />
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
          Anything worth saying in the thank-you. It travels with the gift into
          the emailed list.
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
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={btnSecondary}
        >
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
          <select
            id="gift-for"
            name="personId"
            className={`${inputClass} mt-1.5`}
            required
          >
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
