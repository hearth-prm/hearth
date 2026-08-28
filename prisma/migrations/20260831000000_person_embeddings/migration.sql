-- Semantic search: one vector per contact, over the text that contact carries.
--
-- A Float[] rather than pgvector. The database image is postgres:16-alpine, which has no
-- vector extension; adding one means swapping the image and a CREATE EXTENSION on every
-- install. Brute-force cosine over a few hundred rows in Node is microseconds, and pgvector
-- earns its keep somewhere in the tens of thousands of rows -- which is not a personal
-- address book.
CREATE TABLE "PersonEmbedding" (
    "personId" TEXT NOT NULL,

    -- The model that produced this vector.
    --
    -- A vector is only comparable to others from the same model: two models put "nurse"
    -- in different places, and mixing them silently ranks by nothing. Stored per row rather
    -- than per install so that changing OLLAMA_EMBED_MODEL re-embeds instead of comparing
    -- across spaces, and so a half-finished re-embed is detectable rather than corrupt.
    "model" TEXT NOT NULL,

    -- 768 floats for nomic-embed-text. Not constrained to a length: a different model has a
    -- different dimension, and the model column above is what makes a row interpretable.
    "vector" DOUBLE PRECISION[] NOT NULL,

    -- Hash of the exact text that was embedded.
    --
    -- The staleness check compares this rather than a timestamp. A timestamp queue keyed on
    -- Person.updatedAt would go stale in precisely the cases this feature exists for: adding
    -- a label, or recording a gift, changes what a contact means without touching the
    -- contact's own row. A hash cannot miss a change it did not think of.
    "sourceHash" TEXT NOT NULL,

    "embeddedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonEmbedding_pkey" PRIMARY KEY ("personId")
);

-- Cascade: a permanently deleted contact takes its vector with it. Trashing does NOT,
-- because restoring has to keep working and a trashed contact is already excluded from
-- every search by the access clauses.
ALTER TABLE "PersonEmbedding" ADD CONSTRAINT "PersonEmbedding_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The indexer asks "which rows were embedded by a model other than the current one, or not
-- at all", which is a scan of this table by model.
CREATE INDEX "PersonEmbedding_model_idx" ON "PersonEmbedding"("model");
