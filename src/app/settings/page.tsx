import { prisma } from "@/lib/db";
import { readablePeopleWhere, requireUser } from "@/lib/access";
import { signIn } from "@/lib/auth";
import { getGoogleConnection, getUserSettings } from "@/lib/settings";
import { SCOPE_DESCRIPTIONS } from "@/lib/google/scopes";
import { commonTimeZones } from "@/lib/time";
import { updateSettings } from "@/lib/actions/settings";
import {
  resyncAllContacts,
  resyncAllEvents,
  syncContactsNow,
  syncEventsNow,
} from "@/lib/actions/sync";
import { listUserCalendars } from "@/lib/google/calendars";
import { describeActiveProvider, googlePlacesConfigured } from "@/lib/places";
import { SyncPanel } from "@/components/sync-panel";
import {
  Badge,
  btnSecondary,
  Card,
  CardHeader,
  DetailRow,
} from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";
import { AppearanceForm } from "@/components/appearance-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const [
    settings,
    google,
    pendingCount,
    errorCount,
    eventsPending,
    eventsError,
    calendars,
  ] = await Promise.all([
    getUserSettings(user.id),
    getGoogleConnection(user.id),
    // Counts for THIS account's copies, including shared contacts it must push.
    prisma.person.count({
      where: {
        AND: [
          readablePeopleWhere(user.id),
          { addToGoogle: true },
          {
            OR: [
              { googleSyncs: { none: { userId: user.id } } },
              {
                googleSyncs: {
                  some: { userId: user.id, googleSyncStatus: "PENDING" },
                },
              },
            ],
          },
        ],
      },
    }),
    prisma.personSync.count({
      where: { userId: user.id, googleSyncStatus: "ERROR" },
    }),
    prisma.event.count({
      where: {
        ownerId: user.id,
        addToGoogle: true,
        googleSyncStatus: "PENDING",
      },
    }),
    prisma.event.count({
      where: { ownerId: user.id, addToGoogle: true, googleSyncStatus: "ERROR" },
    }),
    listUserCalendars(user.id),
  ]);

  return (
    <div className="space-y-6">
      <AppearanceForm />

      <Card>
        <CardHeader
          title="Google account"
          action={
            google.needsReconnect ? (
              <Badge tone="amber">Reconnect needed</Badge>
            ) : (
              <Badge tone="accent">Connected</Badge>
            )
          }
        />
        <dl className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
          <DetailRow label="Account">{google.email ?? "—"}</DetailRow>
          <DetailRow label="Contacts permission">
            {google.canSyncContacts ? "Granted" : "Not granted"}
          </DetailRow>
          <DetailRow label="Calendar permission">
            {google.canSyncCalendar ? "Granted" : "Not granted"}
          </DetailRow>
          <DetailRow label="Send mail permission">
            {google.canSendMail
              ? "Granted — thank-you lists can be emailed"
              : "Not granted — reconnect to email thank-you lists"}
          </DetailRow>
          <DetailRow label="Offline access">
            {google.hasRefreshToken
              ? "Yes — background sync can refresh its own token"
              : "No — reconnect to allow background sync"}
          </DetailRow>
        </dl>

        <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800/60">
          {google.needsReconnect ? (
            <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              Hearth is missing a permission it needs
              {google.hasRefreshToken ? "" : ", or offline access"}.
              Reconnecting re-prompts Google for consent.
            </p>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/settings" });
            }}
          >
            <button type="submit" className={btnSecondary}>
              {google.needsReconnect
                ? "Reconnect Google"
                : "Re-authorise Google"}
            </button>
          </form>

          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">
              Permissions granted ({google.grantedScopes.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {google.grantedScopes.map((scope) => (
                <li
                  key={scope}
                  className="text-xs text-neutral-500 dark:text-neutral-400"
                >
                  {SCOPE_DESCRIPTIONS[scope] ?? scope}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </Card>

      {settings.googleAuthError ? (
        <p className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <strong className="font-medium">Sync is paused.</strong>{" "}
          {settings.googleAuthError} Reconnect above, then press “Sync now”.
        </p>
      ) : null}

      <SyncPanel
        title="Contact sync"
        description="Hearth pushes to Google Contacts. It never reads changes back."
        noun="contacts"
        syncNow={syncContactsNow}
        resyncAll={resyncAllContacts}
        enabled={settings.syncContactsEnabled}
        disabledNotice="Contact sync is turned off below. Nothing is sent to Google until you enable it and save."
        lastSyncAt={settings.lastContactSyncAt}
        lastSummary={settings.lastContactSyncSummary}
        pendingCount={pendingCount}
        errorCount={errorCount}
        timeZone={settings.timeZone}
      />

      <SyncPanel
        title="Calendar sync"
        description="Hearth pushes events and their guest list. Guest RSVPs come back."
        noun="events"
        syncNow={syncEventsNow}
        resyncAll={resyncAllEvents}
        enabled={settings.syncCalendarEnabled}
        disabledNotice="Calendar sync is turned off below. No events are sent to Google until you enable it and save."
        lastSyncAt={settings.lastEventSyncAt}
        lastSummary={settings.lastEventSyncSummary}
        pendingCount={eventsPending}
        errorCount={eventsError}
        timeZone={settings.timeZone}
        footnote="An event's guest list depends on your contacts, so changing someone's email does not by itself re-push the events they are on — re-queue events after changing addresses."
      />

      <SettingsForm
        action={updateSettings}
        values={{
          syncContactsEnabled: settings.syncContactsEnabled,
          syncSharedContacts: settings.syncSharedContacts,
          sendInvites: settings.sendInvites,
          syncCalendarEnabled: settings.syncCalendarEnabled,
          defaultAddToGoogle: settings.defaultAddToGoogle,
          inviteAttendees: settings.inviteAttendees,
          importRsvps: settings.importRsvps,
          googleCalendarId: settings.googleCalendarId,
          placesProvider: settings.placesProvider,
          timeZone: settings.timeZone,
        }}
        timeZones={commonTimeZones()}
        calendars={calendars}
        activePlacesProvider={describeActiveProvider(settings.placesProvider)}
        googlePlacesConfigured={googlePlacesConfigured()}
        canSyncContacts={google.canSyncContacts}
        canSyncCalendar={google.canSyncCalendar}
      />
    </div>
  );
}
