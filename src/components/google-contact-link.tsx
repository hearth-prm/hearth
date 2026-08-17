import { Badge, DetailRow } from "@/components/ui";

/**
 * Which Google contact this record writes to.
 *
 * Useful mostly for confirmation: the SYNCED badge only means Google accepted the
 * write, and changes can take a while to appear in the Contacts UI, so being able
 * to open the actual record settles "did that go through?" directly.
 *
 * Secondary, and worth knowing: Hearth recognises only contacts it created itself
 * (by their hearth_id custom field), so a first push creates a new contact rather
 * than linking to one already in the address book. If this link opens something
 * unexpected, that is why.
 */
export function GoogleContactLink({
  resourceName,
  addToGoogle,
  compact = false,
}: {
  resourceName: string | null;
  addToGoogle: boolean;
  /**
   * Match the surrounding rows.
   *
   * Without it this rendered the wide two-column DetailRow while every row around it in
   * the Record card was compact — so its value sat in the second column and it was the
   * one line on the card that did not start at the left edge.
   */
  compact?: boolean;
}) {
  if (!addToGoogle) {
    return (
      <DetailRow compact={compact} label="Google contact">
        Not synced
      </DetailRow>
    );
  }
  if (!resourceName) {
    return (
      <DetailRow compact={compact} label="Google contact">
        <Badge tone="amber">Not created yet</Badge>
      </DetailRow>
    );
  }

  // resourceName is "people/c123…"; the Contacts UI addresses the same record as
  // /person/c123…
  const id = resourceName.replace(/^people\//, "");

  return (
    <DetailRow compact={compact} label="Google contact">
      <a
        href={`https://contacts.google.com/person/${encodeURIComponent(id)}`}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent-700 hover:underline dark:text-accent-400"
      >
        Open in Google Contacts
      </a>
      <span className="mt-0.5 block font-mono text-[11px] text-neutral-400">
        {resourceName}
      </span>
    </DetailRow>
  );
}
