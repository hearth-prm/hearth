import { google } from "googleapis";
import type { Credentials, OAuth2Client } from "google-auth-library";
import { isDevelopment } from "@/lib/run-mode";
import { prisma } from "@/lib/db";

/**
 * Per-user Google authorisation.
 *
 * The access token Google issues lasts about an hour, so anything running in the
 * background has to refresh it from the stored refresh token. That token is the
 * one piece of state that cannot be recreated without the user's involvement —
 * hence the sharp distinction below between a *transient* failure worth retrying
 * and a *revoked grant*, which must stop sync and ask for a reconnect rather than
 * hammering Google forever.
 */

/** The stored grant is no longer usable; only the user can fix it. */
export class GoogleAuthError extends Error {
  readonly reconnectRequired = true;
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Refresh a minute early — a token that expires mid-request is a wasted call. */
const EXPIRY_SKEW_MS = 60_000;

function oauthCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleAuthError(
      "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set on the server",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Google reports a dead refresh token as `invalid_grant`. It means revoked
 * access, a password change, or consent that expired because the OAuth app is
 * still in "Testing" — all of which need the user to sign in again.
 */
function isInvalidGrant(err: unknown): boolean {
  const e = err as {
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
  };
  return (
    e?.response?.data?.error === "invalid_grant" ||
    /invalid_grant/i.test(e?.message ?? "")
  );
}

async function persistCredentials(
  accountId: string,
  creds: Credentials,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: creds.access_token ?? undefined,
      // Google normally omits refresh_token on refresh; keep the existing one
      // rather than overwriting it with null.
      refresh_token: creds.refresh_token ?? undefined,
      expires_at: creds.expiry_date
        ? Math.floor(creds.expiry_date / 1000)
        : undefined,
      // scope can widen if the user re-consents to more.
      scope: creds.scope ?? undefined,
    },
  });
}

/** Record that the grant is dead, so the UI can prompt and sync can stand down. */
export async function recordAuthError(
  userId: string,
  message: string,
): Promise<void> {
  await prisma.userSettings.updateMany({
    where: { userId },
    data: { googleAuthError: message, googleAuthErrorAt: new Date() },
  });
}

/** Clear a previously recorded auth error after a successful call. */
export async function clearAuthError(userId: string): Promise<void> {
  await prisma.userSettings.updateMany({
    where: { userId, googleAuthError: { not: null } },
    data: { googleAuthError: null, googleAuthErrorAt: null },
  });
}

/**
 * An OAuth2 client with a valid access token for this user.
 *
 * Refreshes and persists when the stored token is expired or nearly so. The
 * refresh is done explicitly rather than relying on the library's implicit
 * behaviour, because the new token has to be written back to the database — and
 * the `tokens` event alone gives no way to await that write.
 */
export async function getGoogleClient(userId: string): Promise<OAuth2Client> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      id: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      scope: true,
    },
  });

  if (!account) {
    throw new GoogleAuthError("No Google account is linked to this user");
  }
  if (!account.refresh_token) {
    throw new GoogleAuthError(
      "No refresh token stored — reconnect Google to grant offline access",
    );
  }

  const { clientId, clientSecret } = oauthCredentials();
  const client = new google.auth.OAuth2({ clientId, clientSecret });
  client.setCredentials({
    access_token: account.access_token ?? undefined,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
    scope: account.scope ?? undefined,
  });

  const expiresAtMs = account.expires_at ? account.expires_at * 1000 : 0;
  const needsRefresh =
    !account.access_token || expiresAtMs < Date.now() + EXPIRY_SKEW_MS;

  if (needsRefresh) {
    // Capture the event rather than persisting inside the handler, so the write
    // is awaited and a failure to save is not swallowed.
    let refreshed: Credentials | null = null;
    client.on("tokens", (tokens) => {
      refreshed = tokens;
    });

    try {
      await client.getAccessToken();
    } catch (err) {
      if (isInvalidGrant(err)) {
        const message =
          "Google rejected the stored refresh token. Reconnect Google in Settings.";
        await recordAuthError(userId, message);
        throw new GoogleAuthError(message);
      }
      throw err;
    }

    if (refreshed) {
      await persistCredentials(account.id, refreshed);
    }
  }

  await clearAuthError(userId);
  return isDevelopment() ? readOnly(client) : client;
}

/**
 * The same client with every write refused — a BACKSTOP, not the mechanism.
 *
 * In development the simulating clients in `dev-clients.ts` answer every write before it
 * reaches HTTP, so this should never fire. That is exactly why it stays: if it does fire,
 * some write path went round the simulation and would have reached the real account on a
 * production install of the same code. The message says so, because "this cannot happen" is
 * the class of thing worth being told about when it happens.
 *
 * Derived from the HTTP method, not from a list of endpoints, so a call added later is
 * covered on the day it is added. Reads still work: the import and the calendar picker want
 * the real account, and reading changes nothing.
 *
 * Safe for the token refresh: that goes out through the library's own transporter rather
 * than back through `request`, and by the time this wraps anything the refresh has already
 * happened above.
 *
 * `sendMail` is not covered here at all: it posts over plain fetch and never touches this
 * client, so it gates itself immediately before its own request.
 */
function readOnly(client: OAuth2Client): OAuth2Client {
  const send = client.request.bind(client);
  client.request = (async (opts: { method?: string; url?: string }) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new GoogleAuthError(
        `Refused ${method} ${opts?.url ?? "a Google write"}: this is a development install ` +
          `(HEARTH_ENV), and this write did not pass through the simulating client — which ` +
          `means it would have reached the real account in production. That is a bug.`,
      );
    }
    return send(opts);
  }) as typeof client.request;
  return client;
}
