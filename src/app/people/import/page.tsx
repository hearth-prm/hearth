import Link from "next/link";
import { requireUser } from "@/lib/access";
import { applyImport, previewImport } from "@/lib/actions/import";
import { COLUMNS } from "@/lib/contacts-csv";
import { MAX_IMPORT_ROWS } from "@/lib/contacts-import";
import { btnSecondary, Card, CardHeader, PageHeader } from "@/components/ui";
import { ImportForm } from "@/components/import-form";

export default async function ImportPage() {
  await requireUser();

  return (
    <div>
      <PageHeader
        title="Import contacts"
        description="Add or update contacts from a CSV, including labels and sharing."
        action={
          <Link href="/people" className={btnSecondary}>
            Back to people
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ImportForm preview={previewImport} apply={applyImport} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="How rows are matched" />
            <ul className="space-y-2 px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
              <li>
                <strong className="font-medium">{COLUMNS.id}</strong> wins. Keep that
                column from an export and rows update in place.
              </li>
              <li>
                Otherwise the first email is matched against{" "}
                <strong className="font-medium">your own</strong> contacts. An email
                match is a guess, so it never reaches into a contact someone shared
                with you.
              </li>
              <li>An id Hearth has never seen means a new contact.</li>
              <li>
                An id you have no edit access to is <strong>skipped</strong>, not
                copied — so re-importing an export that included contacts shared with
                you cannot duplicate them.
              </li>
              <li>
                Two rows pointing at one contact: the second is skipped rather than
                silently overwriting the first.
              </li>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Column format" />
            <dl className="divide-y divide-neutral-100 px-5 text-sm dark:divide-neutral-800/60">
              <Row term={COLUMNS.labels}>
                Semicolon separated: <code>Family; Book club</code>. Labels not yet in
                Hearth are created.
              </Row>
              <Row term={`${COLUMNS.emails} / ${COLUMNS.phones} / …`}>
                Semicolon separated, each optionally typed with a pipe:{" "}
                <code>home|a@b.com; work|c@d.com</code>. A bare value is fine.
              </Row>
              <Row term={COLUMNS.sharedWith}>
                <code>wife@example.com|EDIT; friend@example.com|VIEW</code>. Only
                existing Hearth users. Sharing <strong>grants only</strong> — a name
                left out of the file never loses access.
              </Row>
              <Row term={COLUMNS.birthday}>
                <code>YYYY-MM-DD</code>. Ambiguous forms like <code>03/04/1990</code>{" "}
                are reported rather than guessed at.
              </Row>
              <Row term={COLUMNS.addToGoogle}>
                <code>true</code> or <code>false</code>.
              </Row>
              <Row term="Your custom fields">
                One column per field, headed with the field&rsquo;s name. Only applied
                to contacts you own.
              </Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Limits" />
            <ul className="space-y-2 px-5 py-4 text-sm text-neutral-600 dark:text-neutral-400">
              <li>{MAX_IMPORT_ROWS.toLocaleString()} rows per file, 4 MB.</li>
              <li>
                A column the file omits is left alone, so a narrow CSV cannot blank
                out fields it never mentions.
              </li>
              <li>
                Rows are applied one at a time. If one fails the rest still land, and
                the report says what did.
              </li>
              <li>Import never deletes a contact or revokes a share.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {term}
      </dt>
      <dd className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{children}</dd>
    </div>
  );
}
