-- hearth:allow-destructive
--
-- Drops UserSettings.syncCustomFields, superseded by the FieldMapping table. The
-- value is not lost: the INSERT below carries it forward, creating a mapping row for
-- every user-defined contact field belonging to anyone who had the switch on.
-- Leaving the column would mean two sources of truth for the same question with
-- nothing to say which one wins.
--
-- Statement order matters and is why this file is hand-written rather than taken
-- verbatim from `prisma migrate diff`, which emitted the DROP first:
--   1. create FieldMapping
--   2. backfill it, reading syncCustomFields while it still exists
--   3. only then drop the column

-- CreateTable
CREATE TABLE "FieldMapping" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "entity" "FieldEntity" NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldMapping_ownerId_entity_idx" ON "FieldMapping"("ownerId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "FieldMapping_ownerId_entity_fieldKey_key" ON "FieldMapping"("ownerId", "entity", "fieldKey");

-- AddForeignKey
ALTER TABLE "FieldMapping" ADD CONSTRAINT "FieldMapping_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the old all-or-nothing setting forward into explicit per-field mappings.
INSERT INTO "FieldMapping" ("id", "ownerId", "entity", "fieldKey", "target", "targetKey", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  fd."ownerId",
  fd."entity",
  fd."key",
  'userDefined',
  fd."label",
  NOW(),
  NOW()
FROM "FieldDefinition" fd
JOIN "UserSettings" us ON us."userId" = fd."ownerId"
WHERE fd."entity" = 'PERSON'
  AND us."syncCustomFields" = true
ON CONFLICT ("ownerId", "entity", "fieldKey") DO NOTHING;

-- AlterTable
ALTER TABLE "UserSettings" DROP COLUMN "syncCustomFields";
