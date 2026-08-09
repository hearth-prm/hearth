"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUserForAction } from "@/lib/access";
import { isValidTimeZone } from "@/lib/time";
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

    const values = {
      syncContactsEnabled: readCheckbox(form, "syncContactsEnabled"),
      syncCalendarEnabled: readCheckbox(form, "syncCalendarEnabled"),
      defaultAddToGoogle: readCheckbox(form, "defaultAddToGoogle"),
      inviteAttendees: readCheckbox(form, "inviteAttendees"),
      importRsvps: readCheckbox(form, "importRsvps"),
      syncCustomFields: readCheckbox(form, "syncCustomFields"),
      sendInvites: readCheckbox(form, "sendInvites"),
      googleCalendarId,
      timeZone,
    };

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...values },
      update: values,
    });
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    return toActionError(err);
  }

  revalidatePath("/settings");
  return actionOk("Settings saved.");
}
