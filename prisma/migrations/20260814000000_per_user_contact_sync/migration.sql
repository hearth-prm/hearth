-- hearth:allow-destructive
--
-- Moves per-account Google sync state off the Person row into PersonSync, one row
-- per (contact, Google account).
--
-- The old shape allowed exactly one copy of a contact in Google — the owner's —
-- which made sharing invisible to Google entirely. A contact shared with three
-- people needs four copies, each with its own resource id, etag and retry state.
--
-- The columns being dropped are not lost: the INSERT below moves each contact's
-- existing state into a PersonSync row for its owner, so an install that has been
-- syncing keeps every link it had and re-adopts nothing.
--
-- Statement order is hand-written because `prisma migrate diff` emitted the DROPs
-- first:
--   1. create PersonSync
--   2. copy the state across, while the columns still exist
--   3. only then drop them

-- CreateTable
CREATE TABLE "PersonSync" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleResourceName" TEXT,
    "googleEtag" TEXT,
    "googleSyncedAt" TIMESTAMP(3),
    "googleSyncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "googleSyncError" TEXT,
    "googleSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    "googleSyncNextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonSync_userId_googleSyncStatus_googleSyncNextAttemptAt_idx" ON "PersonSync"("userId", "googleSyncStatus", "googleSyncNextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSync_personId_userId_key" ON "PersonSync"("personId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSync_userId_googleResourceName_key" ON "PersonSync"("userId", "googleResourceName");

-- AddForeignKey
ALTER TABLE "PersonSync" ADD CONSTRAINT "PersonSync_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSync" ADD CONSTRAINT "PersonSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "syncSharedContacts" BOOLEAN NOT NULL DEFAULT true;

-- Move each contact's existing sync state into a row for its owner's account.
INSERT INTO "PersonSync" (
  "id", "personId", "userId",
  "googleResourceName", "googleEtag", "googleSyncedAt",
  "googleSyncStatus", "googleSyncError",
  "googleSyncAttempts", "googleSyncNextAttemptAt",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  p."ownerId",
  p."googleResourceName",
  p."googleEtag",
  p."googleSyncedAt",
  p."googleSyncStatus",
  p."googleSyncError",
  p."googleSyncAttempts",
  p."googleSyncNextAttemptAt",
  NOW(),
  NOW()
FROM "Person" p;

-- DropIndex
DROP INDEX "Person_ownerId_addToGoogle_googleSyncStatus_googleSyncNextA_idx";

-- DropIndex
DROP INDEX "Person_ownerId_googleResourceName_key";

-- AlterTable
ALTER TABLE "Person" DROP COLUMN "googleEtag",
DROP COLUMN "googleResourceName",
DROP COLUMN "googleSyncAttempts",
DROP COLUMN "googleSyncError",
DROP COLUMN "googleSyncNextAttemptAt",
DROP COLUMN "googleSyncStatus",
DROP COLUMN "googleSyncedAt";

-- CreateIndex
CREATE INDEX "Person_ownerId_addToGoogle_idx" ON "Person"("ownerId", "addToGoogle");
