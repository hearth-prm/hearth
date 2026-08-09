import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleAuthError, recordAuthError } from "@/lib/google/auth";
import { createPeopleClient } from "@/lib/google/people-client";
import { CONTACT_SYNC_SCOPES, grantCovers } from "@/lib/google/scopes";
import { withSyncLease } from "./lease";
import { summarise, syncContactsForUser, type ContactSyncResult } from "./contacts";

/**
 * Wraps the push engine with everything it should not have to know about:
 * whether the user enabled sync, whether the grant covers contacts, holding the
 * lease, and recording the outcome for the settings page.
 */

export type RunOutcome =
  | { status: "ok"; result: ContactSyncResult; summary: string }
  | { status: "skipped"; reason: string }
  /** Another run holds the lease. */
  | { status: "busy" }
  /** The Google grant is dead; the user must reconnect. */
  | { status: "auth"; message: string }
  | { status: "error"; message: string };

/**
 * How long to leave a known-broken grant alone.
 *
 * Sync must keep re-attempting eventually, because a successful call is the only
 * thing that clears the error — but retrying every cycle would spend calls on a
 * request that cannot succeed until a human intervenes.
 */
const AUTH_ERROR_COOLDOWN_MS = 15 * 60 * 1000;

export interface RunOptions {
  /** Ignore the auth-error cooldown. Set for a manual "Sync now". */
  force?: boolean;
  batchSize?: number;
}

export async function runContactSyncForUser(
  userId: string,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      syncContactsEnabled: true,
      googleAuthError: true,
      googleAuthErrorAt: true,
    },
  });

  if (!settings) return { status: "skipped", reason: "no settings for this user" };
  if (!settings.syncContactsEnabled) {
    return { status: "skipped", reason: "contact sync is turned off" };
  }

  if (
    !options.force &&
    settings.googleAuthError &&
    settings.googleAuthErrorAt &&
    Date.now() - settings.googleAuthErrorAt.getTime() < AUTH_ERROR_COOLDOWN_MS
  ) {
    return { status: "auth", message: settings.googleAuthError };
  }

  // Check the grant before spending a token refresh on it. A user who signed in
  // before the contacts scope was requested has a perfectly valid token that
  // simply cannot touch contacts.
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { scope: true },
  });
  if (!grantCovers(account?.scope, CONTACT_SYNC_SCOPES)) {
    const message =
      "The Google connection does not include permission to manage contacts. Reconnect Google in Settings.";
    await recordAuthError(userId, message);
    return { status: "auth", message };
  }

  const outcome = await withSyncLease(userId, async (): Promise<RunOutcome> => {
    try {
      const auth = await getGoogleClient(userId);
      const people = createPeopleClient(auth);
      const result = await syncContactsForUser(userId, { people }, options);
      const summary = summarise(result);

      await prisma.userSettings.updateMany({
        where: { userId },
        data: { lastContactSyncAt: new Date(), lastContactSyncSummary: summary },
      });

      return { status: "ok", result, summary };
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        await recordAuthError(userId, err.message);
        await prisma.userSettings.updateMany({
          where: { userId },
          data: {
            lastContactSyncAt: new Date(),
            lastContactSyncSummary: `stopped: ${err.message}`,
          },
        });
        return { status: "auth", message: err.message };
      }

      const message = err instanceof Error ? err.message : String(err);
      console.error(`[hearth] contact sync failed for ${userId}:`, err);
      await prisma.userSettings.updateMany({
        where: { userId },
        data: {
          lastContactSyncAt: new Date(),
          lastContactSyncSummary: `failed: ${message}`,
        },
      });
      return { status: "error", message };
    }
  });

  return outcome ?? { status: "busy" };
}

/** Every user who has switched contact sync on. Used by the scheduler. */
export async function runContactSyncForAllUsers(): Promise<
  Array<{ userId: string; outcome: RunOutcome }>
> {
  const users = await prisma.userSettings.findMany({
    where: { syncContactsEnabled: true },
    select: { userId: true },
  });

  const out: Array<{ userId: string; outcome: RunOutcome }> = [];
  for (const { userId } of users) {
    // Sequential on purpose: concurrent users would share one Google project's
    // quota and make rate limiting more likely, and a personal install has few
    // users anyway.
    out.push({ userId, outcome: await runContactSyncForUser(userId) });
  }
  return out;
}
