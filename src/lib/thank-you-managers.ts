/**
 * The thank-you managers: who keeps track of the household's letters.
 *
 * Two powers, and only two. A manager sees EVERY user's outstanding thank-yous on the
 * Thank-yous page rather than just their own, and may WRITE a note for anybody who ticked
 * "let a thank-you manager write mine" in their settings. Nothing else: not contacts, not
 * events, not settings, not the sign-in allowlist.
 *
 * The writing half used to belong to the head of the household. It moved because the two
 * jobs are not the same job — the head owns the household's contact cards and can hand that
 * over, which is about custody of records, while chasing unwritten letters is an errand
 * somebody volunteers for. Tying the second to the first meant you could not have one
 * without the other.
 *
 * A role, but not a column. `HEARTH_THANK_YOU_MANAGERS` names the addresses, exactly as
 * `HEARTH_ALLOWED_EMAILS` names who may sign in — and for the same reasons: it is right on
 * first boot without anybody running SQL, it survives a database restore, it cannot be
 * locked out by losing access to the thing that would grant it, and there is no stored copy
 * to drift from what somebody last clicked. The role is two grants and no records of its own, so a column on User would be
 * state to keep correct in exchange for nothing.
 *
 * ## Whole addresses only, deliberately
 *
 * Unlike the sign-in allowlist, `@domain` is NOT accepted here. A domain in the allowlist
 * means "my family's addresses may join", which is a sensible thing to say. A domain here
 * would mean "everyone at gmail.com can read and write every household's thank-yous", which is not a
 * thing anybody means to say and would be easy to type by accident.
 *
 * Pure, and tested without a database, because the alternative is proving a permission
 * through a browser.
 */

/** Parse the variable. Whole addresses, lowercased; anything without an @ is dropped. */
export function parseThankYouManagers(raw: string | undefined | null): string[] {
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

export function thankYouManagersFromEnv(): string[] {
  return parseThankYouManagers(process.env.HEARTH_THANK_YOU_MANAGERS);
}

export function isThankYouManagerEmail(
  email: string | null | undefined,
  entries: readonly string[] = thankYouManagersFromEnv(),
): boolean {
  const address = (email ?? "").trim().toLowerCase();
  if (!address.includes("@")) return false;
  return entries.includes(address);
}
