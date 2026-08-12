-- Contact photos, and a record of which photo each Google account last received.
--
-- Purely additive: one new table and one nullable column.
--
-- PersonPhoto is keyed on (contact, user), not on the contact alone. The owner's row
-- is the default and flows through to everyone the contact is shared with, but a
-- recipient may set their own instead — a photo is how you recognise somebody, and
-- that is personal in a way a job title is not. It is the one deliberate exception to
-- "one record reads the same to everyone"; labels and custom fields still follow the
-- owner.
--
-- Bytes live here rather than on disk so the verified pg_dump that update-hearth.sh
-- takes before every update carries them too. An upload directory would need its own
-- backup story, and the forgotten backup is the one that matters.

-- CreateTable
CREATE TABLE "PersonPhoto" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonPhoto_personId_userId_key" ON "PersonPhoto"("personId", "userId");

-- CreateIndex
CREATE INDEX "PersonPhoto_userId_idx" ON "PersonPhoto"("userId");

-- AddForeignKey
ALTER TABLE "PersonPhoto" ADD CONSTRAINT "PersonPhoto_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPhoto" ADD CONSTRAINT "PersonPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
-- Photos go to Google through a separate call from the field update, so each account
-- needs its own record of which photo it has: without it every sync re-uploads.
ALTER TABLE "PersonSync" ADD COLUMN "googlePhotoEtag" TEXT;
