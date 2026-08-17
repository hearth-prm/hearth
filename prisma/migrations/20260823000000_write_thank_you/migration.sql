-- Write the thank-you here and send it to the giver, instead of nagging the recipient.
--
-- hearth:allow-destructive
--
-- reminderSentAt goes because reminders do. Its whole purpose was to record that Hearth
-- had asked somebody to go and write a note elsewhere; now the note is written here and
-- sent from here, so the only fact left worth keeping is that it went — which thankedAt
-- already records, and now records with certainty rather than on trust.
--
-- Anything mid-flight loses only "we nagged about this once". The gifts, and any
-- thankedAt already set, are untouched.
ALTER TABLE "Gift" DROP COLUMN "reminderSentAt";
ALTER TABLE "Gift" ADD COLUMN "thankYouNote" TEXT;
