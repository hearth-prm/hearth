import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { listOtherUsers } from "@/lib/users";
import { revokeShare, shareEverything } from "@/lib/actions/shares";
import { handOverHousehold, repairHousehold } from "@/lib/actions/household";
import { Badge, Card, CardHeader, DetailRow, Hint } from "@/components/ui";
import { DeleteForm } from "@/components/delete-form";
import { ShareEverythingForm } from "@/components/share-forms";
import { HandOverForm, RepairHouseholdForm } from "@/components/household-form";

const SCOPE_LABELS: Record<string, string> = {
  ALL_PEOPLE: "All contacts",
  ALL_EVENTS: "All events",
  PERSON: "One contact",
  EVENT: "One event",
};

export default async function SharingPage() {
  const user = await requireUser();

  const [head, cards, me, users, given, received] = await Promise.all([
    prisma.user.findFirst({
      where: { isHeadOfHousehold: true },
      select: { id: true, name: true, email: true },
    }),
    prisma.person.findMany({
      where: { linkedUserId: { not: null } },
      select: { id: true, displayName: true, linkedUserId: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { isHeadOfHousehold: true },
    }),
    listOtherUsers(user.id),
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

  const isHead = me.isHeadOfHousehold;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              Household
              <Hint label="What household cards are">
                Every user of this Hearth gets a contact card. The head of the household
                owns them and everyone can edit them, so your own details reach your own
                Google Contacts — which is what your phone&rsquo;s “share contact” sends.
              </Hint>
            </span>
          }
        />
        <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
          <DetailRow label="Head of household">
            {head ? (
              <>
                {head.name ?? head.email}
                {isHead ? <span className="text-neutral-400"> · you</span> : null}
              </>
            ) : (
              <span className="text-neutral-400">nobody yet</span>
            )}
          </DetailRow>
          <DetailRow label="Contact cards">
            {cards.length === 0 ? (
              <span className="text-neutral-400">none yet</span>
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {cards.map((c) => (
                  <Link
                    key={c.id}
                    href={`/people/${c.id}`}
                    className="text-accent-700 hover:underline dark:text-accent-400"
                  >
                    {c.displayName}
                    {c.linkedUserId === user.id ? " (you)" : ""}
                  </Link>
                ))}
              </span>
            )}
          </DetailRow>
        </dl>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-neutral-100 px-5 py-3 dark:border-neutral-800/60">
          {isHead ? (
            <HandOverForm action={handOverHousehold} users={users} />
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Only the head of the household can hand it over.
            </p>
          )}
          <RepairHouseholdForm action={repairHousehold} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Share everything"
          description="A standing grant that includes records you add later."
        />
        <ShareEverythingForm
          action={shareEverything}
          users={users}
          alreadySharedPeople={given
            .filter((g) => g.scope === "ALL_PEOPLE")
            .map((g) => g.withUserId)}
          alreadySharedEvents={given
            .filter((g) => g.scope === "ALL_EVENTS")
            .map((g) => g.withUserId)}
        />
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
                        <Link href={`/people/${s.person.id}`} className="text-accent-700 hover:underline dark:text-accent-400">
                          {s.person.displayName}
                        </Link>
                      </>
                    ) : null}
                    {s.event ? (
                      <>
                        {" — "}
                        <Link href={`/events/${s.event.id}`} className="text-accent-700 hover:underline dark:text-accent-400">
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
