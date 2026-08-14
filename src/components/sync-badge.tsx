import type { SyncStatus } from "@prisma/client";
import { Badge } from "@/components/ui";

export function SyncBadge({
  addToGoogle,
  status,
}: {
  addToGoogle: boolean;
  status: SyncStatus;
}) {
  if (!addToGoogle) return <Badge tone="slate">Not in Google</Badge>;

  switch (status) {
    case "SYNCED":
      return <Badge tone="accent">In Google</Badge>;
    case "ERROR":
      return <Badge tone="rose">Sync error</Badge>;
    case "DISABLED":
      return <Badge tone="slate">Not in Google</Badge>;
    default:
      return <Badge tone="amber">Sync pending</Badge>;
  }
}
