/**
 * Next.js server-startup hook.
 *
 * Runs once per server process, which is the one place a long-lived background
 * timer can be started without a second container. The runtime guard matters:
 * instrumentation is also evaluated for the edge runtime, where there is no
 * database driver and no timers worth starting.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Imported dynamically so the edge bundle never pulls in Prisma or googleapis.
  const { startSyncScheduler } = await import("@/lib/sync/scheduler");
  startSyncScheduler();

  // Its own loop, not a pass inside the sync tick: an install with no Google account at all
  // can still want semantic search, so SYNC_ENABLED=false must not turn the index off.
  const { startSearchIndexer } = await import("@/lib/search/index-scheduler");
  startSearchIndexer();
}
