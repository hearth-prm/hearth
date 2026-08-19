import { diffSnapshots, type FieldChange } from "@/lib/person-history";
import type { PersonVersionRow } from "@/lib/person-versions";
import { CollapsibleCard } from "@/components/ui";

const SOURCE_WORDS: Record<string, string> = {
  CREATED: "created",
  EDITED: "edited",
  CSV_IMPORT: "changed by a CSV import",
  GOOGLE_IMPORT: "imported from Google",
  TRANSFERRED: "given to somebody else",
  TRASHED: "moved to the trash",
  RESTORED: "restored from the trash",
};

/**
 * What has happened to this contact, newest first.
 *
 * The changes are worked out here from the stored snapshots rather than read from a
 * changelog. That is what makes them improvable: wording this better improves every entry
 * already recorded, and there is no second copy of the truth to fall out of step.
 *
 * Collapsed by default. History is what you consult, not what you came to read.
 */
export function PersonHistoryCard({
  versions,
  timeZone,
}: {
  /** Newest first, as loadPersonVersions returns them. */
  versions: readonly PersonVersionRow[];
  timeZone: string;
}) {
  if (versions.length === 0) return null;

  // Paired with the version before it, which is the one lower down the list.
  const entries = versions.map((version, i) => ({
    version,
    changes: diffSnapshots(versions[i + 1]?.content ?? null, version.content),
  }));

  return (
    <CollapsibleCard
      title="History"
      description="Every change Hearth has recorded, and who made it."
      meta={`${versions.length}`}
    >
      <ol className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {entries.map(({ version, changes }) => (
          <li key={version.id} className="px-5 py-3">
            <p className="text-sm">
              <span className="font-medium">
                {SOURCE_WORDS[version.source] ?? version.source}
              </span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {" "}
                {new Intl.DateTimeFormat(undefined, {
                  timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(version.createdAt)}
                {version.byEmail ? ` by ${version.byEmail}` : ""}
              </span>
            </p>

            {changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {changes.map((change, i) => (
                  <li key={i} className="text-xs">
                    <Change change={change} />
                  </li>
                ))}
              </ul>
            ) : (
              // The first version has nothing before it to differ from, and its source
              // already says where it came from.
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {version.revision === 1
                  ? "The contact as it first arrived."
                  : "No visible change."}
              </p>
            )}
          </li>
        ))}
      </ol>
    </CollapsibleCard>
  );
}

function Change({ change }: { change: FieldChange }) {
  return (
    <>
      <span className="text-neutral-500 dark:text-neutral-400">{change.what}: </span>
      {change.from ? (
        <span className="text-rose-700 line-through decoration-rose-400/60 dark:text-rose-400">
          {change.from}
        </span>
      ) : null}
      {change.from && change.to ? (
        <span className="text-neutral-400"> → </span>
      ) : null}
      {change.to ? (
        <span className="text-emerald-700 dark:text-emerald-400">{change.to}</span>
      ) : null}
      {/* An empty side is said in words rather than left blank, so a removal does not
          read as a rendering fault. */}
      {change.from && !change.to ? (
        <span className="text-neutral-400"> removed</span>
      ) : null}
    </>
  );
}
