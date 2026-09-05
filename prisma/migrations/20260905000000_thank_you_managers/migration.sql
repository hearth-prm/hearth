-- "Somebody else may write my thank-yous" used to name the head of the household. That
-- power now belongs to a thank-you manager instead — the role named by
-- HEARTH_THANK_YOU_MANAGERS — so the column is renamed to say what it actually grants.
--
-- A RENAME, not a drop and recreate: every existing opt-in is carried across as it stands.
-- Worth being explicit that this is a judgement, not a technicality. Somebody who ticked
-- "let the head of the household write mine" was consenting to a particular person, and on
-- an install where the manager is somebody else that consent now reaches a different pair
-- of hands. Carried over anyway, because on a household install the two are the same
-- person and silently un-ticking everybody would break a working setup with no notice.
-- Resetting them instead would be one more line: UPDATE "UserSettings" SET
-- "allowManagerThankYous" = false;
ALTER TABLE "UserSettings"
  RENAME COLUMN "allowHeadThankYous" TO "allowManagerThankYous";
