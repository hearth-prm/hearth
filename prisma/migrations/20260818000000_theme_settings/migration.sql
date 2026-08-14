-- Light/dark choice and a selectable accent scheme.
--
-- Three-valued theme rather than a boolean: "follow my machine" is a real preference and
-- has to be distinguishable from "I chose light", or a user who picks light on a dark
-- machine gets overridden by their OS.
--
-- The accent is stored as a hue in degrees because the whole eleven-step ramp is derived
-- from it in oklch. A named scheme is therefore just a hue too, and "make your own" needs
-- no extra storage — which is why there is one integer here instead of a palette table.
ALTER TABLE "UserSettings" ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "UserSettings" ADD COLUMN "colorScheme" TEXT NOT NULL DEFAULT 'teal';
ALTER TABLE "UserSettings" ADD COLUMN "accentHue" INTEGER NOT NULL DEFAULT 184;
