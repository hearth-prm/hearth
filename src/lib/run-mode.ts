/**
 * Whether this install is a development copy or the real one.
 *
 * `HEARTH_ENV=development` means: run everything, right up to the moment something would
 * leave for Google, and stop it there. The contact push builds its payloads, the calendar
 * push resolves its attendees, the thank-you dialog opens and composes a real MIME message
 * — and the outbound call is the only thing that does not happen. Everything downstream of
 * it behaves as though it had, so a dev stack can be used rather than merely started.
 *
 * ## Why not disable the features instead
 *
 * That is what this replaces. A test stack used to hide the "write thank you" link and skip
 * the sync outright, which made the safest half of the app the only half you could not
 * exercise — and the reported bug was somebody clicking a link that had been quietly turned
 * off. Blocking at the door tests more than locking the building.
 *
 * ## Which way it fails
 *
 * UNSET means production, because every install that predates this variable must keep
 * sending. But a value that is SET and not understood means development, which is the
 * opposite of how `HEARTH_ALLOWED_EMAILS` and the old write switch fail. The direction
 * follows the consequence rather than a convention: a production install that stops sending
 * is visible and annoying, while a dev stack that starts sending emails real people from a
 * copy of real data. When somebody was clearly trying to say something and it cannot be
 * read, the safe reading is the one that cannot reach anybody.
 */
export type RunMode = "development" | "production";

const DEV_WORDS = ["development", "dev", "devel", "test", "staging"];
const PROD_WORDS = ["production", "prod", "live"];

export function runMode(): RunMode {
  const raw = (process.env.HEARTH_ENV ?? "").trim().toLowerCase();
  if (raw === "") return "production";
  if (PROD_WORDS.includes(raw)) return "production";
  if (DEV_WORDS.includes(raw)) return "development";
  // Said once per call rather than at import, because the environment is read per request
  // and a warning that only fires at boot is a warning nobody sees in a log they tail later.
  console.warn(
    `[hearth] HEARTH_ENV="${raw}" is not a value I understand. Treating this as a development install, which means NOTHING will be sent to Google. Set HEARTH_ENV=production to send.`,
  );
  return "development";
}

export function isDevelopment(): boolean {
  return runMode() === "development";
}

/** Said the same way wherever a simulated send is reported. */
export const DEV_NOT_SENT =
  "development mode — nothing actually went to Google";
