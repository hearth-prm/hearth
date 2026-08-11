import Link from "next/link";
import { PageHeader } from "@/components/ui";

const tabs = [
  { href: "/settings", label: "Google & sync" },
  { href: "/settings/fields/people", label: "Contact fields" },
  { href: "/settings/fields/events", label: "Event fields" },
  { href: "/settings/mappings/people", label: "Contact → Google" },
  { href: "/settings/mappings/events", label: "Event → Google" },
  { href: "/settings/labels", label: "Labels" },
  { href: "/settings/relationships", label: "Relationship types" },
  { href: "/settings/sharing", label: "Sharing" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title="Settings" />
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-neutral-200 pb-px dark:border-neutral-800">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-t-md px-3 py-2 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
