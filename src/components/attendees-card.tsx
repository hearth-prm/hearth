"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { AttendeeRole, RsvpStatus } from "@prisma/client";
import {
  ATTENDEE_ROLE_LABELS,
  ATTENDEE_ROLES,
  RSVP_LABELS,
  RSVP_STATUSES,
} from "@/lib/events";
import { DeleteForm } from "@/components/delete-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge, btnSecondary, Card, CardHeader, inputClass } from "@/components/ui";

export interface AttendeeView {
  id: string;
  personId: string;
  displayName: string;
  /** Already resolved server-side; null when there is none on file. */
  email: string | null;
  role: AttendeeRole;
  rsvp: RsvpStatus;
  inviteToGoogle: boolean;
  rsvpFromGoogle: boolean;
}

/**
 * The guest list.
 *
 * Every row used to carry a role dropdown, an RSVP dropdown, an invite checkbox and an
 * Update button, permanently — four controls per person, on a list whose usual purpose
 * is to be read. They are behind an Edit toggle now, the same as the gifts card: the
 * common visit wants to know who was there and what they said, not to change it.
 *
 * There is no rule between guests while reading, either: a line per person on a list of
 * one-line rows is more ink than the rows themselves. The rules come back while editing,
 * where every row grows a form and genuinely needs separating from the next.
 */
export function AttendeesCard({
  attendees,
  canEdit,
  updateAction,
  removeAction,
  addForm,
}: {
  attendees: readonly AttendeeView[];
  canEdit: boolean;
  updateAction: (form: FormData) => Promise<void>;
  removeAction: (form: FormData) => Promise<void>;
  /**
   * The add-someone control, passed in rather than built here.
   *
   * It needs a server action for its search, which a client component cannot create —
   * so the page composes it and this decides only whether to show it.
   */
  addForm: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const showControls = canEdit && editing;

  return (
    <Card>
      <CardHeader
        title="Who was there"
        description={`${attendees.length} ${attendees.length === 1 ? "person" : "people"}`}
        action={
          canEdit ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-pressed={editing}
              aria-label={editing ? "Done editing guests" : "Edit guests"}
              className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            >
              {editing ? "Done" : "Edit"}
            </button>
          ) : null
        }
      />

      {attendees.length === 0 ? (
        <p className="px-5 py-4 text-sm text-neutral-500 dark:text-neutral-400">
          No one linked yet.
        </p>
      ) : (
        <ul
          className={
            showControls
              ? "divide-y divide-neutral-100 dark:divide-neutral-800/60"
              : "py-1"
          }
        >
          {attendees.map((a) => (
            <li key={a.id} className={showControls ? "px-5 py-4" : "px-5 py-1"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <Link
                    href={`/people/${a.personId}`}
                    className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                  >
                    {a.displayName}
                  </Link>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {" - "}
                    {a.email ?? "no email on file"}
                  </span>
                  {a.rsvpFromGoogle ? (
                    <span className="ml-2 text-xs text-accent-600 dark:text-accent-400">
                      RSVP from Google
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      a.rsvp === "ACCEPTED"
                        ? "accent"
                        : a.rsvp === "DECLINED"
                          ? "rose"
                          : "neutral"
                    }
                  >
                    {RSVP_LABELS[a.rsvp]}
                  </Badge>
                  {showControls ? (
                    <DeleteForm
                      action={removeAction}
                      id={a.id}
                      idName="attendeeId"
                      label="Remove"
                      pendingLabel="Removing…"
                      className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                      confirmMessage={`Remove ${a.displayName} from this event?`}
                    />
                  ) : null}
                </div>
              </div>

              {showControls ? (
                <form action={updateAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="attendeeId" value={a.id} />
                  <label className="text-xs text-neutral-500 dark:text-neutral-400">
                    Role
                    <select
                      name="role"
                      defaultValue={a.role}
                      className={`${inputClass} mt-1 py-1.5`}
                    >
                      {ATTENDEE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ATTENDEE_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-neutral-500 dark:text-neutral-400">
                    RSVP
                    <select
                      name="rsvp"
                      defaultValue={a.rsvp}
                      className={`${inputClass} mt-1 py-1.5`}
                    >
                      {RSVP_STATUSES.map((r) => (
                        <option key={r} value={r}>
                          {RSVP_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 pb-2 text-xs text-neutral-500 dark:text-neutral-400">
                    <input
                      type="checkbox"
                      name="inviteToGoogle"
                      defaultChecked={a.inviteToGoogle}
                      className="size-3.5 rounded border-neutral-300 text-accent-600 dark:border-neutral-600"
                    />
                    Invite in Google
                  </label>
                  <SubmitButton className={`${btnSecondary} py-1.5`} pendingLabel="Saving…">
                    Update
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {showControls ? (
        <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
          {addForm}
        </div>
      ) : null}
    </Card>
  );
}
