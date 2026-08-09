import { createGooglePlacesProvider } from "./google";
import { createNominatimProvider } from "./nominatim";
import type { PlacesProvider } from "./provider";

export type { PlaceSuggestion, PlacesProvider } from "./provider";
export { cached, putCached } from "./provider";

export type ProviderChoice = "auto" | "osm" | "google" | "off";

export const PROVIDER_CHOICES: ProviderChoice[] = ["auto", "osm", "google", "off"];

export function googlePlacesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY);
}

export function isProviderChoice(value: string): value is ProviderChoice {
  return (PROVIDER_CHOICES as string[]).includes(value);
}

/**
 * Resolve the setting to an actual provider, or null when search is unavailable.
 *
 * "auto" prefers Google when a key exists and falls back to OpenStreetMap, so an
 * install works out of the box and improves by adding a key — no setting to change
 * and no rebuild. Choosing "google" without a key falls back rather than failing:
 * a missing key should degrade the location field, not break event editing.
 */
export function resolvePlacesProvider(choice: string): PlacesProvider | null {
  const key = process.env.GOOGLE_PLACES_API_KEY;

  switch (choice) {
    case "off":
      return null;
    case "osm":
      return createNominatimProvider();
    case "google":
      return key ? createGooglePlacesProvider(key) : createNominatimProvider();
    default:
      return key ? createGooglePlacesProvider(key) : createNominatimProvider();
  }
}

/** What the settings page shows as currently active. */
export function describeActiveProvider(choice: string): string {
  const provider = resolvePlacesProvider(choice);
  if (!provider) return "Place search is off";
  if (choice === "google" && !googlePlacesConfigured()) {
    return "OpenStreetMap (GOOGLE_PLACES_API_KEY is not set, so Google Places is unavailable)";
  }
  if (choice === "auto") {
    return googlePlacesConfigured()
      ? "Google Places (a key is configured)"
      : "OpenStreetMap (set GOOGLE_PLACES_API_KEY to use Google Places)";
  }
  return provider.name;
}
