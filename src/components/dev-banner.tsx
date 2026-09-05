/**
 * A development install, said in a way that cannot scroll away.
 *
 * There is already a pill in the header, but the header is not sticky — on a contact list
 * or a long event page it is gone after one flick of the wheel, and an indicator whose
 * whole job is "do not mistake this for the real install" cannot be one you have to scroll
 * back up to check.
 *
 * ## The choices, and why
 *
 * `fixed` to the TOP edge, because the other edges are taken: the bulk-action bar is
 * `sticky bottom-0` and the footer carries the version stamp, so a bottom strip would
 * either cover one or be covered by it.
 *
 * Diagonal stripes rather than a solid bar, because a solid coloured line pinned to the top
 * of a page is the universal shape of a loading indicator and would be read as one. Caution
 * tape is not ambiguous.
 *
 * `pointer-events-none`, so it cannot eat a click aimed at whatever is beneath it, and
 * `aria-hidden` with the real explanation left on the header pill — a screen reader
 * announcing "decorative stripe" on every page is noise, and the pill says it in words.
 *
 * Rendered OUTSIDE the signed-in check, unlike the pill. The sign-in page is exactly where
 * somebody is least sure which install they are looking at.
 */
/**
 * The classes, as a constant, because they are the whole behaviour.
 *
 * `fixed` is what makes it survive scrolling, `pointer-events-none` is what stops it eating
 * a click, and `inset-x-0` rather than a width is what keeps it from widening the page —
 * §22 measures sideways overflow and would not catch this, because the suite's server runs
 * in production and never renders it. Exported so §39.7 can assert on them: JSX in the test
 * process would need a React runtime the root tsconfig does not set up, and changing that
 * to make a check easier would be a build-affecting change for a test's convenience.
 */
export const DEV_BANNER_CLASS =
  "pointer-events-none fixed inset-x-0 top-0 z-50 h-1.5";

export function DevBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      aria-hidden="true"
      className={DEV_BANNER_CLASS}
      style={{
        // Inline, not a Tailwind arbitrary value: the stripe angle and the two stops read
        // as one thing here, and this is the only place in the app that wants them.
        backgroundImage:
          "repeating-linear-gradient(45deg, #f59e0b 0 8px, #78350f 8px 16px)",
      }}
    />
  );
}
