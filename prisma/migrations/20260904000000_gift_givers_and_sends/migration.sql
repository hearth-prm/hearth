-- hearth:allow-destructive
--
-- A gift can be from several people, and a thank-you is a record of a send.
--
-- Two changes that are really one. Once a gift has several givers, "has this recipient said
-- thank you" stops being a single fact: you may have written to Karen and not to Kenny. So the
-- thanks move off GiftRecipient and become what they always were in spirit — a record of
-- something Hearth sent, which is why the existing code says "Hearth can be certain of it
-- because it did the sending, which is why there is no checkbox and nothing to remember to
-- tick".
--
-- MARKED DESTRUCTIVE, and the marker is doing real work here: three columns are dropped at the
-- end. Everything in them is copied into the new tables FIRST, in this same migration, in the
-- order below. Read it top to bottom before changing anything — the drops depend on the copies
-- having happened.

-- --------------------------------------------------------------------------
-- 1. Givers: many per gift.
-- --------------------------------------------------------------------------
CREATE TABLE "GiftGiver" (
    "giftId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftGiver_pkey" PRIMARY KEY ("giftId","personId")
);

ALTER TABLE "GiftGiver" ADD CONSTRAINT "GiftGiver_giftId_fkey"
    FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftGiver" ADD CONSTRAINT "GiftGiver_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drives "what did this person give", the mirror of GiftRecipient's index.
CREATE INDEX "GiftGiver_personId_idx" ON "GiftGiver"("personId");

-- Every existing gift had exactly one giver. Copied before the column goes.
INSERT INTO "GiftGiver" ("giftId", "personId", "createdAt")
SELECT "id", "giverId", "createdAt" FROM "Gift";

-- --------------------------------------------------------------------------
-- 2. Sends: one per note written, with the givers it went to.
-- --------------------------------------------------------------------------
CREATE TABLE "ThankYouSend" (
    "id" TEXT NOT NULL,
    "giftId" TEXT NOT NULL,

    -- Which recipient is thanking. A present shared between two children earns two notes, so
    -- "thank you for this gift" is not a complete instruction on its own.
    "fromPersonId" TEXT NOT NULL,

    -- Who pressed send. Null for notes that predate this table: the old row recorded when a
    -- thank-you was sent but never who sent it, and inventing the gift's owner here would look
    -- like a fact rather than the guess it would be.
    "sentByUserId" TEXT,

    "message" TEXT NOT NULL,

    -- How it was addressed: together | separate | bcc.
    --
    -- Stored on the send rather than read from a setting, because a setting describes what
    -- happens next and a record has to describe what happened then. Every time this codebase
    -- has inferred history from current configuration it has been wrong later.
    "addressing" TEXT NOT NULL DEFAULT 'together',

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThankYouSend_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ThankYouSend" ADD CONSTRAINT "ThankYouSend_giftId_fkey"
    FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThankYouSend" ADD CONSTRAINT "ThankYouSend_fromPersonId_fkey"
    FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SET NULL rather than CASCADE: deleting the user who sent a note must not delete the note.
-- The record of having thanked somebody outlives whoever's account pressed the button.
ALTER TABLE "ThankYouSend" ADD CONSTRAINT "ThankYouSend_sentByUserId_fkey"
    FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- The recipient row the note was written from, over columns that already exist here. Free, and
-- it lets "what has this recipient sent for this gift" be one relation rather than a join
-- nobody can express from a nested filter.
ALTER TABLE "ThankYouSend" ADD CONSTRAINT "ThankYouSend_giftId_fromPersonId_fkey"
    FOREIGN KEY ("giftId", "fromPersonId") REFERENCES "GiftRecipient"("giftId", "personId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ThankYouSend_giftId_fromPersonId_idx" ON "ThankYouSend"("giftId", "fromPersonId");

CREATE TABLE "ThankYouSendGiver" (
    "sendId" TEXT NOT NULL,
    "giverPersonId" TEXT NOT NULL,

    -- The gift, duplicated from the send.
    --
    -- Redundant on purpose: it is the second half of the composite key relating this row to its
    -- GiftGiver, and that relation is what lets "has this giver been thanked" be asked in SQL
    -- rather than in application code — a filter nested under Gift cannot refer back to the
    -- giver it came from, but a relation hung off the giver row can. It must always equal
    -- send.giftId, which only the application can guarantee, so a check asserts it over every
    -- row rather than trusting the writers.
    "giftId" TEXT NOT NULL,

    -- The address it actually went to, so the record says where rather than implying it from
    -- whatever address the contact holds today. Null for notes that predate this table.
    "emailUsed" TEXT,

    -- Null until this one has gone. Separate addressing sends several messages, so two of
    -- three succeeding and the third bouncing is a real outcome — and one that has:unthanked
    -- must still report, or a failed send would read as a note delivered.
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "ThankYouSendGiver_pkey" PRIMARY KEY ("sendId","giverPersonId")
);

ALTER TABLE "ThankYouSendGiver" ADD CONSTRAINT "ThankYouSendGiver_sendId_fkey"
    FOREIGN KEY ("sendId") REFERENCES "ThankYouSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThankYouSendGiver" ADD CONSTRAINT "ThankYouSendGiver_giverPersonId_fkey"
    FOREIGN KEY ("giverPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- The composite one, to the giver row. GiftGiver is populated in step 1 above, so every row
-- inserted in step 4 has something to point at.
ALTER TABLE "ThankYouSendGiver" ADD CONSTRAINT "ThankYouSendGiver_giftId_giverPersonId_fkey"
    FOREIGN KEY ("giftId", "giverPersonId") REFERENCES "GiftGiver"("giftId", "personId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ThankYouSendGiver_giverPersonId_idx" ON "ThankYouSendGiver"("giverPersonId");
CREATE INDEX "ThankYouSendGiver_giftId_giverPersonId_idx" ON "ThankYouSendGiver"("giftId", "giverPersonId");

-- --------------------------------------------------------------------------
-- 3. Attachments, on the send.
-- --------------------------------------------------------------------------
--
-- On the send rather than on each giver: a group note carries one copy of a photograph, not
-- three. Bytes in the database, like contact photos, because that keeps the database the whole
-- install — there is no file store to back up separately, and a dump is everything.
CREATE TABLE "ThankYouAttachment" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThankYouAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ThankYouAttachment" ADD CONSTRAINT "ThankYouAttachment_sendId_fkey"
    FOREIGN KEY ("sendId") REFERENCES "ThankYouSend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ThankYouAttachment_sendId_idx" ON "ThankYouAttachment"("sendId");

-- --------------------------------------------------------------------------
-- 4. Copy the existing thanks in, one send per (recipient, giver) that was thanked.
-- --------------------------------------------------------------------------
--
-- Deterministic ids derived from the pair, so re-running this migration on a database that
-- somehow already has them cannot produce duplicates.
INSERT INTO "ThankYouSend" ("id", "giftId", "fromPersonId", "sentByUserId", "message", "addressing", "createdAt")
SELECT
    'legacy_' || gr."giftId" || '_' || gr."personId",
    gr."giftId",
    gr."personId",
    NULL,
    COALESCE(gr."thankYouNote", ''),
    'together',
    gr."thankedAt"
FROM "GiftRecipient" gr
WHERE gr."thankedAt" IS NOT NULL;

INSERT INTO "ThankYouSendGiver" ("sendId", "giverPersonId", "giftId", "emailUsed", "sentAt", "error")
SELECT
    'legacy_' || gr."giftId" || '_' || gr."personId",
    g."giverId",
    gr."giftId",
    NULL,
    gr."thankedAt",
    NULL
FROM "GiftRecipient" gr
JOIN "Gift" g ON g."id" = gr."giftId"
WHERE gr."thankedAt" IS NOT NULL;

-- --------------------------------------------------------------------------
-- 5. Now the old columns can go.
-- --------------------------------------------------------------------------
ALTER TABLE "Gift" DROP COLUMN "giverId";
ALTER TABLE "GiftRecipient" DROP COLUMN "thankedAt";
ALTER TABLE "GiftRecipient" DROP COLUMN "thankYouNote";
