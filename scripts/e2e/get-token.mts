/**
 * Obtain a Google refresh token for one of the E2E test accounts.
 *
 *   npm run token -- A      # first dummy account
 *   npm run token -- B      # second dummy account
 *
 * Prints a consent URL, catches Google's redirect on localhost, exchanges the code,
 * and writes the refresh token into .env.e2e. The token is never printed in full and
 * never leaves this machine.
 *
 * You complete the consent in your own browser rather than anything automating it:
 * driving Google's sign-in would mean handing over an account password, and Google
 * blocks automated sign-in anyway — brand-new accounts most aggressively of all.
 *
 * Tokens minted here die after SEVEN DAYS if the OAuth app's publishing status is still
 * "Testing" — that is Google's rule, not a fault in this script. If `e2e:google` or the
 * import probe starts reporting invalid_grant a week after it last worked, that is why:
 * re-run this, or publish the app.
 *
 * Scopes come from src/lib/google/scopes.ts rather than being restated here, so a
 * token obtained by this script always covers exactly what Hearth asks for. Note they
 * are granular: calendar.events and calendar.readonly, NOT the blanket calendar
 * scope. The consent screen must list all of them or the grant will fall short.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ALL_GOOGLE_SCOPES, missingScopes } from "../../src/lib/google/scopes.ts";

const ENV_FILE = path.join(process.cwd(), ".env.e2e");
const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

function readEnvFile(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at === -1) continue;
    out.set(trimmed.slice(0, at).trim(), trimmed.slice(at + 1).trim());
  }
  return out;
}

/** Rewrite one key, preserving everything else and the file's comments. */
function setEnvValue(key: string, value: string): void {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  let replaced = false;
  const next = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (next.length && next[next.length - 1]!.trim() !== "") next.push("");
    next.splice(next.length - 1, 0, `${key}=${value}`);
  }
  writeFileSync(ENV_FILE, next.join("\n"), { mode: 0o600 });
}

const slot = (process.argv[2] ?? "").toUpperCase();
if (slot !== "A" && slot !== "B") {
  console.error("Usage: npm run token -- A   (or B)");
  process.exit(1);
}

const env = readEnvFile();
const clientId = env.get("E2E_GOOGLE_CLIENT_ID");
const clientSecret = env.get("E2E_GOOGLE_CLIENT_SECRET");

if (!clientId || !clientSecret) {
  console.error(`
Missing credentials. Create ${ENV_FILE} with your TEST OAuth client:

  E2E_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
  E2E_GOOGLE_CLIENT_SECRET=xxxxx

Use the client from the throwaway GCP project, not your production one.
`);
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", ALL_GOOGLE_SCOPES.join(" "));
// Exactly what Hearth sends. offline + consent is what actually yields a refresh
// token: Google withholds one on a repeat consent unless it is re-prompted.
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");
authUrl.searchParams.set("include_granted_scopes", "true");

console.log(`
Open this in your browser and sign in as dummy account ${slot}:

${authUrl.toString()}

Waiting for the redirect on ${REDIRECT_URI} …
(Ctrl-C to give up.)
`);

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end("not here");
      return;
    }
    const error = url.searchParams.get("error");
    const got = url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      error || !got
        ? `<h1>No code</h1><p>${error ?? "Google sent no authorisation code."}</p>`
        : `<h1>Done</h1><p>Account ${slot} authorised. You can close this tab.</p>`,
    );
    server.close();
    if (error || !got) reject(new Error(error ?? "no code in the redirect"));
    else resolve(got);
  });
  server.listen(PORT, "127.0.0.1");
  server.on("error", reject);
});

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

const body = (await res.json()) as {
  refresh_token?: string;
  access_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

if (!res.ok || body.error) {
  console.error(`\nToken exchange failed: ${body.error ?? res.status}`);
  if (body.error_description) console.error(body.error_description);
  if (body.error === "redirect_uri_mismatch") {
    console.error(`\nAdd exactly this redirect URI to the OAuth client:\n  ${REDIRECT_URI}`);
  }
  process.exit(1);
}

if (!body.refresh_token) {
  console.error(`
Google returned no refresh token. That happens when the account has already
consented and Google decides not to re-issue one. Revoke this app's access at
https://myaccount.google.com/permissions for account ${slot}, then run this again.
`);
  process.exit(1);
}

// Check the grant before declaring success: a token missing the contacts scope would
// fail deep inside a sync run with a confusing error rather than here. Compared
// through missingScopes, because Google returns `email` and `profile` expanded to
// their userinfo.* URLs and a plain string compare calls them missing.
const granted = new Set((body.scope ?? "").split(/\s+/).filter(Boolean));
const missing = missingScopes(body.scope, ALL_GOOGLE_SCOPES);

setEnvValue(`E2E_REFRESH_TOKEN_${slot}`, body.refresh_token);

// Identify whose token this is, so the suite can report the accounts by name and you
// can tell at a glance that A and B are genuinely different accounts.
let who = "unknown";
try {
  const info = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  const json = (await info.json()) as { email?: string };
  if (json.email) {
    who = json.email;
    setEnvValue(`E2E_EMAIL_${slot}`, json.email);
  }
} catch {
  // Not worth failing over; the token itself is what matters.
}

console.log(`
Saved E2E_REFRESH_TOKEN_${slot} to .env.e2e  (${body.refresh_token.length} chars)
Account: ${who}
Scopes granted: ${granted.size}`);

if (missing.length) {
  console.log(`
⚠ Missing scopes — add these to the consent screen and run again:
${missing.map((m) => `    ${m}`).join("\n")}`);
} else {
  console.log("All scopes Hearth needs are present.");
}
