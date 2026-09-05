import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "@/lib/access";
import { getAppearance } from "@/lib/settings";
import {
  htmlAppearanceProps,
  normalizeAppearance,
  type Appearance,
} from "@/lib/theme";
import { AppearanceProvider } from "@/components/appearance-provider";
import { AppNav } from "@/components/nav";
import { countThankYousOwed } from "@/lib/thank-yous-owed";
import { AppFooter } from "@/components/app-footer";

export const metadata: Metadata = {
  title: "Hearth",
  description: "A self-hosted personal relationship manager",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  // Rendered server-side from the stored choice, which is the point: a theme applied
  // by a script after hydration flashes the wrong one first. Signed out, there is no
  // row to read, so the sign-in page follows the device.
  const appearance: Appearance = user
    ? await getAppearance(user.id)
    : normalizeAppearance(null);

  return (
    <html lang="en" {...htmlAppearanceProps(appearance)}>
      <body className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <AppearanceProvider initial={appearance}>
          {user ? (
            <AppNav
              user={user}
              thankYousOwed={await countThankYousOwed(user.id)}
            />
          ) : null}
          {/* max-w-5xl left roughly half a wide screen as margin. This is a data-dense
            app whose pages are two columns of cards, so it earns the width; the read
            column is bounded by the grid rather than by the page. py-8 was also more
            air than the nav needs — the first card should read as attached to the
            page, not floating below it. */}
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 2xl:max-w-[88rem]">
            {children}
          </main>
          <AppFooter />
        </AppearanceProvider>
      </body>
    </html>
  );
}
