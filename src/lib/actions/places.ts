"use server";

import { requireUserForAction } from "@/lib/access";
import { getUserSettings } from "@/lib/settings";
import {
  cached,
  putCached,
  resolvePlacesProvider,
  type PlaceSuggestion,
} from "@/lib/places";

export type PlaceSearchResult =
  | { status: "ok"; suggestions: PlaceSuggestion[]; provider: string }
  /** Search is switched off, or no provider is available. */
  | { status: "off" }
  | { status: "error"; message: string };

const MIN_QUERY = 3;

/**
 * Look up places for the event location field.
 *
 * Runs server-side so the provider's key — when there is one — never reaches the
 * browser, and so the rate limiting and caching in the places layer apply per
 * install rather than per tab.
 */
export async function searchPlaces(query: string): Promise<PlaceSearchResult> {
  const user = await requireUserForAction();
  const q = query.trim();
  // Short fragments match half the planet and burn quota for no benefit.
  if (q.length < MIN_QUERY) return { status: "ok", suggestions: [], provider: "" };

  const settings = await getUserSettings(user.id);
  const provider = resolvePlacesProvider(settings.placesProvider);
  if (!provider) return { status: "off" };

  const key = `${provider.name}:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return { status: "ok", suggestions: hit, provider: provider.name };

  try {
    const suggestions = await provider.search(q);
    putCached(key, suggestions);
    return { status: "ok", suggestions, provider: provider.name };
  } catch (err) {
    // Never let a lookup failure block saving an event: the field is plain text
    // and typing an address by hand must always work.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[hearth] place search failed (${provider.name}):`, message);
    return { status: "error", message };
  }
}
