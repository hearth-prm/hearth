-- Everything else Google keeps on a contact.
--
-- The new ContactKind values are all the same shape — a value with an optional type —
-- which is what ContactPoint already models, so they reuse its ordering, primary flag
-- and editor instead of arriving as eight more tables.
--
-- Events and relations do get tables, because they are not that shape: an event is a
-- date with a possibly-absent year, and a Google relation is a person's NAME as free
-- text, which is a different thing from Hearth's Relationship between two contacts that
-- both exist.
--
-- Additive throughout. Nothing existing changes and no backfill is possible, since none
-- of this was ever stored.
ALTER TYPE "ContactKind" ADD VALUE 'IM';
ALTER TYPE "ContactKind" ADD VALUE 'SIP';
ALTER TYPE "ContactKind" ADD VALUE 'CALENDAR';
ALTER TYPE "ContactKind" ADD VALUE 'EXTERNAL_ID';
ALTER TYPE "ContactKind" ADD VALUE 'KEYWORD';
ALTER TYPE "ContactKind" ADD VALUE 'INTEREST';
ALTER TYPE "ContactKind" ADD VALUE 'SKILL';
ALTER TYPE "ContactKind" ADD VALUE 'OCCUPATION';
ALTER TYPE "ContactKind" ADD VALUE 'LOCATION';
ALTER TYPE "ContactKind" ADD VALUE 'NICKNAME';

ALTER TABLE "ContactPoint" ADD COLUMN "protocol" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "buildingId" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "floor" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "floorSection" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "deskCode" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "current" BOOLEAN;

ALTER TABLE "Person" ADD COLUMN "gender" TEXT;
ALTER TABLE "Person" ADD COLUMN "birthdayText" TEXT;

CREATE TABLE "PersonGoogleEvent" (
  "id"        TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "label"     TEXT,
  "year"      INTEGER,
  "month"     INTEGER NOT NULL,
  "day"       INTEGER NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonGoogleEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonGoogleEvent_personId_order_idx" ON "PersonGoogleEvent"("personId", "order");
ALTER TABLE "PersonGoogleEvent" ADD CONSTRAINT "PersonGoogleEvent_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonGoogleRelation" (
  "id"        TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "label"     TEXT,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonGoogleRelation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PersonGoogleRelation_personId_order_idx" ON "PersonGoogleRelation"("personId", "order");
ALTER TABLE "PersonGoogleRelation" ADD CONSTRAINT "PersonGoogleRelation_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
