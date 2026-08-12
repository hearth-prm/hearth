/**
 * Google OAuth scopes Hearth asks for, and why.
 *
 * Requested up front at sign-in so the sync features work without a second
 * consent round-trip. Granular scopes are used in preference to the blanket
 * `.../auth/calendar` so a compromised token cannot delete calendars.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",

  // Read/write access to the user's own contacts. Needed for the one-way
  // PRM -> Google Contacts push, including deleting contacts that were synced
  // and then opted out.
  "https://www.googleapis.com/auth/contacts",

  // Create/update/delete events and manage their attendee lists.
  "https://www.googleapis.com/auth/calendar.events",

  // List the user's calendars so Settings can offer a target-calendar picker.
  // Read-only: Hearth never creates or modifies calendars themselves.
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "https://www.googleapis.com/auth/contacts": "Manage your Google Contacts",
  "https://www.googleapis.com/auth/calendar.events": "Manage events on your calendars",
  "https://www.googleapis.com/auth/calendar.readonly": "See your list of calendars",
};

/** Scopes that must be present for contact sync to be possible. */
export const CONTACT_SYNC_SCOPES = ["https://www.googleapis.com/auth/contacts"];

/** Scopes that must be present for calendar sync to be possible. */
export const CALENDAR_SYNC_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
];

/**
 * Google's shorthand scopes, and the canonical form it grants them as.
 *
 * `email` and `profile` are accepted on an authorisation request but come back
 * expanded in the token response, so comparing a request against a grant as plain
 * strings reports them missing when they were granted. Anything not listed here is
 * already canonical.
 */
const SCOPE_ALIASES: Record<string, string> = {
  email: "https://www.googleapis.com/auth/userinfo.email",
  profile: "https://www.googleapis.com/auth/userinfo.profile",
};

export function canonicalScope(scope: string): string {
  return SCOPE_ALIASES[scope] ?? scope;
}

/**
 * Whether a stored Account grant covers every scope in `required`.
 *
 * Users who signed in before a scope was added will hold an older grant, so the
 * UI checks this and prompts a reconnect instead of failing at call time.
 *
 * Both sides are canonicalised, which is a no-op for the full-URL scopes this is
 * called with today but stops the shorthand forms from reading as ungranted.
 */
export function grantCovers(
  grantedScope: string | null | undefined,
  required: readonly string[],
): boolean {
  if (!grantedScope) return false;
  const granted = new Set(
    grantedScope.split(/\s+/).filter(Boolean).map(canonicalScope),
  );
  return required.every((s) => granted.has(canonicalScope(s)));
}

/** Scopes in `required` that a grant does not cover. */
export function missingScopes(
  grantedScope: string | null | undefined,
  required: readonly string[],
): string[] {
  const granted = new Set(
    (grantedScope ?? "").split(/\s+/).filter(Boolean).map(canonicalScope),
  );
  return required.filter((s) => !granted.has(canonicalScope(s)));
}
