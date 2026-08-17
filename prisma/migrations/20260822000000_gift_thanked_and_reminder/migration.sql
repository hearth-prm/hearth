-- Split "we sent a reminder" from "the thank-you was written".
--
-- The existing column recorded the former while being named for the latter: it was set
-- when the email went out. So it is renamed rather than dropped — every value in it is
-- true of reminderSentAt — and the real thankedAt starts empty, which is correct: nobody
-- has yet told Hearth they wrote anything.
--
-- Keeping them separate is what makes the outstanding list mean something. If sending
-- marked the job done, the list would empty itself the moment you asked for a reminder.
ALTER TABLE "Gift" RENAME COLUMN "thankedAt" TO "reminderSentAt";
ALTER TABLE "Gift" ADD COLUMN "thankedAt" TIMESTAMP(3);
