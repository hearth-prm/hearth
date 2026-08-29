/**
 * Who may sign in.
 *
 * Hearth had no answer to this at all, and did not need one while the Google OAuth app was in
 * "Testing": Google's own test-user list was the allowlist, and only accounts on it could
 * consent. Publishing the app removed that gate silently — after which any Google account
 * that reached the sign-in page became a user of the install, got a contact card, and through
 * the card sharing every household member's card with it.
 *
 * That is the shape of a whole class of self-hosting bug: a control that exists in one
 * environment by accident and in nobody else's. So the rule is written down here, in a pure
 * module that can be tested without a database or a browser.
 *
 * ## The rule
 *
 *   1. Somebody who ALREADY has an account may always sign in.
 *   2. If the install has no users at all, the first sign-in claims it.
 *   3. Otherwise the address must match HEARTH_ALLOWED_EMAILS.
 *   4. Otherwise it is refused, with a message naming the variable.
 *
 * Rule 1 is deliberate and is not a hole: it means a typo in the variable cannot lock the
 * operator out of their own install, which is a far more likely disaster than admitting
 * somebody who already has an account. Removing a person's access means removing the person,
 * not editing an environment variable.
 *
 * Rule 2 is how every self-hosted app bootstraps, and it leaves a window on a fresh install
 * between first boot and first sign-in. Setting HEARTH_ALLOWED_EMAILS before first boot closes
 * it, which the README says.
 */

/** One entry: a whole address, or `@domain` for anyone at that domain. */
export type AllowEntry = string;

export function parseAllowlist(raw: string | undefined | null): AllowEntry[] {
  return (raw ?? "")
    // Commas, whitespace and newlines all separate, because a value pasted from a list, a
    // shell export or a compose file arrives differently every time and none of them is
    // wrong.
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function allowlistPermits(entries: readonly AllowEntry[], email: string): boolean {
  const address = email.trim().toLowerCase();
  if (!address.includes("@")) return false;
  const domain = address.slice(address.indexOf("@"));
  return entries.some((entry) => entry === address || entry === domain);
}

export function allowlistFromEnv(): AllowEntry[] {
  return parseAllowlist(process.env.HEARTH_ALLOWED_EMAILS);
}

/** What to do about one sign-in attempt, given what the install already knows. */
export type SignInVerdict =
  | { allow: true; reason: "existing-user" | "first-user" | "allowlisted" }
  | { allow: false; reason: "no-email" | "not-allowed" };

export function decideSignIn(input: {
  email: string | null | undefined;
  /** Whether this address already has an account here. */
  isExistingUser: boolean;
  /** Whether the install has any users at all. */
  hasAnyUser: boolean;
  entries: readonly AllowEntry[];
}): SignInVerdict {
  if (!input.email) return { allow: false, reason: "no-email" };
  if (input.isExistingUser) return { allow: true, reason: "existing-user" };
  if (!input.hasAnyUser) return { allow: true, reason: "first-user" };
  if (allowlistPermits(input.entries, input.email)) {
    return { allow: true, reason: "allowlisted" };
  }
  return { allow: false, reason: "not-allowed" };
}
