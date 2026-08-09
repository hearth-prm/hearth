-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "googleHtmlLink" TEXT;

-- Turn guest notifications on for settings rows that predate the default change.
--
-- The same SET DEFAULT gap as Event.addToGoogle in the previous migration, missed
-- for this column: sendInvites shipped defaulting to false, the default was then
-- changed to true, but ALTER COLUMN SET DEFAULT only governs rows inserted
-- afterwards. Every existing install therefore still had it off, which is why
-- guests were added to events but never emailed and so could never RSVP.
--
-- Safe to force on: the column only ever existed with the wrong default, in a
-- single release, so no one could have deliberately chosen false. It is also inert
-- unless an event is explicitly ticked "Send to Google Calendar", and it stays
-- suppressed for events that have already finished.
UPDATE "UserSettings" SET "sendInvites" = true WHERE "sendInvites" = false;
