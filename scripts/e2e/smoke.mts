import { start, ok, section, report } from "./harness.mts";

const h = await start();
try {
  section("Smoke: does the seeded session actually authenticate?");
  const a = await h.signIn("a@e2e.test", "Alice");

  await a.page.goto("/people");
  ok("reaches /people without being bounced to /signin", !a.page.url().includes("/signin"), a.page.url());
  ok("renders the People heading", (await a.page.textContent("h1"))?.includes("People") === true,
     await a.page.textContent("h1"));

  await a.page.goto("/settings/labels");
  ok("Labels settings page loads", (await a.page.content()).includes("Your labels"));

  // An unauthenticated context must NOT get in — proving the cookie is what worked.
  const anon = await a.context.browser()!.newContext({ baseURL: h.baseUrl });
  const anonPage = await anon.newPage();
  await anonPage.goto("/people");
  ok("without the cookie, /people redirects to sign-in", anonPage.url().includes("/signin"), anonPage.url());
  await anon.close();
} finally {
  await h.stop();
}
process.exit(report());
