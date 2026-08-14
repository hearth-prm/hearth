"use server";

import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import {
  normalizeHue,
  normalizeScheme,
  normalizeTheme,
  type Appearance,
} from "@/lib/theme";

/**
 * Persist an appearance choice.
 *
 * Deliberately not part of the big settings form, and deliberately not returning an
 * ActionState: the control has already applied the change to the live document, so
 * there is nothing to report on success and no "Save" to press. It takes typed
 * arguments rather than FormData for the same reason — no form is submitted.
 *
 * No revalidatePath either. The root layout renders <html> per request, so the next
 * full load reads this row; between now and then the DOM is already correct. Busting
 * the cache would re-render every page to change nothing visible.
 */
export async function saveAppearance(appearance: Appearance): Promise<void> {
  const user = await requireUserForAction();

  const values = {
    theme: normalizeTheme(appearance.theme),
    colorScheme: normalizeScheme(appearance.colorScheme),
    accentHue: normalizeHue(appearance.accentHue),
  };

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...values },
    update: values,
  });
}
