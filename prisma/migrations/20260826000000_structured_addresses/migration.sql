-- The parts of an address, and an email's display name.
--
-- `addresses` is a managed group, and serializePerson sent only formattedValue — so every
-- sync replaced a structured Google address with one flat line. Street, city, region and
-- postcode were present in Google, unknown to Hearth, and gone on the next push.
--
-- The one-line value stays: it is what Hearth displays and searches, and Google accepts
-- formattedValue alongside the components. Keeping both means an address typed in Hearth
-- still reads correctly and an imported one keeps its shape.
--
-- Additive and nullable. Nothing existing changes and no backfill is possible: the
-- structure was never stored to begin with.
ALTER TABLE "ContactPoint" ADD COLUMN "poBox" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "streetAddress" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "extendedAddress" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "city" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "region" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "country" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "ContactPoint" ADD COLUMN "displayName" TEXT;
