import type { Metadata } from "next";
import "./globals.css";
import { currentUser } from "@/lib/access";
import { AppNav } from "@/components/nav";
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

  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {user ? <AppNav user={user} /> : null}
        {/* max-w-5xl left roughly half a wide screen as margin. This is a data-dense
            app whose pages are two columns of cards, so it earns the width; the read
            column is bounded by the grid rather than by the page. py-8 was also more
            air than the nav needs — the first card should read as attached to the
            page, not floating below it. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 2xl:max-w-[88rem]">
          {children}
        </main>
        <AppFooter />
      </body>
    </html>
  );
}
