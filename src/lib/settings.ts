import type { UserSettings } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CALENDAR_SYNC_SCOPES, CONTACT_SYNC_SCOPES, grantCovers } from "@/lib/google/scopes";

/**
 * Read a user's settings, creating the default row on first access.
 *
 * Upsert rather than a plain read because the row is normally created by the
 * Auth.js `createUser` event, and we must not depend on that having succeeded
 * (or on users created before the event existed).
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  return prisma.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export interface GoogleConnection {
  connected: boolean;
  /** Google account email, when we have it. */
  email: string | null;
  /** A refresh token is required for background sync to survive token expiry. */
  hasRefreshToken: boolean;
  canSyncContacts: boolean;
  canSyncCalendar: boolean;
  /** True when the stored grant is missing scopes we now need. */
  needsReconnect: boolean;
  grantedScopes: string[];
}

export async function getGoogleConnection(userId: string): Promise<GoogleConnection> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true, refresh_token: true },
  });

  if (!account) {
    return {
      connected: false,
      email: null,
      hasRefreshToken: false,
      canSyncContacts: false,
      canSyncCalendar: false,
      needsReconnect: true,
      grantedScopes: [],
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  const canSyncContacts = grantCovers(account.scope, CONTACT_SYNC_SCOPES);
  const canSyncCalendar = grantCovers(account.scope, CALENDAR_SYNC_SCOPES);

  return {
    connected: true,
    email: user?.email ?? null,
    hasRefreshToken: Boolean(account.refresh_token),
    canSyncContacts,
    canSyncCalendar,
    needsReconnect: !canSyncContacts || !canSyncCalendar || !account.refresh_token,
    grantedScopes: (account.scope ?? "").split(/\s+/).filter(Boolean),
  };
}
