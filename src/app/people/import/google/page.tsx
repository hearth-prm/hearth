import Link from "next/link";
import { requireUser } from "@/lib/access";
import { getGoogleConnection } from "@/lib/settings";
import { applyGoogleImport, previewGoogleImport } from "@/lib/actions/google-import";
import { btnSecondary, Card, CardHeader, PageHeader } from "@/components/ui";
import { GoogleImportForm } from "@/components/google-import-form";

export default async function GoogleImportPage() {
  const user = await requireUser();
  const google = await getGoogleConnection(user.id);

  return (
    <div>
      <PageHeader
        title="Import from Google Contacts"
        description="Bring existing Google contacts into Hearth without moving or re-creating them."
        action={
          <Link href="/people" className={btnSecondary}>
            Back to people
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {google.canSyncContacts ? (
            <GoogleImportForm
              preview={previewGoogleImport}
              apply={applyGoogleImport}
            />
          ) : (
            <Card>
              <CardHeader title="Google is not connected for contacts" />
              <p className="px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
                Hearth needs permission to read your contacts before it can import
                them. Reconnect Google in{" "}
                <Link href="/settings" className="text-accent-700 underline dark:text-accent-400">
                  Settings
                </Link>
                .
              </p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="How this works" />
            <ul className="space-y-3 px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
              <li>
                Your Google contacts stay exactly where they are. Hearth records which
                Google contact each of its own belongs to, and the next sync writes a{" "}
                <strong className="font-medium">hearth_id</strong> custom field onto the
                existing contact rather than making a new one.
              </li>
              <li>
                A contact does <strong className="font-medium">not</strong> have to have
                been created by Hearth to be linked. That is what makes this possible
                without exporting to CSV first.
              </li>
              <li>
                Google labels become Hearth labels, matched by name, so importing the
                same label twice reuses it rather than making a second one.
              </li>
              <li>
                Anything in a field group Hearth manages but has no column for — a middle
                name, a department, an existing custom field — is kept as a Hearth custom
                field and mapped straight back to Google. The preview names each one
                before you commit.
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Worth knowing" />
            <p className="px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
              Importing makes Hearth the source of truth for the fields it manages. The
              groups it does not manage — relations, custom dates, chat handles, external
              ids, interests — are never written by Hearth and are safe whatever you do
              here.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
