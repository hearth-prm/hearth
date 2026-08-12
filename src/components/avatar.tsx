import { photoUrl } from "@/lib/photos";
import type { EffectivePhoto } from "@/lib/photos-db";

/**
 * A contact's picture, or their initials.
 *
 * Initials rather than a generic silhouette: in a list of two hundred contacts the
 * silhouette is noise repeated two hundred times, whereas initials still distinguish
 * one row from another. The colour is derived from the name so it stays put between
 * renders and gives the eye something to latch onto.
 */
const tones = [
  "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200",
  "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200",
  "bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200",
  "bg-teal-200 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  "bg-sky-200 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  "bg-indigo-200 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  "bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  "bg-pink-200 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
];

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return tones[Math.abs(hash) % tones.length]!;
}

const sizes = {
  sm: "size-8 text-xs",
  md: "size-12 text-sm",
  lg: "size-24 text-2xl",
} as const;

export function Avatar({
  personId,
  name,
  photo,
  size = "sm",
}: {
  personId: string;
  name: string;
  photo?: EffectivePhoto | null;
  size?: keyof typeof sizes;
}) {
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${sizes[size]}`;

  if (photo) {
    return (
      // A plain img, not next/image: the bytes are served by our own authenticated
      // route, and the optimiser would need to fetch them as an anonymous client.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl(personId, photo.etag)}
        alt={name}
        width={photo.width}
        height={photo.height}
        loading="lazy"
        className={`${base} bg-neutral-100 object-cover dark:bg-neutral-800`}
      />
    );
  }

  return (
    <span className={`${base} ${toneFor(name)} font-medium`} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

/** The signed-in user's own picture, from their Google profile. */
export function UserAvatar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={image}
        alt=""
        width={28}
        height={28}
        className="size-7 shrink-0 rounded-full bg-neutral-100 object-cover dark:bg-neutral-800"
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${toneFor(name)}`}
    >
      {initialsOf(name)}
    </span>
  );
}
