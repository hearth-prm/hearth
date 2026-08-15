-- An accent colour for light mode and another for dark.
--
-- A hue that carries on a white page is often muddy on a near-black one, so one accent
-- for both was a compromise neither mode wanted. Which pair applies is settled in CSS
-- rather than here: under "system" the mode is the browser's to know, so the server
-- sends both hues and a rule picks.
--
-- The rename makes the existing pair say which mode it belongs to. Renaming preserves
-- every value, and the UPDATE below then copies each user's chosen accent into dark as
-- well — without it, anyone who had picked rose would silently get teal after dark.
ALTER TABLE "UserSettings" RENAME COLUMN "colorScheme" TO "lightColorScheme";
ALTER TABLE "UserSettings" RENAME COLUMN "accentHue" TO "lightAccentHue";

ALTER TABLE "UserSettings" ADD COLUMN "darkColorScheme" TEXT NOT NULL DEFAULT 'teal';
ALTER TABLE "UserSettings" ADD COLUMN "darkAccentHue" INTEGER NOT NULL DEFAULT 184;

UPDATE "UserSettings"
   SET "darkColorScheme" = "lightColorScheme",
       "darkAccentHue"   = "lightAccentHue";
