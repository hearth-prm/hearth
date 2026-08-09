/**
 * Place search, behind a provider interface.
 *
 * Two implementations: OpenStreetMap's Nominatim, which needs no key and no
 * billing, and Google Places, which gives better suggestions for small venues but
 * requires a key. Both resolve to the same shape and both write a plain address
 * string into the event's existing `location` column, so switching provider — or
 * removing search entirely — never migrates data or strands an event.
 */

export interface PlaceSuggestion {
  /** Provider-local identifier; only used as a React key. */
  id: string;
  /** What to show first: a venue name where there is one. */
  label: string;
  /** The full address, and exactly what gets stored on the event. */
  address: string;
}

export interface PlacesProvider {
  readonly name: string;
  search(query: string): Promise<PlaceSuggestion[]>;
}

export const MAX_SUGGESTIONS = 8;

/**
 * Short-lived shared cache.
 *
 * Typing "olbrich" issues a request for the debounced prefixes on the way, and
 * backspacing re-issues ones already asked. Caching by query costs almost nothing
 * and is the difference between courteous and abusive use of a free service.
 */
const cache = new Map<string, { at: number; hits: PlaceSuggestion[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;

export function cached(key: string): PlaceSuggestion[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.hits;
}

export function putCached(key: string, hits: PlaceSuggestion[]): void {
  if (cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest insertion. Map preserves insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), hits });
}

/**
 * Serialise upstream calls with a minimum gap between them.
 *
 * Nominatim's usage policy is one request per second per application, and client
 * debouncing alone cannot enforce that: several users, or one user in two tabs,
 * would each debounce independently. Doing it here makes the limit a property of
 * the server rather than a hope about the browser.
 */
export function createThrottle(minGapMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {
      const wait = Math.max(0, lastAt + minGapMs - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      return fn();
    });
    // Keep the chain alive even when a call rejects, or one failure would wedge
    // every later request behind a permanently rejected promise.
    tail = run.catch(() => undefined);
    return run as Promise<T>;
  };
}
