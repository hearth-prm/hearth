import { embeddingConfigured, embeddingModel } from "./embed";
import { indexPending } from "./indexer";

/**
 * In-process periodic embedding, in the same shape as the sync scheduler.
 *
 * A separate loop rather than a pass inside the sync tick, because the two are not the same
 * decision: somebody may run Hearth with no Google account at all and still want semantic
 * search, and somebody syncing every thirty seconds does not want three hundred documents
 * re-hashed that often. SYNC_ENABLED=false must not turn the search index off.
 *
 * OLLAMA_URL is the only switch. Unset, this logs nothing and does nothing — the feature is
 * not configured, which is different from being broken.
 *
 * setTimeout chained after each pass rather than setInterval, for the reason the sync
 * scheduler gives: an interval fires again while a slow pass is still running.
 */

const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 30;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function intervalMs(): number {
  const raw = Number.parseInt(process.env.SEARCH_INDEX_INTERVAL_SECONDS ?? "", 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_SECONDS;
  return Math.max(seconds, MIN_INTERVAL_SECONDS) * 1000;
}

async function tick(): Promise<void> {
  try {
    const run = await indexPending();
    if (run.message) {
      // Worth a line even though the ordinary search still works: a silent index that never
      // fills is the failure this feature is most likely to have.
      console.warn(`[hearth] search index: ${run.message}`);
      return;
    }
    if (run.embedded > 0 || run.removed > 0) {
      console.log(
        `[hearth] search index: ${run.embedded} embedded, ${run.removed} cleared, ${run.remaining} to go`,
      );
    }
  } catch (err) {
    // Never let a failure kill the loop.
    console.error("[hearth] search index pass failed:", err);
  }
}

export function startSearchIndexer(): void {
  if (started) return;
  if (!embeddingConfigured()) return;
  started = true;

  const period = intervalMs();
  console.log(
    `[hearth] search index started, every ${period / 1000}s, model ${embeddingModel()}`,
  );

  const loop = async () => {
    await tick();
    timer = setTimeout(loop, period);
    timer.unref?.();
  };

  // Later than the sync scheduler's first run: the first pass on a real address book is a few
  // hundred documents, and boot is the worst moment to ask for that.
  timer = setTimeout(loop, 30_000);
  timer.unref?.();
}

export function stopSearchIndexer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}
