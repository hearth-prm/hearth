import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// Read + parse rather than `import ... with { type: "json" }`: import attributes
// need Node >= 20.10, and there is no reason for the seed to care which Node
// runs it. Resolved relative to this file so the cwd does not matter.
const types = JSON.parse(
  readFileSync(new URL("../src/lib/relationship-types.json", import.meta.url), "utf8"),
);

/**
 * Seed the built-in relationship types.
 *
 * Plain Node ESM rather than TypeScript so the container entrypoint can run it
 * with no extra tooling in the runtime image. Idempotent and safe to run on
 * every start, which is what makes a fresh volume produce a usable install with
 * no manual step.
 *
 * Note that @@unique([ownerId, key]) does not enforce uniqueness for these rows
 * — Postgres treats NULLs as distinct — so the missing set is diffed explicitly
 * rather than relying on skipDuplicates alone.
 */
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.relationshipType.findMany({
    where: { ownerId: null },
    select: { key: true },
  });
  const have = new Set(existing.map((r) => r.key));
  const missing = types.filter((t) => !have.has(t.key));

  if (missing.length === 0) {
    console.log(
      `[seed] ${have.size} system relationship types already present, nothing to do`,
    );
    return;
  }

  await prisma.relationshipType.createMany({
    data: missing.map((t) => ({ ...t, ownerId: null })),
    skipDuplicates: true,
  });
  console.log(
    `[seed] added ${missing.length} system relationship type(s): ${missing
      .map((t) => t.key)
      .join(", ")}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
