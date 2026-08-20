-- Which record a queued deletion was made for.
--
-- A tombstone was matched by resource id alone, so a deletion queued for one contact
-- settled onto whatever PersonSync row held that Google resource name by the time it ran.
-- Delete a contact, re-import the same one from Google, and the old deletion disabled the
-- new contact: "Not in Google", nothing for the sync to do, and the Google copy removed.
--
-- Nullable, and deliberately without a foreign key. A tombstone has to outlive the row it
-- describes — that is its entire purpose — and for a permanently deleted contact there is
-- no row left to point at. A null here means "no local link to settle", which is exactly
-- the truth in that case.
ALTER TABLE "SyncTombstone" ADD COLUMN "personId" TEXT;

CREATE INDEX "SyncTombstone_personId_idx" ON "SyncTombstone"("personId");
