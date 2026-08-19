import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { CurrentUser } from "@/lib/access";
import { btnGhost } from "@/components/ui";
import { UserAvatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { href: "/people", label: "People" },
  { href: "/events", label: "Events" },
  { href: "/trash", label: "Trash" },
  { href: "/settings", label: "Settings" },
];

export function AppNav({ user }: { user: CurrentUser }) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-3 sm:px-6 2xl:max-w-[88rem]">
        <Link
          href="/people"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span aria-hidden className="text-base">
            🏠
          </span>
          Hearth
        </Link>

        <nav className="flex flex-1 items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-2.5 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          {/* Google already gives us a profile picture at sign-in; it was simply never
              shown. On a shared install it is the quickest way to tell whose session
              you are looking at. */}
          <UserAvatar
            name={user.name ?? user.email ?? "?"}
            image={user.image}
          />
          <span
            className="hidden text-xs text-neutral-500 sm:block dark:text-neutral-400"
            title={user.email ?? undefined}
          >
            {user.name ?? user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button type="submit" className={btnGhost}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
