import { prisma } from "@/lib/db";

/** The fields a provider hands back that are worth keeping. */
export interface GoogleGrant {
  scope?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  id_token?: string | null;
}

/**
 * Write a fresh Google grant onto the existing Account row.
 *
 * Auth.js's Prisma adapter creates that row when an account is first linked and never
 * touches it again — there is no updateAccount in the adapter interface. So re-consenting
 * to gain a new scope changed what Google would allow while Hearth went on reading the
 * scope list it stored months earlier. Every permission check is made against that
 * column, so "Reconnect Google" appeared to do nothing at all, however many times it was
 * pressed. This is what makes reconnecting mean something.
 *
 * A missing refresh_token is left alone rather than written as null: Google returns one
 * only when consent is actually re-prompted, and overwriting a good token with nothing
 * would break background sync — a far worse outcome than the stale scope this fixes.
 *
 * Also clears any recorded auth failure, since a grant that has just succeeded
 * supersedes whatever the last one reported.
 */
export async function persistGoogleGrant(
  userId: string,
  grant: GoogleGrant,
): Promise<void> {
  // Clearing the recorded failure belongs here rather than being imported from
  // google/auth.ts, and not only for tidiness: that module pulls in googleapis, and
  // src/lib/auth.ts is reachable from a client component through access.ts, so the edge
  // dragged the whole Node-only SDK into a browser bundle and the build refused it.
  // This file imports nothing but Prisma, which is what keeps it safe to reach from
  // the auth config.
  await prisma.userSettings.updateMany({
    where: { userId, googleAuthError: { not: null } },
    data: { googleAuthError: null, googleAuthErrorAt: null },
  });

  await prisma.account.updateMany({
    where: { userId, provider: "google" },
    data: {
      // Prisma skips undefined, so absent fields leave the column as it was.
      scope: grant.scope ?? undefined,
      access_token: grant.access_token ?? undefined,
      expires_at: grant.expires_at ?? undefined,
      token_type: grant.token_type ?? undefined,
      id_token: grant.id_token ?? undefined,
      ...(grant.refresh_token ? { refresh_token: grant.refresh_token } : {}),
    },
  });
}
