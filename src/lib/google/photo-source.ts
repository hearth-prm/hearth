import type { GooglePerson } from "./people-client";

/**
 * Where a Google contact's picture can be found, if it has one.
 *
 * Pure, and separate from the fetching, for the usual reason: deciding which URL is the
 * picture is worth testing exhaustively, and doing it needs the network.
 *
 * Two sources, because a real address book has both. Most contacts carry a `photos` entry;
 * a contact that arrived through Google's own CSV import may instead carry the URL in a
 * custom field called "Photo", which is what Google's exporter writes. On the account this
 * was built against, 28 contacts had a real photo, 63 had the custom field, and 41 of those
 * had ONLY the custom field — so ignoring either source would have lost pictures.
 */

/**
 * Google gives every contact a `photos` entry, including the grey silhouette it generates
 * for contacts with no picture, flagged `default: true`. Importing those would give three
 * hundred contacts the same meaningless avatar and hide the initials Hearth draws instead.
 */
function realPhotoUrl(person: GooglePerson): string | null {
  const photo = (person.photos ?? []).find((p) => !p.default && p.url);
  return photo?.url ?? null;
}

/** The key Google's CSV exporter uses. Matched case-insensitively; people retype it. */
export function isPhotoField(key: string | null | undefined): boolean {
  return (key ?? "").trim().toLowerCase() === "photo";
}

function customFieldPhotoUrl(person: GooglePerson): string | null {
  const field = (person.userDefined ?? []).find((u) => isPhotoField(u.key));
  const value = (field?.value ?? "").trim();
  return /^https?:\/\//i.test(value) ? value : null;
}

export function photoSourceFor(person: GooglePerson): string | null {
  return realPhotoUrl(person) ?? customFieldPhotoUrl(person);
}

/**
 * Ask Google for a bounded version of the picture.
 *
 * Contact photos are served from googleusercontent, which resizes on demand through the
 * `=s<pixels>` suffix. That is what makes importing a picture possible at all without an
 * image decoder on the server: Hearth's own uploads are resized in the browser before they
 * arrive, and there is no browser here. Asking Google for 512px gets back something already
 * the right shape and comfortably inside the size limit.
 *
 * A URL from anywhere else is fetched as-is and validated like any upload; if it is too
 * large or not a JPEG or PNG, it is refused rather than resized.
 */
export function sizedPhotoUrl(url: string, edge: number): string {
  if (!/googleusercontent\.com/i.test(url)) return url;
  // Google's own suffixes are separated from the path by "=", and a URL may already carry
  // one (=s100, =c, ...). Replacing it rather than appending avoids "=s100=s512", which
  // Google rejects.
  const base = url.split("=")[0]!;
  return `${base}=s${edge}`;
}
