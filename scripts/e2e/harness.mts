/**
 * End-to-end harness: a real Postgres, the real built app, a real browser.
 *
 * Sign-in is bypassed by inserting a Session row and setting its cookie directly.
 * That is deliberate rather than a shortcut: driving Google's consent screen would
 * mean holding someone's password, and everything worth testing here sits
 * downstream of authentication anyway. Auth.js is configured for database sessions,
 * so a row plus a cookie is exactly what a real sign-in would have produced.
 *
 * SYNC_ENABLED is off throughout. The scheduler would otherwise wake up and try to
 * reach Google with fake credentials, filling the log with auth errors and marking
 * every contact as failed.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const run = promisify(execFile);

const REPO = process.cwd();
const PG_BIN = path.join(REPO, "node_modules/@embedded-postgres/linux-x64/native/bin");
const CHROMIUM = "/usr/bin/chromium";

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  /** Browser context already carrying this user's session cookie. */
  context: BrowserContext;
  page: Page;
}

export interface Harness {
  prisma: PrismaClient;
  baseUrl: string;
  /** Sign a fresh user in and hand back their own browser context. */
  signIn(email: string, name: string): Promise<SeededUser>;
  stop(): Promise<void>;
}

function freePort(base: number): number {
  // Spread across a range so two harness runs in the same minute do not collide.
  return base + Number(process.hrtime.bigint() % 900n);
}

async function waitFor(
  label: string,
  check: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export async function start(): Promise<Harness> {
  const dir = mkdtempSync(path.join(tmpdir(), "hearth-e2e-"));
  const pgPort = freePort(56000);
  const appPort = freePort(4100);
  const dataDir = path.join(dir, "pg");
  // The database initdb already made, rather than a fresh one: this build of
  // embedded-postgres ships only initdb, pg_ctl and postgres — no psql to CREATE
  // DATABASE with, and no pg_isready to poll.
  const dbUrl = `postgresql://hearth:hearth@127.0.0.1:${pgPort}/postgres?schema=public`;

  console.log(`  harness: postgres :${pgPort}, app :${appPort}`);

  await run(path.join(PG_BIN, "initdb"), ["-D", dataDir, "-U", "hearth", "--auth=trust", "-E", "UTF8"]);
  await run(path.join(PG_BIN, "pg_ctl"), [
    "-D", dataDir,
    "-o", `-p ${pgPort} -k ${dir}`,
    "-l", path.join(dir, "pg.log"),
    "start",
  ]);

  // Readiness is asked of the driver the app itself uses, which is a stronger signal
  // than a port being open: it proves authentication and the database both work.
  await waitFor("postgres", async () => {
    const probe = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    try {
      await probe.$queryRaw`SELECT 1`;
      return true;
    } finally {
      await probe.$disconnect().catch(() => {});
    }
  });

  const env = {
    ...process.env,
    DATABASE_URL: dbUrl,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_GOOGLE_ID: "e2e.apps.googleusercontent.com",
    AUTH_GOOGLE_SECRET: "e2e-secret",
    AUTH_URL: `http://127.0.0.1:${appPort}`,
    AUTH_TRUST_HOST: "true",
    // The whole point: no background reach for Google with credentials that cannot work.
    SYNC_ENABLED: "false",
    NODE_ENV: "production" as const,
    PORT: String(appPort),
  };

  await run("npx", ["prisma", "migrate", "deploy"], { env, cwd: REPO });
  console.log("  harness: migrations applied");

  const app: ChildProcess = spawn("npx", ["next", "start", "-p", String(appPort), "-H", "127.0.0.1"], {
    env, cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
  });
  const appLog: string[] = [];
  app.stdout?.on("data", (d) => appLog.push(String(d)));
  app.stderr?.on("data", (d) => appLog.push(String(d)));

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitFor("app", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    return res.ok;
  }, 90_000).catch((err) => {
    console.log(appLog.join(""));
    throw err;
  });
  console.log("  harness: app responding");

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const browser: Browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const contexts: BrowserContext[] = [];

  async function signIn(email: string, name: string): Promise<SeededUser> {
    const user = await prisma.user.create({ data: { email, name } });
    // Settings and a Google account row, so the app behaves as it would for someone
    // who has actually connected — without which the sync panels read as unconfigured.
    await prisma.userSettings.create({
      data: { userId: user.id, syncContactsEnabled: true, timeZone: "UTC" },
    });
    await prisma.account.create({
      data: {
        userId: user.id, type: "oauth", provider: "google", providerAccountId: email,
        access_token: "e2e", refresh_token: "e2e",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        scope: "openid email profile https://www.googleapis.com/auth/contacts https://www.googleapis.com/auth/calendar",
      },
    });

    const sessionToken = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: {
        sessionToken, userId: user.id,
        expires: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    const context = await browser.newContext({ baseURL: baseUrl, acceptDownloads: true });
    await context.addCookies([{
      // Auth.js v5 names the cookie this over plain HTTP; the __Secure- prefix is
      // only used when the URL is https.
      name: "authjs.session-token",
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    }]);
    contexts.push(context);

    const page = await context.newPage();
    return { id: user.id, email, name, context, page };
  }

  async function stop() {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    app.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    await run(path.join(PG_BIN, "pg_ctl"), ["-D", dataDir, "stop"]).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }

  return { prisma, baseUrl, signIn, stop };
}

// --- assertions -------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

export function ok(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

export function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}

export function report(): number {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAILED: ${f}`);
  return failures.length === 0 ? 0 : 1;
}
