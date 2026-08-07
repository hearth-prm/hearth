import data from "./relationship-types.json";

/**
 * Built-in relationship types, seeded with ownerId = null so every user sees
 * them.
 *
 * The data lives in a sibling .json file so that prisma/seed.mjs — plain Node
 * ESM, run by the container entrypoint before the app starts — can import the
 * exact same list without needing a TypeScript loader in the runtime image.
 *
 * `label` reads from -> to; `inverseLabel` reads to -> from. Symmetric types
 * carry no direction, so both read the same and the UI does not offer a
 * "swap direction" control for them.
 */
export interface SystemRelationshipType {
  key: string;
  label: string;
  inverseLabel: string;
  symmetric: boolean;
  order: number;
}

export const SYSTEM_RELATIONSHIP_TYPES: readonly SystemRelationshipType[] = data;
