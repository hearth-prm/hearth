import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { revokeShare, shareEverything } from "@/lib/actions/shares";
import { Badge, Card, CardHeader } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { ShareEverythingForm } from "@/components/share-forms";

const SCOPE_LABELS: Record<string, string> = {
  ALL_PEOPLE: "All contacts",
  ALL_EVENTS: "All events",
  PERSON: "One contact",
  EVENT: "One event",
};

export default async function SharingPage() {
  const user = await requireUser();

  const [given, received] = await Promise.all([
    prisma.share.findMany({
      where: { ownerId: user.id },
      include: {
        withUser: { select: { email: true, name: true } },
        person: { select: { id: true, displayName: true } },
        event: { select: { id: true, title: true } },
      },
      orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
    }),
    prisma.share.findMany({
      where: { withUserId: user.id },
      include: {
        owner: { select: { email: true, name: true } },
        person: { select: { id: true, displayName: true } },
        event: { select: { id: true, title: true } },
      },
      orderBy: [{ scope: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Share everything"
          description="A standing grant that includes records you add later."
        />
        <ShareEverythingForm action={shareEverything} />
      </Card>

      <Card>
        <CardHeader
          title="What you've shared"
          description={given.length === 0 ? "Nothing yet." : undefined}
        />
        {given.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            Share a single contact or event from its own page, or everything above.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {given.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{SCOPE_LABELS[s.scope]}</span>
                    {s.person ? (
                      <>
                        {" — "}
                        <Link href={`/people/${s.person.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                          {s.person.displayName}
                        </Link>
                      </>
                    ) : null}
                    {s.event ? (
                      <>
                        {" — "}
                        <Link href={`/events/${s.event.id}`} className="text-teal-700 hover:underline dark:text-teal-400">
                          {s.event.title}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    with {s.withUser.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.permission === "EDIT" ? "amber" : "slate"}>
                    {s.permission === "EDIT" ? "can edit" : "view only"}
                  </Badge>
                  <DeleteForm
                    action={revokeShare}
                    id={s.id}
                    label="Revoke"
                    pendingLabel="Revoking…"
                    className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                    confirmMessage="Stop sharing this?"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Shared with you"
          description={
            received.length === 0
              ? "Nothing yet."
              : "These appear in your lists alongside your own records."
          }
        />
        {received.length === 0 ? (
          <p className="px-5 py-5 text-sm text-neutral-500 dark:text-neutral-400">
            When someone shares with you it will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
            {received.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div>
                  <p className="text-sm">
                    <span className="font-medium">{SCOPE_LABELS[s.scope]}</span>
                    {s.person ? ` — ${s.person.displayName}` : ""}
                    {s.event ? ` — ${s.event.title}` : ""}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    from {s.owner.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.permission === "EDIT" ? "amber" : "slate"}>
                    {s.permission === "EDIT" ? "you can edit" : "view only"}
                  </Badge>
                  {/* The recipient may decline: otherwise someone else's share
                      clutters your lists with no way to remove it. */}
                  <DeleteForm
                    action={revokeShare}
                    id={s.id}
                    label="Remove"
                    pendingLabel="Removing…"
                    className="text-xs text-neutral-500 underline hover:text-rose-600 dark:text-neutral-400"
                    confirmMessage="Remove this from your lists?"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
