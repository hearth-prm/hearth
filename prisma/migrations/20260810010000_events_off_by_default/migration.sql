-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "addToGoogle" SET DEFAULT false;

-- AlterTable
ALTER TABLE "UserSettings" ALTER COLUMN "sendInvites" SET DEFAULT true;

-- Bring existing events in line with the new default.
--
-- SET DEFAULT only affects rows inserted from now on, so every event created
-- before this migration still carries addToGoogle = true from the old default —
-- and enabling calendar sync would then push all of them, including years of
-- recorded history, which is the exact outcome the new default exists to prevent.
--
-- Restricted to events that have never reached Google (googleEventId IS NULL), so
-- nothing already synced is silently detached from its Google copy. Calendar sync
-- did not exist before this release, so in practice that is every event, but the
-- condition makes the statement safe to re-run and safe if it ever is not.
UPDATE "Event"
SET "addToGoogle" = false,
    "googleSyncStatus" = 'DISABLED'
WHERE "googleEventId" IS NULL
  AND "addToGoogle" = true;
