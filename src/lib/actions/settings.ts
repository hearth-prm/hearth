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
      allowHeadThankYous: readCheckbox(form, "allowHeadThankYous"),
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

  revalidatePath("/settings");
  return actionOk("Settings saved.");
}
