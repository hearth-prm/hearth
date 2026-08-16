-- Any event can have gifts, so the flag saying whether it may has nothing left to say.
--
-- hearth:allow-destructive
--
-- Deliberate, and it loses nothing anybody entered: the column only ever recorded
-- "show the gift controls on this page", never a fact about the occasion. Gifts
-- themselves reference their event directly and are untouched by this.
ALTER TABLE "Event" DROP COLUMN "isGiftEvent";
