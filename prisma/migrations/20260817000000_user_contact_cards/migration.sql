-- Household cards: a contact record representing each user of the install.
--
-- Owned by the head of the household and shared with every user, including the one each
-- card is about. That last part is the point: your own details in your own Google
-- Contacts are what your phone's "share contact" sends to someone.
--
-- Ordinary ownership and ordinary Share rows, so src/lib/access.ts needs no special
-- case — every clause it already has covers these. The alternative considered was an
-- unowned "system" contact, which would have meant a nullable Person.ownerId rippling
-- through the one file the whole app's authorisation funnels through, and would have
-- left these cards with no field registry and no labels, since both follow the owner.

-- Exactly one head of household, enforced by the database rather than by application
-- code that could forget. A partial unique index is the way to say "at most one row
-- where this is true" in Postgres.
ALTER TABLE "User" ADD COLUMN "isHeadOfHousehold" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "User_isHeadOfHousehold_key" ON "User"("isHeadOfHousehold")
  WHERE "isHeadOfHousehold";

-- Which user a card represents. Unique, so a user can never accumulate two.
ALTER TABLE "Person" ADD COLUMN "linkedUserId" TEXT;
CREATE UNIQUE INDEX "Person_linkedUserId_key" ON "Person"("linkedUserId");
CREATE INDEX "Person_linkedUserId_idx" ON "Person"("linkedUserId");
ALTER TABLE "Person" ADD CONSTRAINT "Person_linkedUserId_fkey"
  FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Elect the earliest user as head. On an existing install that is whoever set it up,
-- which is the right default and is changeable in settings afterwards.
UPDATE "User" SET "isHeadOfHousehold" = true
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);

-- A card for every user who already exists. New users get theirs from the createUser
-- hook; without this backfill only people who sign in after the upgrade would have one,
-- which is the kind of split that stays invisible until something depends on it.
--
-- Ids are deterministic so re-running cannot produce a second card, and so a generated
-- row is recognisable as generated.
INSERT INTO "Person" (
  "id", "ownerId", "linkedUserId", "givenName", "familyName", "displayName",
  "custom", "createdAt", "updatedAt"
)
SELECT
  'usercard_' || u."id",
  (SELECT "id" FROM "User" WHERE "isHeadOfHousehold" LIMIT 1),
  u."id",
  -- Split the Google display name on the first space. Better than putting the whole
  -- thing in the first-name column, and correctable like any other contact.
  COALESCE(NULLIF(split_part(COALESCE(u."name", ''), ' ', 1), ''), u."email"),
  -- Only when there actually is a space: position() returns 0 for a single-word name,
  -- and substring(... from 1) would then repeat the whole name as the family name.
  CASE
    WHEN position(' ' in COALESCE(u."name", '')) > 0
      THEN NULLIF(substring(u."name" from position(' ' in u."name") + 1), '')
    ELSE NULL
  END,
  COALESCE(NULLIF(u."name", ''), u."email", 'Unnamed contact'),
  '{}'::jsonb,
  NOW(),
  NOW()
FROM "User" u
WHERE NOT EXISTS (SELECT 1 FROM "Person" p WHERE p."linkedUserId" = u."id");

-- Seed each card's email from the account it represents, so the cards are useful
-- immediately rather than being empty shells with a name.
INSERT INTO "ContactPoint" ("id", "personId", "kind", "label", "value", "isPrimary", "order", "createdAt", "updatedAt")
SELECT 'usercardmail_' || u."id", 'usercard_' || u."id", 'EMAIL', NULL, u."email", true, 0, NOW(), NOW()
FROM "User" u
WHERE u."email" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Person" p WHERE p."id" = 'usercard_' || u."id")
  AND NOT EXISTS (
    SELECT 1 FROM "ContactPoint" c
    WHERE c."personId" = 'usercard_' || u."id" AND c."kind" = 'EMAIL'
  );

-- Share every card with every user who does not own it — which includes the user the
-- card is about, so their own details reach their own Google Contacts.
--
-- EDIT rather than VIEW: a household card that its own subject cannot correct is worse
-- than no card, and in a household the same argument covers everyone else.
INSERT INTO "Share" ("id", "ownerId", "withUserId", "scope", "permission", "personId", "createdAt")
SELECT
  'usercardshare_' || p."linkedUserId" || '_' || u."id",
  p."ownerId",
  u."id",
  'PERSON',
  'EDIT',
  p."id",
  NOW()
FROM "Person" p
CROSS JOIN "User" u
WHERE p."linkedUserId" IS NOT NULL
  AND u."id" <> p."ownerId"
  AND NOT EXISTS (
    SELECT 1 FROM "Share" s
    WHERE s."personId" = p."id" AND s."withUserId" = u."id" AND s."scope" = 'PERSON'
  );
