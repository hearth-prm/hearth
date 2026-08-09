import { runContactSyncForAllUsers } from "./runner";

/**
 * In-process periodic sync.
 *
 * Started from instrumentation.ts when the server boots, so the deployment stays a
 * single container. That is safe because every run takes the per-user lease first
 * (src/lib/sync/lease.ts) — two app instances, or a manual "Sync now" landing
 * mid-cycle, cannot process the same records twice.
 *
 * setTimeout chained after each run rather than setInterval: an interval would
 * fire again while a slow run was still going, and the lease would then reject the
 * overlap as "busy" — correct, but it would mean a slow user silently starves.
 */

const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 30;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function intervalMs(): number {
  const raw = Number.parseInt(process.env.SYNC_INTERVAL_SECONDS ?? "", 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_SECONDS;
  return Math.max(seconds, MIN_INTERVAL_SECONDS) * 1000;
}

function enabled(): boolean {
  // Opt out for anyone who would rather drive sync from an external scheduler.
  return (process.env.SYNC_ENABLED ?? "true").toLowerCase() !== "false";
}

async function tick(): Promise<void> {
  try {
    const runs = await runContactSyncForAllUsers();
    for (const { userId, outcome } of runs) {
      switch (outcome.status) {
        case "ok":
          // Silent when there was nothing to do, or the log becomes noise that
          // hides the runs that mattered.
          if (outcome.summary !== "nothing to do") {
            console.log(`[hearth] contacts ${userId}: ${outcome.summary}`);
          }
          break;
        case "auth":
          console.warn(`[hearth] contacts ${userId}: ${outcome.message}`);
          break;
        case "error":
          console.error(`[hearth] contacts ${userId}: ${outcome.message}`);
          break;
        default:
          break;
      }
    }
  } catch (err) {
    // Never let a failure kill the loop — the next tick may well succeed.
    console.error("[hearth] sync tick failed:", err);
  }
}

export function startSyncScheduler(): void {
  if (started) return;
  if (!enabled()) {
    console.log("[hearth] sync scheduler disabled (SYNC_ENABLED=false)");
    return;
  }
  started = true;

  const period = intervalMs();
  console.log(`[hearth] sync scheduler started, every ${period / 1000}s`);

  const loop = async () => {
    await tick();
    timer = setTimeout(loop, period);
    // Do not hold the event loop open on account of the timer alone; the HTTP
    // server is what keeps the process alive.
    timer.unref?.();
  };

  // Delay the first run so it does not compete with boot-time migrations and the
  // first requests.
  timer = setTimeout(loop, 15_000);
  timer.unref?.();
}

export function stopSyncScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
