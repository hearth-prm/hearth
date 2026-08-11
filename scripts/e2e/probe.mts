import { start } from "./harness.mts";
const h = await start();
try {
  const A = await h.signIn("a@x.test", "Alice");
  const B = await h.signIn("b@x.test", "Bob");
  await h.prisma.label.create({ data: { ownerId: A.id, name: "Family" } });
  await h.prisma.label.create({ data: { ownerId: B.id, name: "Bob Only" } });
  await B.page.goto("/settings/labels");
  const text = (await B.page.textContent("body")) ?? "";
  const i = text.indexOf("Family");
  console.log("Family index:", i);
  if (i >= 0) console.log("context:", JSON.stringify(text.slice(Math.max(0, i - 140), i + 60)));
  console.log("label rows:", await B.page.$$eval("li", els => els.map(e => e.textContent?.trim())));
} finally { await h.stop(); }
