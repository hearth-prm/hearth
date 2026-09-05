import Link from "next/link";
import { requireUser } from "@/lib/access";
import { listThankYousOwed } from "@/lib/thank-yous-owed";
import { formatDateOnly } from "@/lib/time";
import {
  Card,
  CardHeader,
  EmptyState,
  Hint,
  PageHeader,
} from "@/components/ui";

/**
 * Thank-yous still to write.
 *
 * The question "what do I still owe" existed only as `has:unthanked` in the search box and
 * as a link on whichever present you happened to be looking at — so answering it meant
 * remembering which presents there had been. It is a standing to-do list, and a to-do list
 * needs somewhere to live.
 *
 * ## One row per giver
 *
 * A present from a couple earns two notes and may have had one of them written already, so
 * a row is a (present, giver) pair rather than a present. That is the same unit
 * `has:unthanked` counts, which is why this page and that search cannot disagree.
 *
 * ## Nothing is sent from here
 *
 * Every row links to the page holding the present, where the note gets written. Writing a
 * thank-you means choosing addressing, attaching a photograph and reading what the present
 * was; none of that belongs on a list. Sending from a list is also how you send the wrong
 * note to the wrong person quickly.
 *
 * ## A thank-you manager sees everybody's
 *
 * `thankYouAuditCardsWhere` decides, in `access.ts`. This is the one place the sharing
 * boundary is crossed on purpose: a thank-you manager reads gift descriptions and giver names from
 * households they otherwise cannot see. The page says whose list it is showing, and groups
 * by the person who owes it, so a widened view never reads as your own backlog.
 */
export default async function ThankYousPage() {
  const user = await requireUser();
  const { rows, everyone } = await listThankYousOwed(user.id);

  // Grouped by whose notes they are. For everybody but a thank-you manager this is one group, and
  // the heading is then noise — so the grouping is only rendered when there is more than
  // one, rather than being a different code path.
  const groups = new Map<string, { name: string; rows: typeof rows }>();
  for (const row of rows) {
    const key = row.owedByUserId ?? row.fromPersonId;
    const name =
      row.owedByUserId === user.id
        ? "You"
        : (row.owedByName ?? row.fromDisplayName);
    const bucket = groups.get(key) ?? { name, rows: [] };
    bucket.rows.push(row);
    groups.set(key, bucket);
  }
  // Yours first when it is there; it is the one you can act on.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === user.id ? -1 : b === user.id ? 1 : 0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thank-yous"
        description={
          everyone
            ? "Every note still to write, across everybody who uses this Hearth."
            : "Presents you have not written back about yet."
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={everyone ? "Nobody owes a thank-you" : "Nothing to write"}
          description="A present shows up here as soon as it is recorded with a giver, and leaves when the note has actually gone."
        />
      ) : (
        <div className="space-y-6">
          {ordered.map(([key, group]) => (
            <Card key={key}>
              <CardHeader
                title={
                  ordered.length > 1
                    ? `${group.name} — ${group.rows.length}`
                    : `${group.rows.length} to write`
                }
              />
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
                {group.rows.map((row) => (
                  <li
                    key={`${row.giftId}:${row.fromPersonId}:${row.giverId}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <Link
                        href={`/people/${row.giverId}`}
                        className="font-medium text-accent-700 hover:underline dark:text-accent-400"
                      >
                        {row.giverDisplayName}
                      </Link>
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {" — "}
                        {row.giftDescription}
                      </span>
                      {/* Named, because a note that cannot be emailed is still owed — it is
                          written on paper — and the row should not look identical to one
                          that is a click from being sent. */}
                      {row.giverEmail ? null : (
                        <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                          no email on file
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                      {row.receivedOn ? (
                        <span>{formatDateOnly(row.receivedOn)}</span>
                      ) : null}
                      {/* To the record, not to a send form: writing a note needs the
                          addressing choice, the attachments and the present in front of
                          you. */}
                      <Link
                        href={
                          row.eventId
                            ? `/events/${row.eventId}`
                            : `/people/${row.fromPersonId}`
                        }
                        className="text-accent-700 underline hover:text-accent-800 dark:text-accent-400"
                      >
                        {row.eventTitle ?? "write it"}
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {everyone ? (
        <Hint>
          You are seeing everybody&apos;s because your address is in
          HEARTH_THANK_YOU_MANAGERS. You can write the notes of anybody who
          ticked &ldquo;let a thank-you manager write my thank-yous&rdquo; in
          their settings; the rest are listed so you know they are owed. Nothing
          sends from this page — each row links to the record holding the
          present.
        </Hint>
      ) : null}
    </div>
  );
}
