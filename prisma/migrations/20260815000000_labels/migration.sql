-- Labels for contacts, and their per-account Google contact groups.
--
-- Purely additive: three new tables, nothing altered or dropped, so an install
-- can take this migration without a backup step and roll forward on a live
-- database.
--
-- Label is owned by a user rather than global to the install, because two people's
-- "Family" mean different things. A shared contact carries its OWNER's labels, so
-- PersonLabel needs no owner column of its own — it inherits one from both sides,
-- and the action layer enforces that the two agree.
--
-- LabelGroup exists because Google contact groups are per-account resources: the
-- owner's "Family" and a recipient's "Family" are different objects with different
-- resource names. A shared contact lands in every recipient's address book, so each
-- account needs its own same-named group.

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonLabel" (
    "personId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonLabel_pkey" PRIMARY KEY ("personId","labelId")
);

-- CreateTable
CREATE TABLE "LabelGroup" (
    "id" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleResourceName" TEXT NOT NULL,
    "googleEtag" TEXT,
    "googleSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Names are what users type, filter by and match on import, so they must be
-- unique per owner or none of those operations has a single answer. This index
-- also serves every lookup by owner, so there is no separate one.
CREATE UNIQUE INDEX "Label_ownerId_name_key" ON "Label"("ownerId", "name");

-- CreateIndex
CREATE INDEX "PersonLabel_labelId_idx" ON "PersonLabel"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelGroup_labelId_userId_key" ON "LabelGroup"("labelId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelGroup_userId_googleResourceName_key" ON "LabelGroup"("userId", "googleResourceName");

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLabel" ADD CONSTRAINT "PersonLabel_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonLabel" ADD CONSTRAINT "PersonLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelGroup" ADD CONSTRAINT "LabelGroup_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelGroup" ADD CONSTRAINT "LabelGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
