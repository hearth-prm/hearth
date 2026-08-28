-- A named filter somebody can come back to.
--
-- The stored value is the URL SEARCH STRING rather than a parsed set of columns: `q=...&rel=mine`.
-- That is deliberate. A filter is "the list I was looking at", and the list is defined by its
-- URL — so whatever the search language grows next, a saved filter restores it without a
-- migration and without a second parser to keep in step with the first. A column per filter
-- dimension would have needed altering for every one of the last four phases.
CREATE TABLE "SavedFilter" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "search" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedFilter_pkey" PRIMARY KEY ("id")
);

-- Private to whoever saved it. A filter can mention a label id that means nothing in anybody
-- else's account, so there is no sharing dimension here and no plan for one.
ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Saving twice under one name replaces rather than accumulating: the menu is a list of names,
-- and two rows called "Christmas cards" would be indistinguishable in it.
CREATE UNIQUE INDEX "SavedFilter_ownerId_name_key" ON "SavedFilter"("ownerId", "name");
CREATE INDEX "SavedFilter_ownerId_idx" ON "SavedFilter"("ownerId");
