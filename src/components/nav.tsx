import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { CurrentUser } from "@/lib/access";
import { btnGhost } from "@/components/ui";
import { UserAvatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { HearthMark } from "@/components/hearth-mark";

const links = [
  { href: "/people", label: "People" },
  { href: "/events", label: "Events" },
  // Between Events and Trash: it is work you come back to, like the two above it, rather
  // than configuration. The badge is what makes it worth a top-level slot — an unwritten
  // thank-you is invisible everywhere else until you happen to open the right present.
  { href: "/thank-yous", label: "Thank-yous" },
  { href: "/trash", label: "Trash" },
  { href: "/settings", label: "Settings" },
];

export function AppNav({
  user,
  thankYousOwed = 0,
}: {
  user: CurrentUser;
  /** The viewer's OWN count, never a super user's wider one — see thank-yous-owed.ts. */
  thankYousOwed?: number;
}) {
  return (
    <header className="border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/80">
      {/*
        flex-wrap, and a tighter gap below sm. Without it the right-hand cluster — theme
        toggle, avatar, name, sign out — pushed every page to 529px against a 390px phone
        viewport, so the whole app scrolled sideways. The header was the only thing doing it;
        the pages themselves already stack. Wrapping to two rows on a narrow screen is the
        least clever fix and the one that cannot push anything off-screen again.
      */}
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:gap-x-6 sm:px-6 2xl:max-w-[88rem]">
        <Link
          href="/people"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <HearthMark className="size-5 text-accent-600 dark:text-accent-400" />
          Hearth
        </Link>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex items-center rounded-md px-2.5 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              {l.label}
              {l.href === "/thank-yous" && thankYousOwed > 0 ? (
                // A number, not a dot: "three notes" is a different afternoon from "one".
                <span className="ml-1.5 rounded-full bg-accent-100 px-1.5 py-0.5 text-xs font-medium text-accent-800 dark:bg-accent-900 dark:text-accent-200">
                  {thankYousOwed}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>

        {/*
          w-full below sm, so this cluster takes a row of its own rather than being crushed
          into the links. Letting it merely shrink produced overlapping text: flex-wrap only
          moves an item to the next line when it cannot fit, and these items can always be
          squeezed a little further.
        */}
        <div className="flex w-full items-center justify-end gap-2.5 sm:w-auto">
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
