"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { isValidTimeZone } from "@/lib/time";
import { isProviderChoice } from "@/lib/places";
import { reapSharedCopies } from "@/lib/sync/reap";
import { actionError, actionOk, type ActionState } from "@/lib/actions/types";
import { isFrameworkError, readCheckbox, readString, toActionError } from "@/lib/actions/shared";

export async function updateSettings(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireUserForAction();

    const timeZone = readString(form, "timeZone") || "UTC";
    if (!isValidTimeZone(timeZone)) {
      return actionError("That is not a recognised time zone.", {
        timeZone: "Unknown time zone",
      });
    }

    const googleCalendarId = readString(form, "googleCalendarId") || "primary";

    const providerRaw = readString(form, "placesProvider");
    const placesProvider = isProviderChoice(providerRaw) ? providerRaw : "auto";

    const syncSharedContacts = readCheckbox(form, "syncSharedContacts");

    const values = {
      syncContactsEnabled: readCheckbox(form, "syncContactsEnabled"),
      syncSharedContacts,
      syncCalendarEnabled: readCheckbox(form, "syncCalendarEnabled"),
      defaultAddToGoogle: readCheckbox(form, "defaultAddToGoogle"),
      inviteAttendees: readCheckbox(form, "inviteAttendees"),
      importRsvps: readCheckbox(form, "importRsvps"),
      sendInvites: readCheckbox(form, "sendInvites"),
      allowManagerThankYous: readCheckbox(form, "allowManagerThankYous"),
      googleCalendarId,
      placesProvider,
      timeZone,
    };

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...values },
      update: values,
    });

    // Declining shared contacts has to reach back and remove the ones already there.
    // Merely stopping future pushes would leave copies nothing will ever update
    // again, which is the outcome the setting exists to avoid. Run on every save
    // where the box is clear rather than only on the transition, so a state that got
    // out of step repairs itself; with the box clear there is nothing to find.
    if (!syncSharedContacts) await reapSharedCopies(user.id);
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  // The LAYOUT, not just this page. `data-theme` is stamped on <html> in the root layout
  // from these settings, so every route carries it — and revalidating only /settings left
  // the layout's cached output holding the old value. It showed up as §15.4d failing about
  // one run in three with the attribute saying "dark" while the row said "light": not a
  // stylesheet lagging behind, but the server rendering from a cache the save had not
  // reached. The same is true of the default time zone, which every page formats against.
  revalidatePath("/", "layout");
  return actionOk("Settings saved.");
}
