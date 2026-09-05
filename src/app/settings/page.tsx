import { prisma } from "@/lib/db";
import { ownedEventsWhere,
  readablePeopleWhere, requireUser } from "@/lib/access";
import { signIn } from "@/lib/auth";
import { getGoogleConnection, getUserSettings } from "@/lib/settings";
import { SCOPE_DESCRIPTIONS, mailEnabled } from "@/lib/google/scopes";
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
import { SearchIndexPanel } from "@/components/search-index-panel";
import { rebuildSearchIndex } from "@/lib/actions/search-index";
import { indexStatus } from "@/lib/search/indexer";
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
    searchIndex,
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
    // ownedEventsWhere rather than a bare ownerId, so a trashed event is not counted as
    // waiting to sync: nothing is going to push it.
    prisma.event.count({
      where: {
        ...ownedEventsWhere(user.id),
        addToGoogle: true,
        googleSyncStatus: "PENDING",
      },
    }),
    prisma.event.count({
      where: { ...ownedEventsWhere(user.id), addToGoogle: true, googleSyncStatus: "ERROR" },
    }),
    listUserCalendars(user.id),
    // Cheap when unconfigured (it returns zeroes without touching the database); a scan of
    // the contacts' text when it is, which is the price of an honest number.
    indexStatus(),
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
            {/* Three states, not two. Telling somebody to "reconnect to email thank-you
                lists" on an install that never asks for the scope is advice that cannot
                work — the scope is opt-in, and the fix is a variable, not a reconnect. */}
            {!mailEnabled()
              ? "Not requested — set HEARTH_ENABLE_MAIL=true to offer thank-you emails"
              : google.canSendMail
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
          {/*
            The one failure that looks like a Hearth bug and is not.
            Named where the symptom appears, because the symptom — works, then stops about a
            week later, for ever — is otherwise indistinguishable from a sync bug, and the
            cause is a button in Google's console that most people never press.
          */}
          {settings.googleAuthError ? (
            <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              If sign-in works and then fails about a week later, the Google OAuth app is
              probably still in <strong>Testing</strong>, where Google expires refresh tokens
              after seven days. Publishing it fixes that permanently — see{" "}
              <code>docs/google-setup.md</code>.
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

      <SearchIndexPanel
        fresh={searchIndex.fresh}
        stale={searchIndex.stale}
        model={searchIndex.model}
        configured={searchIndex.configured}
        rebuild={rebuildSearchIndex}
      />

      <SettingsForm
        action={updateSettings}
        values={{
          syncContactsEnabled: settings.syncContactsEnabled,
          syncSharedContacts: settings.syncSharedContacts,
          allowManagerThankYous: settings.allowManagerThankYous,
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
