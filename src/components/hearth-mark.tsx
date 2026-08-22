/**
 * Hearth's mark: a fire in a fireplace opening.
 *
 * The same drawing as `src/app/icon.svg`, which is the browser tab. Two copies of the
 * geometry rather than one, because a favicon is a static file with no CSS context and this
 * one has to inherit `currentColor` — so they cannot be the same file. Change one and change
 * the other; there is nothing clever protecting that.
 *
 * `currentColor` is the point. The tab icon is stuck with the teal Hearth ships with, while
 * this follows whatever accent the person reading it chose, because the caller sets the text
 * colour and the paths take it from there.
 *
 * Rounded top corners rather than a semicircular arch: an arch reads as a headstone once it
 * is 16px across, where a squarer opening still reads as a fireplace. The flame's curl is on
 * one side only for the same reason a teardrop is not a flame — the asymmetry is what makes
 * it fire, and the silhouette carries it after the inner lobe has closed up.
 */
export function HearthMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke="currentColor"
      aria-hidden
      focusable="false"
    >
      <path
        d="M4.4 26.2V12A5.9 5.9 0 0 1 10.3 6.1h11.4a5.9 5.9 0 0 1 5.9 5.9v14.2"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M2.4 28.9h27.2" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M16.6 10.4c2.4 3.5 5.3 5.3 5.3 9.2a5.5 5.5 0 0 1-11 0c0-2 .9-3.5 2.1-4.9.3 1.1 1 1.8 1.9 2.1-.9-2.8-.4-5.1 1.7-6.4z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
