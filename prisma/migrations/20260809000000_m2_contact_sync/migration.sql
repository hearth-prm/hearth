-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "googleSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "googleSyncNextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SyncTombstone" ADD COLUMN     "nextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "googleAuthError" TEXT,
ADD COLUMN     "googleAuthErrorAt" TIMESTAMP(3),
ADD COLUMN     "lastContactSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastContactSyncSummary" TEXT,
ADD COLUMN     "syncCustomFields" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Person_ownerId_addToGoogle_googleSyncStatus_googleSyncNextA_idx" ON "Person"("ownerId", "addToGoogle", "googleSyncStatus", "googleSyncNextAttemptAt");

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "syncLockedUntil" TIMESTAMP(3);
