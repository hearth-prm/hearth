"use client";

import type { MailBlock } from "@/lib/thank-you";
import { useState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/actions/types";
import type { GiftView } from "@/lib/gifts";
import { dateOnlyToInput, formatDateOnly } from "@/lib/time";
import { DeleteForm } from "@/components/delete-form";
import {
  GiftForm,
  GiftEditForm,
  ThankYouControl,
  type PickablePerson,
} from "@/components/gift-forms";
import { Card } from "@/components/ui";

type Action = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A contact's gifts, in both directions.
 *
 * A client component, unusually for a page section here, because the edit affordances
 * are hidden behind a toggle: the list is the thing you read, and per-row Edit and
 * Remove links on every line are clutter you look past rather than use. The gifts
 * themselves arrive as plain data and nothing is fetched here.
 */
export function GiftsCard({
  gifts,
  personId,
  people,
  canEdit,
  addAction,
  updateAction,
  removeAction,
  sendAction,
  mailBlock,
}: {
  gifts: readonly GiftView[];
  personId: string;
  people: readonly PickablePerson[];
  canEdit: boolean;
  addAction: Action;
  updateAction: Action;
  removeAction: (form: FormData) => Promise<void>;
  /** Sends one written thank-you to one giver. */
  sendAction: Action;
  mailBlock: MailBlock | null;
}) {
  const [editing, setEditing] = useState(false);
  // Open when there is something to read. Controlled rather than left to the element,
  // because pressing Edit has to be able to open it: revealing controls inside a
  // collapsed section would look like the button had done nothing.
  const [open, setOpen] = useState(gifts.length > 0);
  const showControls = canEdit && editing;

  // One row read from either end; which name to show is the only difference. See the
  // note on the Gift model for why there is no direction column to consult.
  const received = gifts.filter((g) =>
    g.recipients.some((r) => r.id === personId),
  );
  const given = gifts.filter((g) => g.givers.some((gv) => gv.id === personId));

  return (
    <Card>
      <details
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
        className="group"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 marker:content-none">
          <div className="flex min-w-0 items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
              aria-hidden
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Gifts
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                What they were given, and what they gave.
              </p>
            </div>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={(e) => {
                // Inside a <summary>, so the click would otherwise toggle the section
                // as well — closing it at the very moment it grew controls.
                e.preventDefault();
                e.stopPropagation();
                setEditing((v) => !v);
                setOpen(true);
              }}
              aria-pressed={editing}
              // "Edit" alone is ambiguous in a card header — the page has several —
              // so the accessible name says what it edits.
              aria-label={editing ? "Done editing gifts" : "Edit gifts"}
              className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {editing ? "Done" : "Edit"}
            </button>
          ) : null}
        </summary>

        <div className="border-t border-neutral-200 dark:border-neutral-800">
          {gifts.length === 0 ? (
            <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
              Nothing recorded yet.
            </p>
          ) : (
            <div className="px-5 py-3">
              <GiftGroup
                heading="Received"
                gifts={received}
                otherSide="from"
                personId={personId}
                showControls={showControls}
                sendAction={sendAction}
                mailBlock={mailBlock}
                updateAction={updateAction}
                removeAction={removeAction}
              />
              {/* The rule earns its place only when there is something on both sides of
              it; between a list and nothing it is just a line. */}
              {received.length > 0 && given.length > 0 ? (
                <hr className="my-3 border-neutral-200 dark:border-neutral-800" />
              ) : null}
              {/* Status is about thanks owed, so it belongs only to what came in. */}
              <GiftGroup
                heading="Given"
                gifts={given}
                otherSide="to"
                personId={personId}
                showControls={showControls}
                sendAction={sendAction}
                mailBlock={mailBlock}
                updateAction={updateAction}
                removeAction={removeAction}
              />
            </div>
          )}

          {showControls ? (
            <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
              <GiftForm
                action={addAction}
                givers={people}
                recipients={people}
                defaultGiverId={personId}
              />
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

/**
 * One direction's worth, with each event's gifts collapsed under its own heading.
 *
 * Grouping by event rather than listing everything flat: a Christmas with fifteen
 * presents would otherwise bury every other gift the contact has ever been part of.
 * One-off gifts stay at the top level, since there is no occasion to collapse them
 * under.
 */
function GiftGroup({
  heading,
  gifts,
  otherSide,
  personId,
  showControls,
  sendAction,
  mailBlock,
  updateAction,
  removeAction,
}: {
  heading: string;
  gifts: readonly GiftView[];
  otherSide: "from" | "to";
  /** The contact whose page this is; whose thanks each row is about. */
  personId: string;
  showControls: boolean;
  sendAction: Action;
  mailBlock: MailBlock | null;
  updateAction: Action;
  removeAction: (form: FormData) => Promise<void>;
}) {
  if (gifts.length === 0) return null;

  const loose = gifts.filter((g) => !g.event);
  const byEvent = groupByEvent(gifts);

  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {heading}
      </h3>

      {loose.length > 0 ? (
        <ul className="mt-1 pl-5.5">
          {loose.map((gift) => (
            <GiftLine
              key={gift.id}
              gift={gift}
              otherSide={otherSide}
              personId={personId}
              showControls={showControls}
              sendAction={sendAction}
              mailBlock={mailBlock}
              updateAction={updateAction}
              removeAction={removeAction}
            />
          ))}
        </ul>
      ) : null}

      {byEvent.map((group) => (
        // Indented to sit under the heading, so its own rows land a further step in
        // and the nesting reads as nesting rather than as one flat list.
        <details key={group.id} className="group mt-1 pl-5.5">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-sm marker:content-none">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5 shrink-0 text-neutral-400 transition-transform group-open:rotate-90"
              aria-hidden
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
            {/* A link inside a summary: clicking the title navigates, clicking
                anywhere else on the row opens it. */}
            <Link
              href={`/events/${group.id}`}
              className="truncate text-accent-700 hover:underline dark:text-accent-400"
            >
              {group.title}
            </Link>
            <span className="shrink-0 text-xs text-neutral-400">
              {formatDateOnly(group.startAt)}
            </span>
            <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
              {group.gifts.length}
            </span>
          </summary>
          <ul className="pl-5.5">
            {group.gifts.map((gift) => (
              <GiftLine
                key={gift.id}
                gift={gift}
                otherSide={otherSide}
                personId={personId}
                showControls={showControls}
                sendAction={sendAction}
                mailBlock={mailBlock}
                updateAction={updateAction}
                removeAction={removeAction}
              />
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

interface EventGroup {
  id: string;
  title: string;
  startAt: Date;
  gifts: GiftView[];
}

/** Newest occasion first — the one you are most likely still writing notes for. */
function groupByEvent(gifts: readonly GiftView[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const gift of gifts) {
    if (!gift.event) continue;
    const existing = groups.get(gift.event.id);
    if (existing) existing.gifts.push(gift);
    else
      groups.set(gift.event.id, {
        id: gift.event.id,
        title: gift.event.title,
        startAt: gift.event.startAt,
        gifts: [gift],
      });
  }
  return [...groups.values()].sort(
    (a, b) => b.startAt.getTime() - a.startAt.getTime(),
  );
}

function GiftLine({
  gift,
  otherSide,
  personId,
  showControls,
  sendAction,
  mailBlock,
  updateAction,
  removeAction,
}: {
  gift: GiftView;
  otherSide: "from" | "to";
  personId: string;
  showControls: boolean;
  sendAction: Action;
  mailBlock: MailBlock | null;
  updateAction: Action;
  removeAction: (form: FormData) => Promise<void>;
}) {
  // Going out, a gift may have been for several people at once, so the other end is a
  // list rather than a name.
  // Either end may be several people now: a present from a couple to two children is one
  // gift with two names on each side.
  const others = otherSide === "from" ? gift.givers : gift.recipients;
  // Whose thanks this row is about: the contact whose page this is.
  const forRecipient = gift.recipients.find((r) => r.id === personId);

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-3 py-0.5 text-sm">
      <span className="min-w-0">
        {gift.description}{" "}
        <span className="text-neutral-500 dark:text-neutral-400">
          {otherSide}
        </span>{" "}
        {others.map((person, i) => (
          <span key={person.id}>
            {i > 0 ? <span className="text-neutral-400">{", "}</span> : null}
            {/* A trashed contact keeps its name here but loses its link: the gift is
                still part of this person's history, and a link to a page that no longer
                resolves would read as a fault rather than as a deletion. */}
            {person.deleted ? (
              <span
                className="text-neutral-500 dark:text-neutral-400"
                title="This contact is in the trash"
              >
                {person.displayName}
              </span>
            ) : (
              <Link
                href={`/people/${person.id}`}
                className="text-accent-700 hover:underline dark:text-accent-400"
              >
                {person.displayName}
              </Link>
            )}
          </span>
        ))}
        {/* Only a gift with no event needs its date spelled out; an event gift has
            the occasion's date on the group above it. */}
        {!gift.event && gift.receivedOn ? (
          <span className="ml-1 text-xs text-neutral-400">
            {formatDateOnly(gift.receivedOn)}
          </span>
        ) : null}
        {/* Only what they received, and scoped to them: this page is about one person,
            so a present shared with somebody else shows only this person's thanks. */}
        {otherSide === "from" && forRecipient ? (
          <ThankYouControl
            action={sendAction}
            giftId={gift.id}
            recipientId={forRecipient.id}
            giftDescription={gift.description}
            givers={gift.givers.map((g) => ({
              id: g.id,
              displayName: g.displayName,
              email: g.email,
              // Per giver, from the same derivation has:unthanked uses — so the dialog and
              // the search agree about who is still owed a note.
              thanked: !forRecipient.outstandingGiverIds.includes(g.id),
            }))}
            lastNote={forRecipient.thankYous[0]?.message ?? null}
            mailBlock={mailBlock}
            yours={forRecipient.canThank}
          />
        ) : null}
        {gift.notes ? (
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            {gift.notes}
          </span>
        ) : null}
      </span>

      {showControls ? (
        <span className="flex shrink-0 items-center gap-3">
          <GiftEditForm
            action={updateAction}
            giftId={gift.id}
            hasEvent={Boolean(gift.eventId)}
            current={{
              description: gift.description,
              notes: gift.notes ?? "",
              receivedOn: gift.receivedOn
                ? dateOnlyToInput(gift.receivedOn)
                : "",
            }}
          />
          <DeleteForm
            action={removeAction}
            id={gift.id}
            label="Remove"
            pendingLabel="Removing…"
            confirmMessage={`Remove "${gift.description}"?`}
            className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
          />
        </span>
      ) : null}
    </li>
  );
}
