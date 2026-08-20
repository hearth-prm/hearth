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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export interface Database {
  prisma: PrismaClient;
  dbUrl: string;
  /** Directory holding the cluster; also where the harness keeps its scratch. */
  dir: string;
  stop(): Promise<void>;
}

/**
 * A throwaway Postgres with Hearth's migrations applied.
 *
 * Split out from the browser harness because the Google suite needs a database and
 * the sync engine but no app server and no browser — it drives the engine directly
 * and then asks Google what happened.
 */
export async function startDatabase(): Promise<Database> {
  const dir = mkdtempSync(path.join(tmpdir(), "hearth-e2e-"));
  const pgPort = freePort(56000);
  const dataDir = path.join(dir, "pg");
  // The database initdb already made, rather than a fresh one: this build of
  // embedded-postgres ships only initdb, pg_ctl and postgres — no psql to CREATE
  // DATABASE with, and no pg_isready to poll.
  const dbUrl = `postgresql://hearth:hearth@127.0.0.1:${pgPort}/postgres?schema=public`;

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

  await run("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    cwd: REPO,
  });

  // The app's shared Prisma client (src/lib/db.ts) constructs itself at import time
  // from DATABASE_URL, so anything importing it must see this set first. Callers that
  // drive app modules in-process therefore have to import them AFTER calling this.
  process.env.DATABASE_URL = dbUrl;

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  return {
    prisma,
    dbUrl,
    dir,
    async stop() {
      await prisma.$disconnect().catch(() => {});
      await run(path.join(PG_BIN, "pg_ctl"), ["-D", dataDir, "stop"]).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Kill app servers left behind by runs that were killed.
 *
 * stop() ends the server on a normal exit, but a run that is SIGKILLed — the editor
 * crashing, an out-of-memory kill, a terminal closing — never reaches it, and the server is
 * reparented to init and lives on. Fourteen of them accumulated over one day, holding about
 * 2.8GB between them, and the machine then started killing tsc and the editor: the leak
 * made its own symptoms look like unrelated crashes.
 *
 * So each run notes its server's pid in a file and, before starting, kills any pid there
 * that is still alive. Recorded rather than pattern-matched on the process name: this must
 * never kill a `next start` somebody is using for something else.
 */
const APP_PIDS = path.join(tmpdir(), "hearth-e2e-app.pids");

function rememberApp(pid: number | undefined): void {
  if (!pid) return;
  const existing = existsSync(APP_PIDS) ? readFileSync(APP_PIDS, "utf8") : "";
  writeFileSync(APP_PIDS, `${existing}${pid}\n`);
}

function forgetApp(pid: number | undefined): void {
  if (!existsSync(APP_PIDS)) return;
  const kept = readFileSync(APP_PIDS, "utf8")
    .split("\n")
    .filter((line) => line.trim() && line.trim() !== String(pid));
  writeFileSync(APP_PIDS, kept.length > 0 ? `${kept.join("\n")}\n` : "");
}

function reapStaleApps(): void {
  if (!existsSync(APP_PIDS)) return;
  let reaped = 0;
  for (const line of readFileSync(APP_PIDS, "utf8").split("\n")) {
    const pid = Number(line.trim());
    if (!pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      reaped += 1;
    } catch {
      // Already gone, which is the common case and not worth saying anything about.
    }
  }
  writeFileSync(APP_PIDS, "");
  if (reaped > 0) console.log(`  harness: reaped ${reaped} app server(s) from a killed run`);
}

export async function start(): Promise<Harness> {
  const db = await startDatabase();
  const dir = db.dir;
  const appPort = freePort(4100);
  const dbUrl = db.dbUrl;
  console.log(`  harness: app :${appPort}`);

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

  reapStaleApps();

  const app: ChildProcess = spawn("npx", ["next", "start", "-p", String(appPort), "-H", "127.0.0.1"], {
    env, cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
  });
  rememberApp(app.pid);
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

  const prisma = db.prisma;
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
    forgetApp(app.pid);
    await new Promise((r) => setTimeout(r, 500));
    await db.stop();
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
