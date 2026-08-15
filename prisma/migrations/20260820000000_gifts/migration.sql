-- Gifts, at an event or on their own.
--
-- One table for both directions. giverId and recipientId both point at Person, so
-- "what did Mary give us" and "what have we given Mary" are the same rows read from
-- different ends — no direction column, and a contact page needs one query rather than
-- two tables. eventId is what separates a Christmas pile from a one-off.
--
-- Deliberately absent: any sync state. A gift is a Hearth record and has no business
-- in Google Contacts or Calendar, which keeps it clear of that machinery entirely.
ALTER TABLE "Event" ADD COLUMN "isGiftEvent" BOOLEAN NOT NULL DEFAULT false;

-- Who the presents are FOR. Not EventAttendee: a toddler receiving half of them need
-- not be on the invitation, and most attendees receive nothing.
CREATE TABLE "EventGiftRecipient" (
  "eventId"   TEXT NOT NULL,
  "personId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventGiftRecipient_pkey" PRIMARY KEY ("eventId", "personId")
);
CREATE INDEX "EventGiftRecipient_personId_idx" ON "EventGiftRecipient"("personId");

ALTER TABLE "EventGiftRecipient" ADD CONSTRAINT "EventGiftRecipient_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventGiftRecipient" ADD CONSTRAINT "EventGiftRecipient_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Gift" (
  "id"          TEXT NOT NULL,
  "ownerId"     TEXT NOT NULL,
  "eventId"     TEXT,
  "giverId"     TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "notes"       TEXT,
  "receivedOn"  DATE,
  "thankedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Gift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Gift_eventId_idx" ON "Gift"("eventId");
CREATE INDEX "Gift_giverId_idx" ON "Gift"("giverId");
CREATE INDEX "Gift_recipientId_idx" ON "Gift"("recipientId");
CREATE INDEX "Gift_ownerId_idx" ON "Gift"("ownerId");

ALTER TABLE "Gift" ADD CONSTRAINT "Gift_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_giverId_fkey"
  FOREIGN KEY ("giverId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Gift" ADD CONSTRAINT "Gift_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
