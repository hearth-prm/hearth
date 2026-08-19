-- A contact's history, as snapshots.
--
-- Whole snapshots rather than field-level changes: a contact now spans Person,
-- ContactPoint, PersonLabel, PersonGoogleEvent, PersonGoogleRelation and a JSON bag, and
-- diffing five tables on every write is machinery that fails quietly. A snapshot answers
-- "as it was in March" exactly, and the diff between two of them is a pure function — so
-- the timeline is derived rather than stored, and cannot drift from the data it describes.
--
-- byUserId is SET NULL rather than CASCADE: somebody leaving the household must not erase
-- the history of every contact they ever edited.
CREATE TYPE "PersonVersionSource" AS ENUM (
  'CREATED', 'EDITED', 'CSV_IMPORT', 'GOOGLE_IMPORT', 'TRANSFERRED'
);

CREATE TABLE "PersonVersion" (
  "id"        TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "revision"  INTEGER NOT NULL,
  "byUserId"  TEXT,
  "source"    "PersonVersionSource" NOT NULL,
  "content"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PersonVersion_personId_revision_key" ON "PersonVersion"("personId", "revision");
CREATE INDEX "PersonVersion_personId_createdAt_idx" ON "PersonVersion"("personId", "createdAt");
CREATE INDEX "PersonVersion_byUserId_idx" ON "PersonVersion"("byUserId");

ALTER TABLE "PersonVersion" ADD CONSTRAINT "PersonVersion_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonVersion" ADD CONSTRAINT "PersonVersion_byUserId_fkey"
  FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
