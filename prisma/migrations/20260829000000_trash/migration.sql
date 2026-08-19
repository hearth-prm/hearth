-- A trash can. Deleting puts a record here instead of destroying it.
--
-- One column is enough because of an invariant this codebase already holds: every read of
-- a contact or an event goes through a clause in src/lib/access.ts. Adding the filter
-- there covers the lists, the search, the export, the pickers and the sync in one place —
-- and a soft delete that leaks into one forgotten query is worse than none.
--
-- The trash NEVER empties itself. No retention window, no pruning job, deliberately: a bin
-- that quietly throws things away is not a bin, and the reason to have one at all is that
-- the person deciding has changed their mind before.
ALTER TABLE "Person" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Person_ownerId_deletedAt_idx" ON "Person"("ownerId", "deletedAt");
CREATE INDEX "Event_ownerId_deletedAt_idx" ON "Event"("ownerId", "deletedAt");

-- Trashing and restoring are changes to a contact worth seeing in its history.
ALTER TYPE "PersonVersionSource" ADD VALUE 'TRASHED';
ALTER TYPE "PersonVersionSource" ADD VALUE 'RESTORED';
