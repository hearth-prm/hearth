-- hearth:allow-destructive
--
-- Drops Event.googleSyncToken. Safe: the column was added in the initial
-- migration as a guess about how RSVP polling would work and was never written
-- to by any code path — M1 did not sync at all and M2 only touched contacts.
-- Confirmed with `grep -rn googleSyncToken src/` returning nothing.
--
-- The replacement is UserSettings.calendarRsvpCheckedAt: a sync cursor belongs to
-- the calendar being polled, not to each individual event, which is what made the
-- original column the wrong shape as well as unused.

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "googleSyncToken",
ADD COLUMN     "googleSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "googleSyncNextAttemptAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "calendarRsvpCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastEventSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastEventSyncSummary" TEXT,
ADD COLUMN     "sendInvites" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Event_ownerId_addToGoogle_googleSyncStatus_googleSyncNextAt_idx" ON "Event"("ownerId", "addToGoogle", "googleSyncStatus", "googleSyncNextAttemptAt");

