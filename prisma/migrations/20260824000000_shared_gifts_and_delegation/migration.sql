-- A gift can be for several people, and thanks can be delegated to the head of household.
--
-- hearth:allow-destructive
--
-- Gift.recipientId is dropped, but only after every row it held is copied into
-- GiftRecipient — so no gift loses who it was for. The column has to go rather than
-- linger: two places recording the same fact is two places that can disagree, and the
-- one that is easier to read is the one code keeps reaching for.
--
-- Thanks move onto the join with the recipients. A present shared between two children
-- earns two notes, one from each of them — the obligation is personal even when the
-- present was not — so recording it on the gift would let either child's note discharge
-- the other's. Existing gifts have exactly one recipient each, so copying across loses
-- nothing.
ALTER TABLE "UserSettings" ADD COLUMN "allowHeadThankYous" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GiftRecipient" (
  "giftId"       TEXT NOT NULL,
  "personId"     TEXT NOT NULL,
  "thankedAt"    TIMESTAMP(3),
  "thankYouNote" TEXT,
  CONSTRAINT "GiftRecipient_pkey" PRIMARY KEY ("giftId", "personId")
);
CREATE INDEX "GiftRecipient_personId_idx" ON "GiftRecipient"("personId");

ALTER TABLE "GiftRecipient" ADD CONSTRAINT "GiftRecipient_giftId_fkey"
  FOREIGN KEY ("giftId") REFERENCES "Gift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftRecipient" ADD CONSTRAINT "GiftRecipient_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "GiftRecipient" ("giftId", "personId", "thankedAt", "thankYouNote")
SELECT "id", "recipientId", "thankedAt", "thankYouNote" FROM "Gift";

DROP INDEX IF EXISTS "Gift_recipientId_idx";
ALTER TABLE "Gift" DROP COLUMN "recipientId";
ALTER TABLE "Gift" DROP COLUMN "thankedAt";
ALTER TABLE "Gift" DROP COLUMN "thankYouNote";
