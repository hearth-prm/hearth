-- Sticky shares: a label carrying standing sharing intentions.
--
-- Filing a contact is the thing people actually do; sharing is the thing they forget, and a
-- share nobody remembered to grant is indistinguishable from a decision not to. So a label
-- carries a set of participants, and a contact filed under it is shared with all of them.
CREATE TABLE "LabelShare" (
    "labelId" TEXT NOT NULL,
    "withUserId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelShare_pkey" PRIMARY KEY ("labelId","withUserId")
);

ALTER TABLE "LabelShare" ADD CONSTRAINT "LabelShare_labelId_fkey"
    FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LabelShare" ADD CONSTRAINT "LabelShare_withUserId_fkey"
    FOREIGN KEY ("withUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drives "which labels am I a participant in", which is what widens somebody's label list
-- beyond the ones they own.
CREATE INDEX "LabelShare_withUserId_idx" ON "LabelShare"("withUserId");

-- Provenance. This column is the whole design.
--
-- Without it there is no way to tell a share a rule created from one a person created, and
-- therefore no safe way to withdraw anything: the naive "delete the shares when the label is
-- removed" revokes access a SECOND label still implies. Reconciliation only ever touches rows
-- where this is set, and a hand-made share is not its business.
--
-- Null for a share somebody granted by hand. Cascade rather than SET NULL: a deleted label's
-- implied shares should go with it, and turning them into hand-made shares would mean nobody
-- granted them and nobody can explain them.
ALTER TABLE "Share" ADD COLUMN "viaLabelId" TEXT;

ALTER TABLE "Share" ADD CONSTRAINT "Share_viaLabelId_fkey"
    FOREIGN KEY ("viaLabelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Share_viaLabelId_idx" ON "Share"("viaLabelId");
