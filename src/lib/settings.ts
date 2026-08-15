import type { UserSettings } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CALENDAR_SYNC_SCOPES,
  CONTACT_SYNC_SCOPES,
  MAIL_SEND_SCOPES,
  grantCovers,
} from "@/lib/google/scopes";
import { normalizeAppearance, type Appearance } from "@/lib/theme";

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

/**
 * Just the appearance columns, and deliberately without the upsert above.
 *
 * The root layout needs these on every single request, and issuing a write per page
 * view to guarantee a row exists is a bad trade when the absence of one already means
 * exactly "use the defaults".
 */
export async function getAppearance(userId: string): Promise<Appearance> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      theme: true,
      lightColorScheme: true,
      lightAccentHue: true,
      darkColorScheme: true,
      darkAccentHue: true,
    },
  });
  return normalizeAppearance(row);
}

export interface GoogleConnection {
  connected: boolean;
  /** Google account email, when we have it. */
  email: string | null;
  /** A refresh token is required for background sync to survive token expiry. */
  hasRefreshToken: boolean;
  canSyncContacts: boolean;
  canSyncCalendar: boolean;
  /** Whether a thank-you list can be emailed. */
  canSendMail: boolean;
  /** True when the stored grant is missing scopes we now need. */
  needsReconnect: boolean;
  grantedScopes: string[];
}

export async function getGoogleConnection(
  userId: string,
): Promise<GoogleConnection> {
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
      canSendMail: false,
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
  const canSendMail = grantCovers(account.scope, MAIL_SEND_SCOPES);

  return {
    connected: true,
    email: user?.email ?? null,
    hasRefreshToken: Boolean(account.refresh_token),
    canSyncContacts,
    canSyncCalendar,
    canSendMail,
    needsReconnect:
      !canSyncContacts || !canSyncCalendar || !canSendMail || !account.refresh_token,
    grantedScopes: (account.scope ?? "").split(/\s+/).filter(Boolean),
  };
}
