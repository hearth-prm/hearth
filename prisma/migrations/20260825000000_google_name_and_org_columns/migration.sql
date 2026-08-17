-- Real columns for the parts of a Google name and organisation Hearth used to drop.
--
-- Not a new feature so much as the end of a quiet one. `names` and `organizations` are
-- both in MANAGED_PERSON_FIELDS, and serializePerson sent only givenName/familyName and
-- {name, title} — so every sync replaced those groups with a poorer version of what was
-- already there. A middle name, a department, a phonetic reading: present in Google,
-- unknown to Hearth, deleted on the next push.
--
-- Additive and nullable, so nothing existing changes and no backfill is needed: a contact
-- Hearth created never had these to begin with.
ALTER TABLE "Person" ADD COLUMN "middleName" TEXT;
ALTER TABLE "Person" ADD COLUMN "honorificPrefix" TEXT;
ALTER TABLE "Person" ADD COLUMN "honorificSuffix" TEXT;
ALTER TABLE "Person" ADD COLUMN "phoneticGivenName" TEXT;
ALTER TABLE "Person" ADD COLUMN "phoneticMiddleName" TEXT;
ALTER TABLE "Person" ADD COLUMN "phoneticFamilyName" TEXT;

ALTER TABLE "Person" ADD COLUMN "orgDepartment" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgJobDescription" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgSymbol" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgDomain" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgLocation" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgPhoneticName" TEXT;
ALTER TABLE "Person" ADD COLUMN "orgType" TEXT;
