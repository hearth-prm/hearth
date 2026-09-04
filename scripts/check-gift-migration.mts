/**
 * Does the gift-givers migration actually carry the old data across?
 *
 * The e2e suite always starts from an empty database, so its migrations run in order against
 * nothing — which means the INSERT..SELECT half of 20260904000000_gift_givers_and_sends, the
 * half that copies existing gifts and existing thanks into the new tables, has never executed
 * against a single row. That is also the only half that touches somebody's live data, and it
 * ends with three DROP COLUMNs.
 *
 * So this applies every migration BEFORE it, writes old-shaped rows by hand, applies it, and
 * asserts what came out. Run it before letting the migration near a real database:
 *
 *   npx tsx scripts/check-gift-migration.mts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { startDatabase } from "./e2e/harness.mts";

const TARGET = "20260904000000_gift_givers_and_sends";

let failures = 0;
function ok(name: string, pass: boolean, detail?: unknown): void {
  if (pass) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

const db = await startDatabase();
const prisma = new PrismaClient({ datasourceUrl: db.dbUrl });

try {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const all = readdirSync(dir).filter((d) => d !== "migration_lock.toml").sort();
  const before = all.filter((d) => d < TARGET);
  if (!all.includes(TARGET)) throw new Error(`${TARGET} is not in ${dir}`);

  // Applied with $executeRawUnsafe rather than through Prisma, because Prisma has no notion of
  // "migrate as far as here" — and reading the files in order is exactly what it would do.
  const apply = async (name: string) => {
    const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    // Split on semicolons at end of line: every statement in these files is written that way,
    // and no statement here contains a string literal with one in it.
    for (const stmt of sql.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
  };

  // startDatabase applies every migration, which is the opposite of what this needs. Emptying
  // the schema first is cheaper and clearer than teaching the harness a second mode.
  await prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA public`);

  console.log(`applying ${before.length} migrations up to ${TARGET}…`);
  for (const name of before) await apply(name);

  // --- old-shaped data, written the way the old schema stored it ------------
  const owner = "u_old";
  await prisma.$executeRawUnsafe(
    // updatedAt supplied explicitly: Prisma's @updatedAt is NOT NULL with no database
    // default, so it is the application that fills it and a raw insert has to say so.
    `INSERT INTO "User" ("id","email","name","isHeadOfHousehold","updatedAt")
     VALUES ($1,$2,$3,true,now())`,
    owner, "old@e2e.test", "Old Owner",
  );
  const mk = async (id: string, name: string) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO "Person" ("id","ownerId","displayName","givenName","custom","addToGoogle","updatedAt")
       VALUES ($1,$2,$3,$4,'{}'::jsonb,true,now())`,
      id, owner, name, name,
    );
  await mk("p_giver", "Old Giver");
  await mk("p_kid", "Old Kid");
  await mk("p_twin", "Old Twin");

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Gift" ("id","ownerId","giverId","description","notes","updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())`,
    "g_thanked", owner, "p_giver", "A thanked kite", "with a note",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Gift" ("id","ownerId","giverId","description","updatedAt")
     VALUES ($1,$2,$3,$4,now())`,
    "g_unthanked", owner, "p_giver", "An unthanked mug",
  );

  const thankedAt = new Date("2026-03-04T10:11:12.000Z");
  // Deliberately not midnight and not now: a bug that substituted the migration's own clock
  // for the original timestamp would pass against either.
  // One gift, two recipients: one thanked, one not — which is the case the new model exists
  // to represent, so it is the case worth carrying across.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GiftRecipient" ("giftId","personId","thankedAt","thankYouNote")
     VALUES ($1,$2,$3,$4)`,
    "g_thanked", "p_kid", thankedAt, "Thank you for the kite.",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GiftRecipient" ("giftId","personId") VALUES ($1,$2)`,
    "g_thanked", "p_twin",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "GiftRecipient" ("giftId","personId") VALUES ($1,$2)`,
    "g_unthanked", "p_kid",
  );

  // What Postgres actually STORED, read back before the column goes.
  //
  // Not the Date that was passed in: thankedAt is TIMESTAMP(3) without a time zone, so a Date
  // handed to a raw insert lands as local wall-clock and reads back six hours off on this
  // machine. That is a property of the column, not of the migration — which copies the column
  // with plain SQL and shifts nothing — so the assertion has to compare against what was
  // there rather than against what was meant. The first version of this compared against the
  // input and failed for a reason that had nothing to do with the code under test.
  const [{ thankedAt: stored }] = await prisma.$queryRawUnsafe<{ thankedAt: Date }[]>(
    `SELECT "thankedAt" FROM "GiftRecipient" WHERE "giftId" = 'g_thanked' AND "personId" = 'p_kid'`,
  );

  console.log(`applying ${TARGET}…`);
  await apply(TARGET);

  // --- what came out --------------------------------------------------------
  const givers = await prisma.giftGiver.findMany({ orderBy: { giftId: "asc" } });
  ok("both gifts kept their giver", givers.length === 2 &&
     givers.every((g) => g.personId === "p_giver"), givers);

  const sends = await prisma.thankYouSend.findMany({ include: { givers: true } });
  ok("one send, for the one recipient who had thanked", sends.length === 1, sends.length);
  const send = sends[0];
  ok("from the recipient who wrote it", send?.fromPersonId === "p_kid", send?.fromPersonId);
  ok("for the right gift", send?.giftId === "g_thanked", send?.giftId);
  ok("carrying the words they wrote",
     send?.message === "Thank you for the kite.", send?.message);
  ok("dated when it was actually sent, not when the migration ran",
     send?.createdAt.toISOString() === stored.toISOString(),
     [send?.createdAt, stored]);
  // The old rows recorded WHEN a thank-you went but never who sent it, and inventing the
  // gift's owner would look like a fact rather than the guess it would be.
  ok("with no claim about who pressed send", send?.sentByUserId === null, send?.sentByUserId);

  ok("addressed to the gift's giver", send?.givers.length === 1 &&
     send.givers[0]?.giverPersonId === "p_giver", send?.givers);
  ok("stamped as sent at the old time",
     send?.givers[0]?.sentAt?.toISOString() === stored.toISOString(),
     [send?.givers[0]?.sentAt, stored]);
  ok("with no invented email address", send?.givers[0]?.emailUsed === null,
     send?.givers[0]?.emailUsed);
  // The redundancy the query needs. If this were wrong, has:unthanked would be wrong.
  ok("and a giftId agreeing with its send", send?.givers[0]?.giftId === "g_thanked",
     send?.givers[0]?.giftId);

  const untouched = await prisma.giftRecipient.count();
  ok("every recipient row survived", untouched === 3, untouched);

  const cols = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE (table_name = 'Gift' AND column_name = 'giverId')
        OR (table_name = 'GiftRecipient' AND column_name IN ('thankedAt','thankYouNote'))`,
  );
  ok("and the three old columns are gone", cols.length === 0, cols);

  // The thing the whole model is for: the unthanked gift is still owed, the thanked one is not.
  const owed = await prisma.giftGiver.findMany({
    where: { thanks: { none: { sentAt: { not: null } } } },
    select: { giftId: true },
  });
  ok("the unthanked gift is the one still owed",
     owed.length === 1 && owed[0]?.giftId === "g_unthanked", owed);
} finally {
  await prisma.$disconnect();
  await db.stop();
}

console.log(failures === 0 ? "\nthe copy carries everything across" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
