import { MAX_SUGGESTIONS, type PlaceSuggestion, type PlacesProvider } from "./provider";

/**
 * Google Places, via Text Search rather than Autocomplete.
 *
 * Autocomplete returns predictions without an address, so filling the location
 * field would need a second Place Details call per selection. Text Search returns
 * displayName and formattedAddress together, which is one round trip and one
 * billable request instead of two.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

interface TextSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
  }>;
}

export function createGooglePlacesProvider(apiKey: string): PlacesProvider {
  return {
    name: "Google Places",
    async search(query) {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          // Billing is per requested field, so ask for exactly what is displayed
          // and stored — nothing more.
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
        },
        body: JSON.stringify({ textQuery: query, pageSize: MAX_SUGGESTIONS }),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Google Places returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
      }

      const data = (await res.json()) as TextSearchResponse;
      return (data.places ?? [])
        .map((p): PlaceSuggestion | null => {
          const address = p.formattedAddress?.trim();
          if (!address) return null;
          return {
            id: p.id ?? address,
            label: p.displayName?.text?.trim() || address.split(",")[0]!.trim(),
            address,
          };
        })
        .filter((s): s is PlaceSuggestion => s !== null);
    },
  };
}
