import { APP_VERSION } from "@/lib/version";
import {
  createThrottle,
  MAX_SUGGESTIONS,
  type PlaceSuggestion,
  type PlacesProvider,
} from "./provider";

/**
 * OpenStreetMap / Nominatim. No key, no billing, no account.
 *
 * Their usage policy asks for an identifying User-Agent and no more than one
 * request a second, both of which are honoured here. That politeness is the price
 * of a free service and is not optional: unidentified high-rate clients get
 * blocked, and the block would land on the whole install.
 */
const ENDPOINT = "https://nominatim.openstreetmap.org/search";
const throttle = createThrottle(1100);

interface NominatimResult {
  place_id?: number;
  name?: string;
  display_name?: string;
  type?: string;
}

export function createNominatimProvider(): PlacesProvider {
  return {
    name: "OpenStreetMap",
    async search(query) {
      const url = new URL(ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", String(MAX_SUGGESTIONS));

      const res = await throttle(() =>
        fetch(url, {
          headers: {
            // Required by the usage policy: it must identify the application.
            "User-Agent": `Hearth/${APP_VERSION} (self-hosted PRM)`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(8000),
        }),
      );

      if (!res.ok) {
        throw new Error(`Nominatim returned ${res.status}`);
      }

      const results = (await res.json()) as NominatimResult[];
      return results
        .map((r): PlaceSuggestion | null => {
          const address = r.display_name?.trim();
          if (!address) return null;
          // display_name leads with the venue when there is one, so a separate
          // name would just repeat the first comma-separated part.
          const label = r.name?.trim() || address.split(",")[0]!.trim();
          return { id: String(r.place_id ?? address), label, address };
        })
        .filter((s): s is PlaceSuggestion => s !== null);
    },
  };
}
