/**
 * Who may see everybody's outstanding thank-yous.
 *
 * A role, but not a column. `HEARTH_SUPER_USERS` names the addresses, exactly as
 * `HEARTH_ALLOWED_EMAILS` names who may sign in — and for the same reasons: it is right on
 * first boot without anybody running SQL, it survives a database restore, it cannot be
 * locked out by losing access to the thing that would grant it, and there is no stored copy
 * to drift from what somebody last clicked. The role's only power is a page, so a column on
 * User would be state to keep correct in exchange for nothing.
 *
 * ## Whole addresses only, deliberately
 *
 * Unlike the sign-in allowlist, `@domain` is NOT accepted here. A domain in the allowlist
 * means "my family's addresses may join", which is a sensible thing to say. A domain here
 * would mean "everyone at gmail.com can read every household's thank-yous", which is not a
 * thing anybody means to say and would be easy to type by accident.
 *
 * Pure, and tested without a database, because the alternative is proving a permission
 * through a browser.
 */

/** Parse the variable. Whole addresses, lowercased; anything without an @ is dropped. */
export function parseSuperUsers(raw: string | undefined | null): string[] {
  return (
    (raw ?? "")
      // Commas or whitespace: a shell export, a compose file and a .env line each separate
      // things differently and none of them is worth being strict about.
      .split(/[,\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      // An @domain entry is dropped rather than honoured — see above. A bare word is dropped
      // for the same reason a bare word is not an address.
      .filter((entry) => entry.includes("@") && !entry.startsWith("@"))
  );
}

export function superUsersFromEnv(): string[] {
  return parseSuperUsers(process.env.HEARTH_SUPER_USERS);
}

export function isSuperUserEmail(
  email: string | null | undefined,
  entries: readonly string[] = superUsersFromEnv(),
): boolean {
  const address = (email ?? "").trim().toLowerCase();
  if (!address.includes("@")) return false;
  return entries.includes(address);
}
