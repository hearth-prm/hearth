import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/access";
import { signIn } from "@/lib/auth";
import { getGoogleConnection, getUserSettings } from "@/lib/settings";
import { SCOPE_DESCRIPTIONS } from "@/lib/google/scopes";
import { commonTimeZones } from "@/lib/time";
import { updateSettings } from "@/lib/actions/settings";
import { resyncAllContacts, syncContactsNow } from "@/lib/actions/sync";
import { SyncPanel } from "@/components/sync-panel";
import { Badge, btnSecondary, Card, CardHeader, DetailRow } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const user = await requireUser();
  const [settings, google, pendingCount, errorCount] = await Promise.all([
    getUserSettings(user.id),
    getGoogleConnection(user.id),
    prisma.person.count({
      where: { ownerId: user.id, addToGoogle: true, googleSyncStatus: "PENDING" },
    }),
    prisma.person.count({
      where: { ownerId: user.id, addToGoogle: true, googleSyncStatus: "ERROR" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Google account"
          action={
            google.needsReconnect ? (
              <Badge tone="amber">Reconnect needed</Badge>
            ) : (
              <Badge tone="teal">Connected</Badge>
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
              {google.hasRefreshToken ? "" : ", or offline access"}. Reconnecting
              re-prompts Google for consent.
            </p>
          ) : null}
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/settings" });
            }}
          >
            <button type="submit" className={btnSecondary}>
              {google.needsReconnect ? "Reconnect Google" : "Re-authorise Google"}
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
        syncNow={syncContactsNow}
        resyncAll={resyncAllContacts}
        enabled={settings.syncContactsEnabled}
        lastSyncAt={settings.lastContactSyncAt}
        lastSummary={settings.lastContactSyncSummary}
        pendingCount={pendingCount}
        errorCount={errorCount}
        timeZone={settings.timeZone}
      />

      <SettingsForm
        action={updateSettings}
        values={{
          syncContactsEnabled: settings.syncContactsEnabled,
          syncCustomFields: settings.syncCustomFields,
          syncCalendarEnabled: settings.syncCalendarEnabled,
          defaultAddToGoogle: settings.defaultAddToGoogle,
          inviteAttendees: settings.inviteAttendees,
          importRsvps: settings.importRsvps,
          googleCalendarId: settings.googleCalendarId,
          timeZone: settings.timeZone,
        }}
        timeZones={commonTimeZones()}
        canSyncContacts={google.canSyncContacts}
        canSyncCalendar={google.canSyncCalendar}
      />
    </div>
  );
}
